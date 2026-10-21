package com.fredc.opengym;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearMotionMailboxTest {
    @Test public void slowConsumerReceivesLatestSampleWithoutGrowingHistory() throws Exception {
        var mailbox = new WearMotionMailbox();
        for (int i = 0; i < 100_000; i++) mailbox.offer("sample-" + i);
        assertEquals("sample-99999", mailbox.take());
        mailbox.close();
        assertNull(mailbox.take());
    }

    @Test public void closingDiscardsPendingDataAndWakesBlockedWriter() throws Exception {
        var mailbox = new WearMotionMailbox();
        mailbox.offer("old-session");
        mailbox.close();
        mailbox.offer("late-event");
        assertNull(mailbox.take());
        var waiting = new WearMotionMailbox();
        AtomicReference<String> result = new AtomicReference<>("still-waiting");
        Thread reader = new Thread(() -> {
            try { result.set(waiting.take()); }
            catch (InterruptedException e) { throw new AssertionError(e); }
        });
        reader.start();
        waiting.close();
        reader.join(1000);
        assertFalse(reader.isAlive());
        assertNull(result.get());
    }
}
