package com.fredc.opengym;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.io.File;
import java.util.UUID;
import static org.junit.Assert.*;

public class WearHeartStoreTest {
    private Context isolated() {
        Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(base.getCacheDir(), "heart-test-" + UUID.randomUUID()); directory.mkdirs();
        return new ContextWrapper(base) { @Override public File getFilesDir() { return directory; } };
    }
    @Test public void finalQueueSurvivesRestartAndOnlyExactFinalReceiptRetiresIt() throws Exception {
        Context context = isolated(); WearHeartStore store = new WearHeartStore(context);
        store.phone = "phone"; store.contextToken = "owner-context";
        WearHeartCapture capture = new WearHeartCapture("token", 100000, 5000);
        capture.phone = "phone"; capture.contextToken = "owner-context"; capture.add(6000, 120); capture.complete(7000); capture.close(9000, "next-set"); capture.packetId = "final";
        store.captures.add(capture); assertTrue(store.save());
        WearHeartStore restored = new WearHeartStore(context); assertEquals(1, restored.captures.size());
        JSONObject ack = new JSONObject().put("v", 1).put("token", "token").put("status", "ok").put("requestId", "old");
        restored.acknowledge("phone", ack); assertEquals(1, restored.captures.size());
        ack.put("requestId", "final"); restored.acknowledge("other", ack); assertEquals(1, restored.captures.size());
        restored.acknowledge("phone", ack); assertEquals(0, new WearHeartStore(context).captures.size());
    }
    @Test public void processDeathMarksAnOpenCapturePartialWithoutRestartingSensors() {
        Context context = isolated(); WearHeartStore store = new WearHeartStore(context);
        WearHeartCapture capture = new WearHeartCapture("token", 100000, 5000); capture.add(6000, 120);
        store.captures.add(capture); assertTrue(store.save());
        WearHeartCapture restored = new WearHeartStore(context).captures.get(0);
        assertTrue(restored.partial); assertEquals("interrupted", restored.endReason); assertEquals(1000, restored.recoveryEndMs);
    }
    @Test public void lateBatchIsRoutedToClosedPreviousContextUntilFlushCompletes() {
        WearHeartStore store = new WearHeartStore(isolated()); store.contextToken = "new";
        WearHeartCapture old = new WearHeartCapture("old-token", 100000, 5000);
        old.contextToken = "old"; old.complete(7000); old.close(9000, "next-set"); old.awaitingFlush = true;
        WearHeartCapture next = new WearHeartCapture("new-token", 104000, 9000); next.contextToken = "new";
        store.captures.add(old); store.captures.add(next);
        store.sample(8000, 100); store.sample(9500, 110);
        assertEquals(1, old.points.size()); assertEquals(3000, old.points.get(0)[0], 0);
        assertEquals(1, next.points.size()); assertEquals(500, next.points.get(0)[0], 0);
        store.flushed(true); store.sample(8500, 105); assertEquals(1, old.points.size());
    }
    @Test public void queueLimitIsReleasedAfterFinalDurableReceipt() throws Exception {
        WearHeartStore store = new WearHeartStore(isolated()); store.phone = "phone"; store.limitReached = true;
        WearHeartCapture c = new WearHeartCapture("token", 100000, 5000); c.phone = "phone"; c.close(9000, "disabled"); c.packetId = "final"; store.captures.add(c);
        assertFalse(store.canStart());
        store.acknowledge("phone", new JSONObject().put("v", 1).put("token", "token").put("status", "ok").put("requestId", "final"));
        assertTrue(store.canStart());
    }
    @Test public void canceledClosedTokenIsRetiredOnlyByItsOwnContextSnapshot() throws Exception {
        WearHeartStore store = new WearHeartStore(isolated()); store.phone = "phone"; store.contextToken = "same";
        WearHeartCapture c = new WearHeartCapture("canceled", 100000, 5000); c.contextToken = "same"; c.phone = "phone"; c.close(9000, "disabled"); store.captures.add(c);
        WearHeartCapture old = new WearHeartCapture("old-owner", 100000, 5000); old.contextToken = "old"; old.phone = "phone"; old.close(9000, "disabled"); store.captures.add(old);
        store.snapshot(new JSONObject().put("contextToken", "same").put("active", true).put("heartAuthorizedTokens", new org.json.JSONArray()), "phone");
        assertEquals(1, store.captures.size()); assertEquals("old-owner", store.captures.get(0).token);
        assertTrue(store.save());
    }
}
