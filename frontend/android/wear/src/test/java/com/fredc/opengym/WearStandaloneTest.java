package com.fredc.opengym;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearStandaloneTest {
    private static final class MemoryStore implements WearStandalone.Store {
        String document;
        boolean fail;
        int writes, failAt = -1;
        public String read() { return document; }
        public boolean write(String value) { if (++writes == failAt || fail) return false; document = value; return true; }
    }

    private JSONObject step(int set, String side, int rest) throws Exception {
        return new JSONObject().put("entryIdx", 0).put("setIdx", set).put("side", side == null ? JSONObject.NULL : side)
            .put("name", "Squat").put("setLabel", (set + 1) + "/3").put("repsValue", 8).put("loadValue", 20)
            .put("loadUnit", "kg").put("loadLabel", "20 kg").put("repsLabel", "8 reps").put("canComplete", true)
            .put("canEdit", true).put("warmup", false).put("manualLoad", false).put("restAfterSec", rest);
    }

    private JSONObject snapshot() throws Exception {
        JSONArray steps = new JSONArray().put(step(0, "L", 0)).put(step(0, "R", 60)).put(step(1, "L", 60)).put(step(1, "R", 0));
        return new JSONObject().put("v", 1).put("active", true).put("contextToken", "session-one").put("revision", 1)
            .put("current", steps.getJSONObject(0)).put("timer", JSONObject.NULL)
            .put("standalone", new JSONObject().put("v", 1).put("sessionId", "session-one").put("baseline", "fingerprint")
                .put("steps", steps).put("cursor", 0).put("ack", JSONObject.NULL)
                .put("runtime", new JSONObject().put("effort", JSONObject.NULL).put("timer", JSONObject.NULL)));
    }

    private JSONObject event(String action, long at) throws Exception { return new JSONObject().put("action", action).put("at", at); }

    @Test public void startCompleteAndRestartAdvanceOriginalSidesAndKeepRestDeadline() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk);
        assertTrue(engine.receive(snapshot())); assertTrue(engine.available());
        assertTrue(engine.perform(event("start", 1000)));
        assertFalse(engine.view(snapshot()).has("heartCapture"));
        assertTrue(engine.perform(event("complete", 2000)));
        assertEquals("R", engine.view(snapshot()).getJSONObject("current").getString("side"));
        assertTrue(engine.view(snapshot()).isNull("timer"));
        assertTrue(engine.perform(event("start", 3000)));
        assertTrue(engine.perform(event("complete", 4000)));
        WearStandalone restored = new WearStandalone(disk);
        assertEquals(4, restored.pending());
        assertEquals(1, restored.view(snapshot()).getJSONObject("current").getInt("setIdx"));
        assertEquals("L", restored.view(snapshot()).getJSONObject("current").getString("side"));
        assertEquals(64000, restored.view(snapshot()).getJSONObject("timer").getLong("endsAt"));
        assertEquals(4, restored.packet().getJSONArray("events").length());
    }

    @Test public void effortAndRestPauseResumeAndPlus15UseEventTimes() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); engine.receive(snapshot());
        assertTrue(engine.perform(event("start", 1000).put("heart", true)));
        String token = engine.packet().getJSONArray("events").getJSONObject(0).getString("id");
        assertEquals(token, engine.view(snapshot()).getJSONObject("effort").getString("token"));
        assertTrue(engine.perform(event("pause-effort", 3500)));
        assertEquals(2500, engine.view(snapshot()).getJSONObject("effort").getLong("elapsedMs"));
        assertTrue(engine.perform(event("resume-effort", 7000)));
        assertTrue(engine.perform(event("complete", 8000)));
        engine.perform(event("start", 9000)); engine.perform(event("complete", 10000));
        assertTrue(engine.perform(event("pause", 20000)));
        assertEquals(50000, engine.view(snapshot()).getJSONObject("timer").getLong("leftMs"));
        assertTrue(engine.perform(event("plus15", 25000)));
        assertEquals(65000, engine.view(snapshot()).getJSONObject("timer").getLong("leftMs"));
        assertTrue(engine.perform(event("resume", 30000)));
        assertEquals(95000, engine.view(snapshot()).getJSONObject("timer").getLong("endsAt"));
        assertTrue(engine.perform(event("skip", 35000)));
        assertTrue(engine.view(snapshot()).isNull("timer"));
    }

    @Test public void decimalEditsCascadeOnlySameSideAndKeepExplicitLaterLoads() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot();
        remote.getJSONObject("standalone").getJSONArray("steps").getJSONObject(3).put("manualLoad", true);
        engine.receive(remote);
        assertTrue(engine.perform(event("edit-set", 1000).put("field", "w").put("value", 22.5).put("unit", "kg")));
        assertEquals(22.5, engine.view(remote).getJSONObject("current").getDouble("loadValue"), 0);
        JSONArray steps = engine.view(remote).getJSONObject("standalone").getJSONArray("steps");
        assertEquals(22.5, steps.getJSONObject(2).getDouble("loadValue"), 0);
        assertEquals(20, steps.getJSONObject(1).getDouble("loadValue"), 0);
        assertEquals(20, steps.getJSONObject(3).getDouble("loadValue"), 0);
        assertFalse(engine.perform(event("edit-set", 2000).put("field", "r").put("value", 8.5)));
        assertFalse(engine.perform(event("edit-set", 2000).put("field", "w").put("value", 23).put("unit", "lb")));
        assertEquals(1, engine.pending());
    }

    @Test public void failedWriteLeavesRuntimeAndJournalUnchanged() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk); engine.receive(snapshot());
        disk.fail = true;
        assertFalse(engine.perform(event("start", 1000))); assertEquals(0, engine.pending());
        assertTrue(engine.view(snapshot()).isNull("effort"));
        disk.fail = false;
        assertTrue(engine.perform(event("start", 2000)));
        assertEquals(1, engine.packet().getJSONArray("events").getJSONObject(0).getInt("seq"));
    }

    @Test public void lateSnapshotsAndWrongReceiptsCannotRollbackOrRetireLocalActions() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000)); engine.perform(event("complete", 2000));
        JSONObject packet = engine.packet();
        assertTrue(engine.receive(remote)); assertEquals("R", engine.view(remote).getJSONObject("current").getString("side"));
        JSONObject ack = new JSONObject().put("v", 1).put("status", "ok").put("requestId", packet.getString("requestId"))
            .put("streamId", "wrong").put("seq", 2);
        assertFalse(engine.acknowledge(ack)); assertEquals(2, engine.pending());
        ack.put("streamId", packet.getString("streamId")).put("seq", 1);
        assertFalse(engine.acknowledge(ack)); assertEquals(2, engine.pending());
        ack.put("seq", 2); assertTrue(engine.acknowledge(ack)); assertEquals(0, engine.pending());
        assertTrue(engine.receive(remote)); assertEquals("R", engine.view(remote).getJSONObject("current").getString("side"));
        assertNull(engine.packet());
    }

    @Test public void accountReplacementAndBaselineConflictPreservePendingUntilExplicitDiscard() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000));
        JSONObject other = snapshot().put("contextToken", "other"); other.getJSONObject("standalone").put("sessionId", "other");
        assertTrue(engine.receive(other)); assertTrue(engine.conflicted()); assertFalse(engine.available()); assertEquals(1, engine.pending());
        assertEquals("session-one", new WearStandalone(disk).view(other).getString("contextToken"));
        assertNull(engine.packet()); assertFalse(engine.perform(event("complete", 2000)));
        assertTrue(engine.discard()); assertTrue(engine.receive(other)); assertTrue(engine.available());
        assertEquals("other", engine.view(other).getString("contextToken"));
    }

    @Test public void returningToTheSamePreparedSessionUnblocksStaleContextWithoutLosingItsJournal() throws Exception {
        for (boolean replyConflict : new boolean[] {false, true}) {
            MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk);
            JSONObject remote = snapshot().put("publisherId", "original").put("revision", 10);
            assertTrue(engine.receive(remote));
            assertTrue(engine.perform(event("start", 1000).put("heart", true)));
            assertTrue(engine.perform(event("complete", 2000)));
            JSONObject packet = engine.packet();
            if (replyConflict) {
                assertTrue(engine.acknowledge(new JSONObject().put("v", 1).put("streamId", packet.getString("streamId"))
                    .put("requestId", packet.getString("requestId")).put("status", "error").put("code", "stale-context")));
            } else assertTrue(engine.receive(new JSONObject().put("v", 1).put("active", false).put("localReady", true)));
            assertTrue(engine.conflicted()); assertNull(engine.packet());
            JSONObject restored = new JSONObject(remote.toString()).put("publisherId", "restarted").put("revision", 1);
            assertTrue(engine.receive(restored));
            assertFalse("Returning owner with the same baseline must be able to replay", engine.conflicted());
            assertEquals(2, engine.pending()); assertEquals(packet.toString(), engine.packet().toString());
            assertTrue(engine.view(restored).has("heartCapture"));
        }
    }

    @Test public void staleContextDoesNotUnblockForAnotherBaselineOrAnOlderSnapshot() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk);
        JSONObject remote = snapshot().put("publisherId", "original").put("revision", 10);
        engine.receive(remote); engine.perform(event("start", 1000));
        engine.receive(new JSONObject().put("v", 1).put("active", false).put("localReady", true));
        JSONObject changed = new JSONObject(remote.toString()); changed.getJSONObject("standalone").put("baseline", "edited");
        assertTrue(engine.receive(changed)); assertTrue(engine.conflicted()); assertNull(engine.packet());
        assertTrue(engine.receive(new JSONObject(remote.toString()).put("revision", 9)));
        assertTrue(engine.conflicted()); assertEquals(1, engine.pending()); assertNull(engine.packet());
    }

    @Test public void returningSnapshotCannotClearARealBaselineConflict() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot();
        engine.receive(remote); engine.perform(event("start", 1000));
        JSONObject changed = new JSONObject(remote.toString()); changed.getJSONObject("standalone").put("baseline", "edited");
        engine.receive(changed); assertTrue(engine.conflicted());
        assertTrue(engine.receive(remote)); assertTrue(engine.conflicted());
        assertEquals(1, engine.pending()); assertNull(engine.packet());
    }

    @Test public void failedStreamConflictWriteCannotPersistAnUnblockedJournal() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk);
        engine.receive(snapshot()); engine.perform(event("start", 1000));
        engine.receive(new JSONObject().put("v", 1).put("active", false).put("localReady", true));
        JSONObject otherStream = snapshot();
        otherStream.getJSONObject("standalone").put("ack", new JSONObject().put("streamId", "another-stream").put("seq", 0));
        disk.failAt = disk.writes + 2;
        assertFalse(engine.receive(otherStream));
        WearStandalone restored = new WearStandalone(disk);
        assertTrue("Failed validation write must leave the old blocking conflict durable", restored.conflicted());
        assertEquals(1, restored.pending()); assertNull(restored.packet());
    }

    @Test public void packetsHaveStableIdsAndAtMost64OrderedEvents() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); engine.receive(snapshot());
        for (int i = 0; i < 70; i++) assertTrue(engine.perform(event("edit-set", 1000 + i).put("field", "r").put("value", i)));
        JSONObject first = engine.packet(); assertEquals(64, first.getJSONArray("events").length());
        assertEquals(first.toString(), engine.packet().toString());
        assertEquals(first.getJSONArray("events").getJSONObject(63).getString("id"), first.getString("requestId"));
        assertTrue(engine.acknowledge(new JSONObject().put("v", 1).put("status", "ok").put("streamId", first.getString("streamId")).put("requestId", first.getString("requestId")).put("seq", 64)));
        assertEquals(65, engine.packet().getJSONArray("events").getJSONObject(0).getInt("seq"));
        assertEquals(6, engine.pending());
    }

    @Test public void newExerciseSnapshotRetiresOnlyItsDurableReceiptBeforeReplacingCompletedSequence() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        for (int i = 0; i < 4; i++) {
            assertTrue(engine.perform(event("start", 1000 + i * 2000)));
            assertTrue(engine.perform(event("complete", 2000 + i * 2000)));
        }
        JSONObject packet = engine.packet();
        assertTrue(engine.view(remote).isNull("current"));
        JSONObject added = snapshot().put("revision", 3);
        JSONObject next = added.getJSONObject("standalone");
        next.put("baseline", "exercise-added").put("steps", new JSONArray().put(step(0, null, 0).put("entryIdx", 1)))
            .put("receipt", new JSONObject().put("streamId", packet.getString("streamId")).put("baseline", "fingerprint")
                .put("seq", 8).put("requestId", packet.getString("requestId")));
        assertTrue(engine.receive(added));
        assertFalse(engine.conflicted()); assertEquals(0, engine.pending());
        assertEquals(1, engine.view(added).getJSONObject("current").getInt("entryIdx"));
        assertTrue(engine.perform(event("start", 10000)));
        assertEquals("exercise-added", engine.packet().getString("baseline"));
    }

    @Test public void aReceiptCannotDiscardActionsBeyondItsConfirmedPrefix() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000).put("heart", true)); engine.perform(event("complete", 2000));
        JSONObject packet = engine.packet(), added = snapshot().put("revision", 3);
        added.getJSONObject("standalone").put("baseline", "exercise-added").put("receipt", new JSONObject()
            .put("streamId", packet.getString("streamId")).put("baseline", "fingerprint").put("seq", 1)
            .put("requestId", packet.getJSONArray("events").getJSONObject(0).getString("id")));
        assertTrue(engine.receive(added)); assertTrue(engine.conflicted()); assertEquals(1, engine.pending());
        assertEquals("recovery", engine.view(added).getJSONObject("heartCapture").getString("phase"));
    }

    @Test public void unsupportedOrOversizeSnapshotsNeverOfferLocalControls() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot();
        remote.getJSONObject("standalone").getJSONArray("steps").getJSONObject(0).put("canComplete", false);
        assertTrue(engine.receive(remote)); assertFalse(engine.perform(event("start", 1000))); assertEquals(0, engine.pending());
        engine.discard();
        JSONObject tooMany = snapshot(); JSONArray steps = tooMany.getJSONObject("standalone").getJSONArray("steps");
        while (steps.length() <= 200) steps.put(step(steps.length(), null, 60));
        assertFalse(engine.receive(tooMany));
        assertFalse(engine.receive(snapshot().put("padding", "x".repeat(128 * 1024))));
    }

    @Test public void heartMarkersSurviveUnacknowledgedCompletionThenFollowConfirmedPhoneState() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000).put("heart", true)); engine.perform(event("complete", 4000));
        JSONObject view = engine.view(remote), packet = engine.packet();
        String token = packet.getJSONArray("events").getJSONObject(0).getString("id");
        assertEquals("recovery", view.getJSONObject("heartCapture").getString("phase"));
        assertEquals(3000, view.getJSONObject("heartCapture").getLong("effortEndMs"));
        assertEquals(token, view.getJSONArray("heartAuthorizedTokens").getString(0));
        JSONObject confirmed = engine.view(remote).put("revision", 2).put("heartCapture", JSONObject.NULL).put("heartAuthorizedTokens", new JSONArray());
        confirmed.getJSONObject("standalone").put("ack", new JSONObject().put("streamId", packet.getString("streamId")).put("seq", 2));
        assertTrue(engine.receive(confirmed)); assertTrue(engine.receive(confirmed));
        assertTrue(engine.view(confirmed).isNull("heartCapture"));
        assertEquals(0, engine.view(confirmed).getJSONArray("heartAuthorizedTokens").length());
    }

    @Test public void lostReceiptSnapshotOnlyAcknowledgesItsPrefixWithoutChangingLocalCursor() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000)); engine.perform(event("complete", 2000)); engine.perform(event("start", 3000));
        JSONObject packet = engine.packet();
        remote.getJSONObject("standalone").put("ack", new JSONObject().put("streamId", packet.getString("streamId")).put("seq", 2));
        assertTrue(engine.receive(remote)); assertEquals(1, engine.pending());
        assertEquals(1, engine.view(remote).getJSONObject("standalone").getInt("cursor"));
        assertEquals(3000, engine.view(remote).getJSONObject("effort").getLong("startedAt"));
        assertEquals(3, engine.packet().getJSONArray("events").getJSONObject(0).getInt("seq"));
    }

    @Test public void bootSnapshotAndTransientReplyKeepPendingActionsUsable() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote); engine.perform(event("start", 1000));
        assertTrue(engine.receive(new JSONObject().put("v", 1).put("active", false).put("localReady", false)));
        JSONObject packet = engine.packet();
        assertFalse(engine.acknowledge(new JSONObject().put("v", 1).put("status", "rejected").put("code", "unavailable").put("streamId", packet.getString("streamId")).put("requestId", packet.getString("requestId"))));
        assertFalse(engine.conflicted()); assertTrue(engine.available()); assertEquals(1, engine.pending());
    }

    @Test public void confirmedOldErrorCannotConflictLaterWorkAndNewPhoneEditCanRebase() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote); engine.perform(event("start", 1000));
        JSONObject packet = engine.packet(), ack = new JSONObject().put("v", 1).put("status", "ok").put("seq", 1).put("streamId", packet.getString("streamId")).put("requestId", packet.getString("requestId"));
        assertTrue(engine.acknowledge(ack));
        assertFalse(engine.acknowledge(new JSONObject(ack.toString()).put("status", "rejected").put("code", "state-conflict")));
        assertFalse(engine.conflicted());
        JSONObject changed = snapshot().put("revision", 2); changed.getJSONObject("standalone").put("baseline", "phone-edited");
        assertTrue(engine.receive(changed)); assertTrue(engine.view(changed).isNull("effort"));
        assertTrue(engine.perform(event("start", 2000)));
        assertEquals("phone-edited", engine.packet().getString("baseline"));
        assertNotEquals(packet.getString("streamId"), engine.packet().getString("streamId"));
    }

    @Test public void invalidEventsAndUnsupportedNextStepCannotAdvanceOrCreateJournalEntries() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot();
        remote.getJSONObject("standalone").getJSONArray("steps").getJSONObject(1).put("canComplete", false);
        engine.receive(remote);
        assertFalse(engine.perform(event("complete", 1000))); assertFalse(engine.perform(event("start", 0)));
        assertFalse(engine.perform(event("start", 1000).put("step", 1)));
        assertTrue(engine.perform(event("start", 2000)));
        assertFalse(engine.perform(event("pause-effort", 1999))); assertFalse(engine.perform(event("start", 3000)));
        assertTrue(engine.perform(event("complete", 3000)));
        assertFalse(engine.perform(event("start", 4000))); assertFalse(engine.perform(event("complete", 4000)));
        assertEquals(1, engine.view(remote).getJSONObject("standalone").getInt("cursor")); assertEquals(2, engine.pending());
    }

    @Test public void expiredRestCanBeExtendedAndStartingNextSetEndsIt() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot(); engine.receive(remote);
        engine.perform(event("start", 1000)); engine.perform(event("complete", 2000)); engine.perform(event("start", 3000)); engine.perform(event("complete", 4000));
        assertTrue(engine.perform(event("plus15", 100000)));
        assertEquals(115000, engine.view(remote).getJSONObject("timer").getLong("endsAt"));
        assertTrue(engine.perform(event("start", 101000))); assertTrue(engine.view(remote).isNull("timer"));
        assertTrue(engine.perform(event("cancel-effort", 102000))); assertTrue(engine.view(remote).isNull("effort"));
        assertEquals(2, engine.view(remote).getJSONObject("standalone").getInt("cursor"));
    }

    @Test public void failedAcknowledgmentWriteDoesNotRetirePendingPacket() throws Exception {
        MemoryStore disk = new MemoryStore(); WearStandalone engine = new WearStandalone(disk); engine.receive(snapshot()); engine.perform(event("start", 1000));
        JSONObject packet = engine.packet(), ack = new JSONObject().put("v", 1).put("status", "ok").put("seq", 1).put("streamId", packet.getString("streamId")).put("requestId", packet.getString("requestId"));
        disk.fail = true; assertFalse(engine.acknowledge(ack)); assertEquals(packet.toString(), engine.packet().toString());
        disk.fail = false; assertTrue(engine.acknowledge(ack)); assertEquals(0, engine.pending());
    }

    @Test public void restoredPhoneCheckpointContinuesItsStreamAndOriginalStepIndex() throws Exception {
        JSONObject remote = snapshot(), standalone = remote.getJSONObject("standalone");
        standalone.put("cursor", 2).put("ack", new JSONObject().put("streamId", "persisted-stream").put("seq", 7));
        WearStandalone engine = new WearStandalone(new MemoryStore()); assertTrue(engine.receive(remote));
        assertEquals("L", engine.view(remote).getJSONObject("current").getString("side"));
        assertTrue(engine.perform(event("start", 10000)));
        JSONObject packet = engine.packet(); assertEquals("persisted-stream", packet.getString("streamId"));
        assertEquals(8, packet.getJSONArray("events").getJSONObject(0).getInt("seq"));
        assertEquals(2, packet.getJSONArray("events").getJSONObject(0).getInt("step"));
    }

    @Test public void malformedRuntimeAndSourceValuesAreRejectedBeforeReplacingPreparedSession() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject malformed = snapshot();
        malformed.getJSONObject("standalone").getJSONObject("runtime").put("effort", new JSONObject().put("token", "x").put("startedAt", -1));
        assertFalse(engine.receive(malformed)); assertFalse(engine.available());
        malformed = snapshot(); malformed.getJSONObject("standalone").getJSONArray("steps").getJSONObject(0).put("loadUnit", "g");
        assertFalse(engine.receive(malformed)); assertFalse(engine.available());
    }

    @Test public void eventLimitRejectsTheNextActionWithoutLosingExistingJournal() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); engine.receive(snapshot());
        for (int i = 0; i < 1024; i++) assertTrue(engine.perform(event("edit-set", 1000 + i).put("field", "r").put("value", 8)));
        assertFalse(engine.perform(event("start", 3000))); assertEquals(1024, engine.pending());
        assertTrue(engine.view(snapshot()).isNull("effort")); assertEquals(1, engine.packet().getJSONArray("events").getJSONObject(0).getInt("seq"));
    }

    @Test public void plus15CapsRunningAndPausedRestAtThePhoneMaximum() throws Exception {
        WearStandalone engine = new WearStandalone(new MemoryStore()); JSONObject remote = snapshot();
        remote.getJSONObject("standalone").getJSONArray("steps").getJSONObject(0).put("restAfterSec", 900);
        engine.receive(remote); engine.perform(event("start", 1000)); engine.perform(event("complete", 2000));
        assertTrue(engine.perform(event("plus15", 2000)));
        assertEquals(902000, engine.view(remote).getJSONObject("timer").getLong("endsAt"));
        assertTrue(engine.perform(event("pause", 3000))); assertTrue(engine.perform(event("plus15", 4000)));
        assertEquals(900000, engine.view(remote).getJSONObject("timer").getLong("leftMs"));
        assertTrue(engine.perform(event("resume", 5000)));
        assertEquals(905000, engine.view(remote).getJSONObject("timer").getLong("endsAt"));
    }

    @Test public void authoritativePhoneRestCanBeControlledAndItsConcurrentChangePreservesWatchWork() throws Exception {
        JSONObject remote = snapshot(); remote.getJSONObject("standalone").getJSONObject("runtime").put("timer",
            new JSONObject().put("timerToken", "phone-rest").put("endsAt", 61000).put("leftMs", 60000).put("paused", false).put("ready", false));
        WearStandalone engine = new WearStandalone(new MemoryStore()); assertTrue(engine.receive(remote));
        assertEquals("phone-rest", engine.view(remote).getJSONObject("timer").getString("timerToken"));
        assertTrue(engine.perform(event("pause", 2000))); assertEquals(59000, engine.view(remote).getJSONObject("timer").getLong("leftMs"));
        JSONObject changed = snapshot().put("revision", 2); changed.getJSONObject("standalone").put("baseline", "phone-skipped-rest");
        assertTrue(engine.receive(changed)); assertTrue(engine.conflicted()); assertEquals(1, engine.pending());
        assertTrue(engine.view(changed).getJSONObject("timer").getBoolean("paused"));
        WearStandalone clean = new WearStandalone(new MemoryStore()); clean.receive(remote);
        assertTrue(clean.receive(changed)); assertFalse(clean.conflicted()); assertTrue(clean.view(changed).isNull("timer"));
    }
}
