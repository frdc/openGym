package com.fredc.opengym;

import android.content.Intent;
import android.os.SystemClock;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearWorkoutScreenTest {
    private Object field(WearActivity activity, String name) throws Exception {
        var field = WearActivity.class.getDeclaredField(name); field.setAccessible(true); return field.get(activity);
    }
    @Test public void idleWorkoutKeepsLiveSecondsAndTouchRestoresBrightness() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        // This fixture is only in Activity memory; never replace a real workout/cache.
        assertFalse("Run only without an active real workout",WearStateService.cached(instrumentation.getTargetContext()).optBoolean("active"));
        WearActivity activity = (WearActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            instrumentation.runOnMainSync(() -> { try {
                JSONObject current = new JSONObject().put("name","Teste de tela").put("setLabel","1/1").put("repsValue",10).put("loadValue",40).put("loadUnit","kg");
                var state = WearActivity.class.getDeclaredField("state"); state.setAccessible(true);
                state.set(activity,new JSONObject().put("active",true).put("current",current).put("heartCapture",new JSONObject().put("phase","effort").put("startedAt",System.currentTimeMillis())));
                var render = WearActivity.class.getDeclaredMethod("render"); render.setAccessible(true); render.invoke(activity);
                activity.onUserInteraction();
            } catch(Exception e) {throw new RuntimeException(e);} });
            SystemClock.sleep(16_000);
            instrumentation.runOnMainSync(() -> { try {
                assertEquals(0.03f,activity.getWindow().getAttributes().screenBrightness,0.001f);
                assertFalse((boolean)field(activity,"ambient"));
                String timer = ((TextView)field(activity,"rest")).getText().toString();
                int seconds = Integer.parseInt(timer.split(":")[1]);
                assertTrue("Seconds still advance in the dimmed view: " + timer,seconds>=15 && seconds<=20);
                activity.onUserInteraction();
                assertEquals(-1f,activity.getWindow().getAttributes().screenBrightness,0f);
                assertFalse((boolean)field(activity,"wristListening"));
            } catch(Exception e) {throw new RuntimeException(e);} });
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
