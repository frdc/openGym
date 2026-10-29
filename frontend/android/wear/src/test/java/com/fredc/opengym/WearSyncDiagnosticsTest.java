package com.fredc.opengym;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearSyncDiagnosticsTest {
    @Test public void recordsCountersAgeQueueAndLastApplicationErrorWithoutPayloads() throws Exception {
        WearSyncDiagnostics trace=new WearSyncDiagnostics();trace.event("discover","",0);trace.event("sync-send","",100);
        trace.received(7,200);trace.ack(2,"field-conflict",300);
        JSONObject view=trace.snapshot(2200,5,2);
        assertEquals(1,view.getInt("requests"));assertEquals(1,view.getInt("sent"));assertEquals(1,view.getInt("received"));
        assertEquals(2,view.getInt("stateAgeSec"));assertEquals(7,view.getInt("revision"));assertEquals(2,view.getInt("ackSeq"));
        assertEquals(5,view.getInt("actions"));assertEquals(2,view.getInt("hearts"));assertEquals("field-conflict",view.getString("error"));
        trace.event("visible","",2300);assertEquals("field-conflict",trace.snapshot(2300,0,0).getString("error"));
    }
    @Test public void diagnosticInputCannotEchoWorkoutNamesTokensOrArbitraryErrors() throws Exception {
        WearSyncDiagnostics trace=new WearSyncDiagnostics();trace.event("private-session-token","Fred supino 333kg",1);
        String text=trace.snapshot(2,-1,-1).toString();assertFalse(text.contains("private-session-token"));assertFalse(text.contains("Fred"));assertFalse(text.contains("333"));
        assertEquals(-1,trace.snapshot(2,0,0).getInt("stateAgeSec"));assertEquals(0,trace.snapshot(2,-1,-1).getInt("actions"));
    }
}
