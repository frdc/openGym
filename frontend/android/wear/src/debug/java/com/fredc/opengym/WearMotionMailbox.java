package com.fredc.opengym;

/** One pending sample per client: slow consumers never accumulate sensor history. */
final class WearMotionMailbox {
    private String latest;
    private boolean closed;

    synchronized void offer(String value) {
        if (closed) return;
        latest = value;
        notifyAll();
    }

    synchronized String take() throws InterruptedException {
        while (latest == null && !closed) wait();
        String result = latest;
        latest = null;
        return result;
    }

    synchronized void close() {
        closed = true;
        latest = null;
        notifyAll();
    }
}
