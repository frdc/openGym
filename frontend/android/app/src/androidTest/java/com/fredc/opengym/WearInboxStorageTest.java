package com.fredc.opengym;

import androidx.test.platform.app.InstrumentationRegistry;
import android.util.AtomicFile;
import java.io.File;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Isolated real AtomicFile: never opens the user's production inbox. */
public class WearInboxStorageTest {
    @Test public void reopeningAndRetiringOneExactPacketPreservesAnotherSnapshot() throws Exception {
        File path=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"inbox-qa-"+UUID.randomUUID()+".json");
        try {
            WearInbox inbox=WearInboxStore.open(path);
            JSONObject payload=new JSONObject().put("v",1).put("requestId","same-request").put("events",1);
            String first=inbox.offer("watch","command",payload);
            String second=inbox.offer("watch","command",new JSONObject(payload.toString()).put("events",2));
            WearInbox reopened=WearInboxStore.open(path);assertEquals(2,reopened.list("",64).length());
            assertTrue(reopened.remove(first,"watch","command","same-request"));
            assertEquals(second,WearInboxStore.open(path).list("",64).getJSONObject(0).getString("key"));
        } finally {new AtomicFile(path).delete();}
    }
}
