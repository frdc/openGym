package com.fredc.opengym;

import android.content.Intent;
import android.os.SystemClock;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearStartHeartUiTest {
    private void set(WearActivity activity, String name, Object value) throws Exception {
        var field = WearActivity.class.getDeclaredField(name); field.setAccessible(true); field.set(activity, value);
    }
    private void render(WearActivity activity) throws Exception {
        var method = WearActivity.class.getDeclaredMethod("render"); method.setAccessible(true); method.invoke(activity);
    }
    @Test public void startIsVisibleBeforeEnablingHeartAndReadingStaysOnWorkout() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            set(activity, "state", new JSONObject().put("active", true).put("contextToken", "fixture")
                .put("current", new JSONObject().put("name", "Supino").put("setLabel", "1/3").put("canComplete", true)));
            set(activity, "phone", "phone"); set(activity, "confirmedAt", SystemClock.elapsedRealtime());
            WearHeartService.running = false;
            render(activity);
            var root = activity.getWindow().getDecorView();
            assertNotNull("Primary start is available before opening sensor settings", root.findViewWithTag("main-action"));
            assertTrue(root.findViewWithTag("main-action").isEnabled());
            assertEquals(activity.getString(R.string.heart_start_short), ((TextView) root.findViewWithTag("main-action")).getText().toString());
            WearHeartService.running = true; WearHeartService.latestBpm = 0; WearHeartService.latestElapsed = 0;
            render(activity);
            assertFalse("Wait for the first sensor sample before marking effort", root.findViewWithTag("main-action").isEnabled());
            WearHeartService.running = true; WearHeartService.latestBpm = 112; WearHeartService.latestElapsed = SystemClock.elapsedRealtime();
            render(activity);
            TextView reading = root.findViewWithTag("heart-status");
            assertNotNull("Small heart status is visible on the workout", reading);
            assertEquals(android.graphics.Color.rgb(255,59,79), reading.getCurrentTextColor());
            assertEquals(activity.getString(R.string.heart_receiving),reading.getContentDescription());
            assertTrue(root.findViewWithTag("main-action").isEnabled());
            WearHeartService.latestElapsed = SystemClock.elapsedRealtime() - 20000;
            render(activity);
            reading = root.findViewWithTag("heart-status");
            assertEquals("Old readings turn the status gray", android.graphics.Color.GRAY, reading.getCurrentTextColor());
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally {
            WearHeartService.running = false; WearHeartService.latestBpm = 0; WearHeartService.latestElapsed = 0;
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
