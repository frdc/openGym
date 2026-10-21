package com.fredc.opengym;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Proxy;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Exercises the real Android preference commit boundary, including its memory-first behavior. */
public class WearStandaloneStoreTest {
    private Context isolated(String prefix, boolean[] failCommit) {
        Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        return new ContextWrapper(base) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                SharedPreferences preferences = base.getSharedPreferences(prefix + name, mode);
                return (SharedPreferences) Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(), new Class<?>[] { SharedPreferences.class }, (proxy, method, args) -> {
                    if (!method.getName().equals("edit")) return method.invoke(preferences, args);
                    SharedPreferences.Editor editor = preferences.edit();
                    return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(), new Class<?>[] { SharedPreferences.Editor.class }, (editorProxy, operation, values) -> {
                        Object result = operation.invoke(editor, values);
                        if (operation.getName().equals("commit") && name.equals("wear-standalone") && failCommit[0]) return false;
                        return result == editor ? editorProxy : result;
                    });
                });
            }
        };
    }
    private JSONObject snapshot() throws Exception {
        JSONObject first = new JSONObject().put("entryIdx", 0).put("setIdx", 0).put("side", JSONObject.NULL).put("canComplete", true).put("canEdit", true)
            .put("repsValue", 8).put("loadValue", 20).put("loadUnit", "kg").put("restAfterSec", 60);
        JSONObject second = new JSONObject(first.toString()).put("setIdx", 1).put("restAfterSec", 0);
        return new JSONObject().put("v", 1).put("active", true).put("contextToken", "session").put("revision", 1)
            .put("standalone", new JSONObject().put("v", 1).put("sessionId", "session").put("baseline", "baseline").put("cursor", 0)
                .put("steps", new JSONArray().put(first).put(second)).put("ack", JSONObject.NULL)
                .put("runtime", new JSONObject().put("effort", JSONObject.NULL).put("timer", JSONObject.NULL)));
    }
    @Test public void committedJournalAndAbsoluteTimerSurviveNewContext() throws Exception {
        String prefix = "standalone-test-" + UUID.randomUUID(); boolean[] fail = {false};
        Context context = isolated(prefix, fail); JSONObject remote = snapshot(); long now = System.currentTimeMillis();
        try {
            assertTrue(WearStandalone.receive(context, remote));
            assertTrue(WearStandalone.perform(context, new JSONObject().put("action", "start").put("at", now)));
            assertTrue(WearStandalone.perform(context, new JSONObject().put("action", "complete").put("at", now + 1000)));
            Context restored = isolated(prefix, fail);
            assertEquals(2, WearStandalone.pending(restored));
            assertEquals(1, WearStandalone.view(restored, remote).getJSONObject("current").getInt("setIdx"));
            assertEquals(now + 61000, WearStandalone.view(restored, remote).getJSONObject("timer").getLong("endsAt"));
            assertEquals(WearStandalone.packet(context).toString(), WearStandalone.packet(restored).toString());
        } finally { fail[0] = false; context.getSharedPreferences("wear-standalone", Context.MODE_PRIVATE).edit().clear().commit(); }
    }
    @Test public void failedCommitRollsBackPreferenceMemoryBeforeReturningFailure() throws Exception {
        String prefix = "standalone-test-" + UUID.randomUUID(); boolean[] fail = {false};
        Context context = isolated(prefix, fail); JSONObject remote = snapshot();
        try {
            assertTrue(WearStandalone.receive(context, remote)); fail[0] = true;
            assertFalse(WearStandalone.perform(context, new JSONObject().put("action", "start").put("at", System.currentTimeMillis())));
            assertEquals(0, WearStandalone.pending(context)); assertTrue(WearStandalone.view(context, remote).isNull("effort"));
            assertNull(WearStandalone.packet(isolated(prefix, fail)));
        } finally { fail[0] = false; context.getSharedPreferences("wear-standalone", Context.MODE_PRIVATE).edit().clear().commit(); }
    }
    @Test public void stateServiceRejectsFailedStandaloneUpdateAndCanRetryTheSameSnapshot() throws Exception {
        String prefix = "standalone-test-" + UUID.randomUUID(); boolean[] fail = {false};
        Context context = isolated(prefix, fail); JSONObject remote = snapshot(); long now = System.currentTimeMillis();
        try {
            assertTrue(WearStateService.receive(context, remote, now));
            JSONObject updated = snapshot().put("revision", 2);
            updated.getJSONObject("standalone").put("baseline", "added-exercise");
            fail[0] = true;
            assertFalse("Remote-state persistence alone must not confirm application", WearStateService.receive(context, updated, now + 1));
            assertEquals(2, WearStateService.remote(context).getInt("revision"));
            assertEquals(1, WearStateService.cached(context).getInt("revision"));
            assertEquals(0, WearStandalone.pending(context));
            fail[0] = false;
            assertTrue(WearStateService.receive(context, updated, now + 1));
            assertEquals(2, WearStateService.cached(context).getInt("revision"));
        } finally {
            fail[0] = false;
            context.getSharedPreferences("wear-state", Context.MODE_PRIVATE).edit().clear().commit();
            context.getSharedPreferences("wear-standalone", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
