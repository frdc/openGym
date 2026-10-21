package com.fredc.opengym;

import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Process;
import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** Debug-only abstract Unix socket. No network listener or workout-service dependencies. */
final class WearMotionSocket implements Closeable {
    static final String NAME = "opengym-motion-v1";
    enum Status { WAITING, CONNECTED, SLOW, ERROR }
    private final Object lock = new Object();
    private final LocalServerSocket server;
    private final String hello;
    private final Consumer<Status> listener;
    private final Thread acceptThread;
    private final ScheduledExecutorService watchdog;
    private volatile boolean closed;
    private volatile Peer current;

    WearMotionSocket(String hello, Consumer<Status> listener) throws IOException {
        this.hello = hello;
        this.listener = listener;
        server = new LocalServerSocket(NAME);
        watchdog = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "wear-motion-timeout");
            thread.setDaemon(true);
            return thread;
        });
        acceptThread = new Thread(this::acceptLoop, "wear-motion-accept");
        acceptThread.setDaemon(true);
        watchdog.scheduleAtFixedRate(this::checkSlowPeer, 250, 250, TimeUnit.MILLISECONDS);
        acceptThread.start();
    }

    void publish(String sample) {
        Peer peer = current;
        if (peer != null) peer.mailbox.offer(sample);
    }

    private void acceptLoop() {
        try {
            while (!closed) {
                LocalSocket socket = server.accept();
                Peer next;
                try {
                    if (!WearMotionProtocol.allowedPeer(socket.getPeerCredentials().getUid(), Process.myUid())) {
                        closeSocket(socket);
                        continue;
                    }
                    // Bound the OS buffer too; a blocked write is disconnected by the watchdog.
                    socket.setSendBufferSize(1024);
                    next = new Peer(socket);
                } catch (IOException e) {
                    closeSocket(socket);
                    continue;
                }
                Peer previous;
                synchronized (lock) {
                    if (closed) { next.close(); break; }
                    previous = current;
                    current = next;
                }
                if (previous != null) previous.close();
                next.writer.start();
            }
        } catch (IOException e) {
            if (!closed) { listener.accept(Status.ERROR); close(); }
        }
    }

    private void checkSlowPeer() {
        Peer peer = current;
        if (peer == null) return;
        long started = peer.writeStarted;
        if (started != 0 && SystemClock.elapsedRealtime() - started >= 1000) {
            peer.endStatus = Status.SLOW;
            peer.close();
        }
    }

    @Override public void close() {
        Peer peer;
        synchronized (lock) {
            if (closed) return;
            closed = true;
            peer = current;
            current = null;
        }
        watchdog.shutdownNow();
        // Shutdown wakes an accept blocked in the kernel before releasing the abstract name.
        try { Os.shutdown(server.getFileDescriptor(), OsConstants.SHUT_RDWR); } catch (ErrnoException ignored) { }
        try { server.close(); } catch (IOException ignored) { }
        acceptThread.interrupt();
        if (peer != null) peer.close();
    }

    private final class Peer implements Closeable {
        final LocalSocket socket;
        final WearMotionMailbox mailbox = new WearMotionMailbox();
        final Thread writer;
        volatile long writeStarted;
        volatile Status endStatus = Status.WAITING;
        private boolean stopped;

        Peer(LocalSocket socket) {
            this.socket = socket;
            writer = new Thread(this::writeLoop, "wear-motion-writer");
            writer.setDaemon(true);
        }

        private void writeLoop() {
            try {
                OutputStream output = socket.getOutputStream();
                write(output, hello);
                synchronized (lock) {
                    if (!closed && current == this) listener.accept(Status.CONNECTED);
                }
                String line;
                while ((line = mailbox.take()) != null) write(output, line);
            } catch (IOException ignored) {
                // ADB disconnect, replacement and lifecycle shutdown all close this stream.
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                close();
                synchronized (lock) {
                    if (!closed && current == this) {
                        current = null;
                        listener.accept(endStatus);
                    }
                }
            }
        }

        private void write(OutputStream output, String value) throws IOException {
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 8192) throw new IOException("Motion frame too large");
            writeStarted = SystemClock.elapsedRealtime();
            try { output.write(bytes); }
            finally { writeStarted = 0; }
        }

        @Override public synchronized void close() {
            if (stopped) return;
            stopped = true;
            mailbox.close();
            closeSocket(socket);
            writer.interrupt();
        }
    }

    private static void closeSocket(LocalSocket socket) {
        try { socket.shutdownInput(); } catch (IOException ignored) { }
        try { socket.shutdownOutput(); } catch (IOException ignored) { }
        try { socket.close(); } catch (IOException ignored) { }
    }
}
