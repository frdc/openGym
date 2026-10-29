package com.fredc.opengym;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearSyncPullTest {
    @Test public void oneRequestAtATimeWithExactReplyAndBoundedExpiry() {
        WearSyncPull pull=new WearSyncPull();assertTrue(pull.request("first",1000));
        assertFalse(pull.request("second",1001));assertTrue(pull.matches("first"));
        assertFalse(pull.finish("other"));assertFalse(pull.request("third",5000));
        assertTrue(pull.request("replacement",6000));assertFalse(pull.finish("first"));
        assertTrue(pull.finish("replacement"));assertTrue(pull.request("next",6001));
    }
    @Test public void leavingActivityInvalidatesLateDiscoveryAndReplies() {
        WearSyncPull pull=new WearSyncPull();pull.request("old",0);pull.reset();
        assertFalse(pull.matches("old"));assertTrue(pull.request("new",1));assertFalse(pull.finish("old"));
        assertTrue(pull.matches("new"));assertFalse(pull.request("",2));
    }
}
