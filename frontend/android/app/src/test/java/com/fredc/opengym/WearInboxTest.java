package com.fredc.opengym;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearInboxTest {
    static final class Memory implements WearInbox.Store {
        String value; boolean fail;
        public String read() { return value; }
        public void write(String next) throws Exception { if(fail) throw new Exception("disk full"); value=next; }
    }
    JSONObject packet(String id,int seq) throws Exception { return new JSONObject().put("v",1).put("requestId",id).put("seq",seq); }
    @Test public void exactContentSurvivesRestartAndSameRequestDifferentPayloadRemains() throws Exception {
        Memory disk=new Memory();WearInbox inbox=new WearInbox(disk);
        String a=inbox.offer("watch","command",packet("request",1));
        assertEquals(a,inbox.offer("watch","command",packet("request",1)));
        String b=inbox.offer("watch","command",packet("request",2));assertNotEquals(a,b);
        inbox=new WearInbox(disk);assertEquals(2,inbox.list("",64).length());
        assertFalse(inbox.remove(a,"other","command","request"));
        assertTrue(inbox.remove(a,"watch","command","request"));
        assertEquals(b,new WearInbox(disk).list("",64).getJSONObject(0).getString("key"));
    }
    @Test public void diskFailureDoesNotMutateEitherAdmissionOrRetirement() throws Exception {
        Memory disk=new Memory();WearInbox inbox=new WearInbox(disk);String key=inbox.offer("w","heart",packet("r",1));
        disk.fail=true;
        assertThrows(Exception.class,()->inbox.offer("w","heart",packet("s",2)));
        assertThrows(Exception.class,()->inbox.remove(key,"w","heart","r"));
        assertEquals(1,inbox.list("",64).length());
    }
    @Test public void fullAndCorruptStoresAreNeverSilentlyTruncated() throws Exception {
        Memory disk=new Memory();WearInbox inbox=new WearInbox(disk);
        assertThrows(Exception.class,()->inbox.offer("w","heart",packet("large",1).put("data","x".repeat(8*1024*1024))));
        assertEquals(0,inbox.list("",64).length());
        for(int i=0;i<512;i++) inbox.offer("w","command",packet("r"+i,i));
        assertThrows(Exception.class,()->inbox.offer("w","command",packet("extra",513)));
        assertEquals(64,inbox.list("",1000).length());
        disk.value="not json";assertThrows(Exception.class,()->new WearInbox(disk));
    }
}
