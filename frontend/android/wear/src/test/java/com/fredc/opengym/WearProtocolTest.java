package com.fredc.opengym;

import org.junit.Test;
import static org.junit.Assert.*;

public class WearProtocolTest {
    @Test public void remoteOpeningRequiresARecentActiveWorkoutRequest() {
        assertTrue(WearProtocol.canOpen(1, "request", 1000, 2000, true));
        assertFalse(WearProtocol.canOpen(1, "request", 1000, 32000, true));
        assertFalse(WearProtocol.canOpen(1, "", 1000, 2000, true));
        assertFalse(WearProtocol.canOpen(2, "request", 1000, 2000, true));
        assertFalse(WearProtocol.canOpen(1, "request", 1000, 2000, false));
    }
    @Test public void oldRevisionCannotReplaceNewState() {
        assertTrue(WearProtocol.acceptRevision("c", 2, "c", 2));
        assertFalse(WearProtocol.acceptRevision("c", 2, "c", 1));
        assertTrue(WearProtocol.acceptRevision("c", 2, "new", 1));
    }
    @Test public void restartedPhonePublisherCanResumeTheSameWorkout() {
        assertTrue(WearProtocol.acceptSnapshot("same", 80, "old-process", "same", 1, "new-process"));
        assertFalse(WearProtocol.acceptSnapshot("same", 80, "process", "same", 1, "process"));
        assertFalse(WearProtocol.acceptSnapshot("same", 80, "process", "same", 1, ""));
    }
    @Test public void controlsExpireAndNeverReusePendingCommands() {
        assertTrue(WearProtocol.canControl(true, 1000, 2000, false));
        assertFalse(WearProtocol.canControl(true, 1000, 14000, false));
        assertFalse(WearProtocol.canControl(true, 1000, 2000, true));
        assertFalse(WearProtocol.canControl(false, 1000, 2000, false));
    }
    @Test public void timerOnlyFiresForTheCurrentUnconsumedToken() {
        assertTrue(WearProtocol.shouldFire("a", "a", "", 1000, 1000));
        assertFalse(WearProtocol.shouldFire("a", "b", "", 1000, 1000));
        assertFalse(WearProtocol.shouldFire("a", "a", "a", 1000, 1000));
        assertFalse(WearProtocol.shouldFire("a", "a", "", 1000, 999));
    }
    @Test public void extensionRearmsAnAlreadyFiredTimerButDuplicatesDoNot() {
        assertTrue(WearProtocol.shouldArm("a:2000", "a:1000", "a:1000", false));
        assertFalse(WearProtocol.shouldArm("a:1000", "a:1000", "a:1000", false));
        assertFalse(WearProtocol.shouldArm("a:1000", "a:1000", "", true));
        assertTrue(WearProtocol.shouldArm("a:1000", "a:1000", "", false));
    }
}
