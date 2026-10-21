package com.fredc.opengym;

import org.json.JSONObject;
import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class WearRefreshTest {
    static class Port implements WearRefresh.Port {
        int pending = 2, heartPending = 1, replays, receives;
        boolean conflict, legacy, saved = true;
        String context = "session";
        final List<String> paths = new ArrayList<>();
        JSONObject result;
        public String context() { return context; }
        public int pending() { return pending; }
        public int heartPending() { return heartPending; }
        public boolean conflicted() { return conflict || legacy; }
        public void replay(String node) { replays++; }
        public void send(String node, String path, JSONObject payload) { paths.add(path); result = payload; }
        public boolean receive(JSONObject state, long sentAt) { receives++; return saved; }
    }
    private JSONObject request() throws Exception { return new JSONObject().put("v", 1).put("requestId", "refresh-1").put("contextToken", "session").put("sentAt", 1000); }
    private JSONObject update() throws Exception { return new JSONObject().put("syncId", "refresh-1").put("sentAt", 3000).put("state", new JSONObject().put("v", 1).put("contextToken", "session").put("localReady", true)); }
    @Test public void drainsTheJournalBeforeRequestingStateAndConfirmsOnlyAfterApplyingIt() throws Exception {
        Port port = new Port(); WearRefresh sync = new WearRefresh(port);
        sync.request("phone", request(), 1000);
        assertEquals(1, port.replays); assertTrue(port.paths.isEmpty());
        port.pending = 0; sync.advance(2000);
        assertEquals(List.of("/opengym/v1/sync"), port.paths);
        assertFalse(sync.state("other", update(), 3000)); assertEquals(0, port.receives);
        assertTrue(sync.state("phone", update(), 3000));
        assertEquals("ok", port.result.getString("status")); assertEquals(1, port.result.getInt("heartPending"));
        assertEquals(1, port.receives);
    }
    @Test public void conflictAndSessionMismatchNeverApplyOrDiscardPendingData() throws Exception {
        for (boolean otherSession : new boolean[] {false, true}) {
            Port port = new Port(); port.conflict = !otherSession; port.context = otherSession ? "other" : "session";
            WearRefresh sync = new WearRefresh(port); sync.request("phone", request(), 1000);
            assertEquals("error", port.result.getString("status")); assertEquals("sync-conflict", port.result.getString("code"));
            assertEquals(2, port.pending); assertEquals(0, port.receives);
        }
    }
    @Test public void expiredAndUnpersistedUpdatesCannotBeReportedAsSynchronized() throws Exception {
        Port port = new Port(); port.pending = 0; WearRefresh sync = new WearRefresh(port);
        sync.request("phone", request(), 1000); port.saved = false;
        sync.state("phone", update(), 2000);
        assertEquals("error", port.result.getString("status"));
        Port expired = new Port(); WearRefresh second = new WearRefresh(expired);
        second.request("phone", request(), 40000); assertTrue(expired.paths.isEmpty()); assertEquals(0, expired.replays);
    }
}
