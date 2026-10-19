package com.fredc.opengym;

import android.content.Intent;
import android.view.View;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearStandaloneUiTest {
    private void field(WearActivity activity, String name, Object value) throws Exception {
        var f = WearActivity.class.getDeclaredField(name); f.setAccessible(true); f.set(activity, value);
    }
    private void render(WearActivity activity) throws Exception {
        var m = WearActivity.class.getDeclaredMethod("render"); m.setAccessible(true); m.invoke(activity);
    }
    private JSONObject fixture() throws Exception {
        JSONArray steps = new JSONArray();
        for (int i = 0; i < 2; i++) steps.put(new JSONObject().put("entryIdx",0).put("setIdx",i).put("side",JSONObject.NULL)
            .put("name","Supino").put("setLabel",(i+1)+"/2").put("repsValue",10).put("loadValue",32.2)
            .put("loadUnit","kg").put("loadStep",6.8).put("loadStart",11.8).put("repsStep",1)
            .put("canComplete",true).put("canEdit",true).put("restAfterSec",30));
        return new JSONObject().put("v",1).put("active",true).put("contextToken","standalone-ui").put("revision",1)
            .put("current",steps.getJSONObject(0)).put("vibrate",false).put("timer",JSONObject.NULL)
            .put("standalone",new JSONObject().put("v",1).put("sessionId","standalone-ui").put("baseline","ui-baseline")
                .put("steps",steps).put("cursor",0).put("ack",JSONObject.NULL)
                .put("runtime",new JSONObject().put("effort",JSONObject.NULL).put("timer",JSONObject.NULL)));
    }
    @Test public void disconnectedWatchStartsSavesRestsAndContinuesWithoutHeart() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation(); var ctx = instrumentation.getTargetContext();
        ctx.getSharedPreferences("wear-state",0).edit().clear().commit();
        ctx.getSharedPreferences("wear-standalone",0).edit().clear().commit(); WearOutbox.clear(ctx);
        assertTrue(WearStateService.receive(ctx,fixture(),System.currentTimeMillis()));
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(ctx,WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            WearHeartService.running = false;
            field(activity,"phone",""); field(activity,"confirmedAt",0L); render(activity);
            View root = activity.getWindow().getDecorView();
            assertTrue("Start must work with the phone screen off or disconnected",root.findViewWithTag("main-action").isEnabled());
            root.findViewWithTag("main-action").performClick();
            assertEquals(activity.getString(R.string.complete),((TextView)root.findViewWithTag("main-action")).getText().toString().trim());
            root.findViewWithTag("main-action").performClick();
            assertNotNull("Saving starts rest on the watch",root.findViewWithTag("rest-pause"));
            assertTrue(root.findViewWithTag("rest-pause").isEnabled());
            root.findViewWithTag("rest-pause").performClick();
            assertTrue(WearStateService.cached(ctx).getJSONObject("timer").getBoolean("paused"));
            root.findViewWithTag("rest-pause").performClick();
            assertFalse(WearStateService.cached(ctx).getJSONObject("timer").getBoolean("paused"));
            root.findViewWithTag("rest-skip").performClick();
            assertEquals(1,WearStateService.cached(ctx).getJSONObject("current").getInt("setIdx"));
            assertTrue(root.findViewWithTag("main-action").isEnabled());
            root.findViewWithTag("main-action").performClick();
            assertNotNull(WearStateService.cached(ctx).optJSONObject("effort"));
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); ctx.getSharedPreferences("wear-standalone",0).edit().clear().commit(); ctx.getSharedPreferences("wear-state",0).edit().clear().commit(); }
    }
}
