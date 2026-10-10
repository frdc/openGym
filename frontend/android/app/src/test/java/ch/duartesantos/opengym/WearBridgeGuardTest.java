package ch.duartesantos.opengym;

import org.junit.Test;
import static org.junit.Assert.*;

public class WearBridgeGuardTest {
    @Test public void remoteOpeningCannotRestoreAnOlderOwnerOrWorkout() {
        assertTrue(WearBridgeGuard.currentOpenRequest("new", 3, true, "new", 3));
        assertFalse(WearBridgeGuard.currentOpenRequest("new", 3, true, "old", 3));
        assertFalse(WearBridgeGuard.currentOpenRequest("new", 4, true, "new", 3));
        assertFalse(WearBridgeGuard.currentOpenRequest("new", 3, false, "new", 3));
    }
    @Test public void acceptsOnlyProtocolPathsAndLimitedPayloads() {
        assertTrue(WearBridgeGuard.allowed("/opengym/v1/heart", 16384));
        assertFalse(WearBridgeGuard.allowed("/opengym/v1/heart", 16385));
        assertTrue(WearBridgeGuard.allowed("/opengym/v1/command", 100));
        assertTrue(WearBridgeGuard.allowed("/opengym/v1/sync", 100));
        assertFalse(WearBridgeGuard.allowed("/other", 100));
        assertFalse(WearBridgeGuard.allowed("/opengym/v1/command", 16385));
        assertFalse(WearBridgeGuard.allowed("/opengym/v1/command", 0));
    }
    @Test public void onlyAnAcknowledgedOccurrenceSuppressesPhoneMirroring() {
        assertTrue(WearBridgeGuard.acknowledged("a:2000", "a", 2000));
        assertFalse(WearBridgeGuard.acknowledged("a:1000", "a", 2000));
        assertFalse(WearBridgeGuard.acknowledged("a:2000", "b", 2000));
        assertFalse(WearBridgeGuard.acknowledged("", "", 0));
    }
}
