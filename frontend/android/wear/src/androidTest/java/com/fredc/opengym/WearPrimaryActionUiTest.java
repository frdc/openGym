package com.fredc.opengym;

import android.content.Intent;
import android.os.SystemClock;
import android.widget.Button;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearPrimaryActionUiTest {
    private void set(WearActivity activity, String name, Object value) throws Exception {
        var field = WearActivity.class.getDeclaredField(name); field.setAccessible(true); field.set(activity, value);
    }
    private void render(WearActivity activity) throws Exception {
        var method = WearActivity.class.getDeclaredMethod("render"); method.setAccessible(true); method.invoke(activity);
    }
    @Test public void primaryStartsBeforeSensorConsentAndManualCompletionRemainsAvailable() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        boolean running = WearHeartService.running;
        try { instrumentation.runOnMainSync(() -> { try {
            set(activity, "state", new JSONObject().put("active", true).put("contextToken", "layout-fixture")
                .put("current", new JSONObject().put("name", "Supino Reto").put("setLabel", "Série 2/4").put("canComplete", true)));
            set(activity, "phone", "fixture"); set(activity, "confirmedAt", SystemClock.elapsedRealtime());
            WearHeartService.running = false; render(activity);
            var root = activity.getWindow().getDecorView();
            Button primary = root.findViewWithTag("main-action");
            assertEquals(activity.getString(R.string.heart_start_short), primary.getText().toString());
            assertTrue(primary.isEnabled());
            set(activity, "options", true); set(activity, "optionsPage", "heart"); render(activity);
            Button manual = root.findViewWithTag("complete-no-heart");
            assertNotNull("Training without a sensor remains possible", manual);
            assertTrue(manual.isEnabled());
            set(activity, "pending", "request"); render(activity);
            assertFalse("Manual completion cannot duplicate a pending command", root.findViewWithTag("complete-no-heart").isEnabled());
            set(activity, "pending", "");
            var stateField = WearActivity.class.getDeclaredField("state"); stateField.setAccessible(true);
            JSONObject workout = (JSONObject) stateField.get(activity);
            workout.put("heartCapture", new JSONObject().put("phase", "effort").put("token", "fixture-effort").put("startedAt", System.currentTimeMillis()));
            set(activity, "options", false); render(activity);
            assertEquals("Active effort changes the primary action to completion", activity.getString(R.string.complete), ((Button) root.findViewWithTag("main-action")).getText().toString());
            set(activity, "options", true); render(activity);
            assertNull("Captured effort uses normal completion instead of a misleading sensor-free action", root.findViewWithTag("complete-no-heart"));
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally { WearHeartService.running = running; instrumentation.runOnMainSync(activity::finish); }
    }
}
