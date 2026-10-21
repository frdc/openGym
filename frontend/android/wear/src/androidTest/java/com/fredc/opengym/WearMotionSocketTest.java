package com.fredc.opengym;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.SystemClock;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearMotionSocketTest {
    private LocalSocket connect() throws Exception {
        LocalSocket socket = new LocalSocket();
        socket.connect(new LocalSocketAddress(WearMotionSocket.NAME, LocalSocketAddress.Namespace.ABSTRACT));
        socket.setReceiveBufferSize(1024);
        socket.setSoTimeout(2500);
        return socket;
    }

    private BufferedReader lines(LocalSocket socket) throws Exception {
        return new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
    }

    @Test public void everyClientGetsHelloFirstAndReplacementClosesThePreviousClient() throws Exception {
        var protocol = new WearMotionProtocol("instrumentation", "unavailable", false, false, false);
        try (var server = new WearMotionSocket(protocol.hello(), status -> {})) {
            server.publish(protocol.sample(0));
            try (LocalSocket first = connect()) {
                var oldInput = lines(first);
                assertEquals("hello", new JSONObject(oldInput.readLine()).getString("type"));
                server.publish(protocol.sample(40_000_000L));
                JSONObject firstSample = new JSONObject(oldInput.readLine());
                assertEquals(1, firstSample.getInt("seq"));
                assertTrue(firstSample.isNull("q"));
                try (LocalSocket second = connect()) {
                    var newInput = lines(second);
                    assertEquals("hello", new JSONObject(newInput.readLine()).getString("type"));
                    assertNull(oldInput.readLine());
                    server.publish(protocol.sample(80_000_000L));
                    assertEquals(2, new JSONObject(newInput.readLine()).getInt("seq"));
                }
            }
        }
    }

    @Test public void stalledReaderIsDisconnectedAndFreshConnectionStillWorks() throws Exception {
        var protocol = new WearMotionProtocol("instrumentation", "unavailable", false, false, false);
        CountDownLatch slow = new CountDownLatch(1);
        try (var server = new WearMotionSocket(protocol.hello(), status -> { if (status == WearMotionSocket.Status.SLOW) slow.countDown(); })) {
            try (LocalSocket stalled = connect()) {
                assertEquals("hello", new JSONObject(lines(stalled).readLine()).getString("type"));
                long deadline = SystemClock.elapsedRealtime() + WearMotionSocket.WRITE_STALL_TIMEOUT_MS + 2000;
                while (slow.getCount() != 0 && SystemClock.elapsedRealtime() < deadline) {
                    server.publish(protocol.sample(SystemClock.elapsedRealtimeNanos()));
                    Thread.sleep(5);
                }
                assertTrue("A blocked socket write must expire", slow.await(100, TimeUnit.MILLISECONDS));
                try (LocalSocket recovered = connect()) {
                    var input = lines(recovered);
                    assertEquals("hello", new JSONObject(input.readLine()).getString("type"));
                    server.publish(protocol.sample(SystemClock.elapsedRealtimeNanos()));
                    assertEquals("sample", new JSONObject(input.readLine()).getString("type"));
                }
            }
        }
    }

    @Test public void briefWirelessBackpressureDoesNotDisconnectTheSession() throws Exception {
        var protocol = new WearMotionProtocol("wireless-test", "unavailable", false, false, false);
        CountDownLatch slow = new CountDownLatch(1);
        try (var server = new WearMotionSocket(protocol.hello(), status -> { if (status == WearMotionSocket.Status.SLOW) slow.countDown(); });
             LocalSocket pausedReader = connect()) {
            var input = lines(pausedReader);
            assertEquals("hello", new JSONObject(input.readLine()).getString("type"));
            long deadline = SystemClock.elapsedRealtime() + 2250;
            while (SystemClock.elapsedRealtime() < deadline) {
                server.publish(protocol.sample(SystemClock.elapsedRealtimeNanos()));
                Thread.sleep(5);
            }
            assertEquals("A temporary wireless stall must not end the session", 1L, slow.getCount());
            assertEquals("sample", new JSONObject(input.readLine()).getString("type"));
        }
    }
}
