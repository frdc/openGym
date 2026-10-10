package com.fredc.opengym;

import org.junit.Test;
import static org.junit.Assert.*;

public class WearHeartJournalGuardTest {
    @Test public void ownersHaveStableSeparatePrivateKeys() {
        String a = WearHeartJournalGuard.ownerKey("local");
        assertEquals(a, WearHeartJournalGuard.ownerKey("local"));
        assertNotEquals(a, WearHeartJournalGuard.ownerKey("uid:another"));
        assertEquals(64, a.length());
        assertFalse(a.contains("local"));
        assertNull(WearHeartJournalGuard.ownerKey(""));
        assertNull(WearHeartJournalGuard.ownerKey(null));
    }
    @Test public void journalAndAcknowledgmentsAreBounded() {
        assertTrue(WearHeartJournalGuard.validJournal(200, 524288));
        assertFalse(WearHeartJournalGuard.validJournal(201, 50));
        assertFalse(WearHeartJournalGuard.validJournal(1, 524289));
        assertTrue(WearHeartJournalGuard.validAck("request", "token", "ok"));
        assertFalse(WearHeartJournalGuard.validAck("", "token", "ok"));
        assertFalse(WearHeartJournalGuard.validAck("request", "token", "anything"));
    }
}
