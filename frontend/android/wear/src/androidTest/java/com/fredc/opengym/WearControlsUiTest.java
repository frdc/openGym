package com.fredc.opengym;

import android.content.Intent;
import android.os.SystemClock;
import android.widget.Button;
import android.widget.TextView;
import android.view.View;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearControlsUiTest {
    private void set(WearActivity activity, String field, Object value) throws Exception {
        var member = WearActivity.class.getDeclaredField(field); member.setAccessible(true); member.set(activity, value);
    }
    private Object get(WearActivity activity, String field) throws Exception {
        var member = WearActivity.class.getDeclaredField(field); member.setAccessible(true); return member.get(activity);
    }
    private void render(WearActivity activity) throws Exception {
        var method = WearActivity.class.getDeclaredMethod("render"); method.setAccessible(true); method.invoke(activity);
    }
    @Test public void unavailableAndPendingControlsShowTheirActualStatus() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            JSONObject current = new JSONObject().put("name", "Supino").put("setLabel", "2/4").put("canComplete", true);
            set(activity, "state", new JSONObject().put("active", true).put("current", current));
            set(activity, "phone", "phone"); set(activity, "confirmedAt", SystemClock.elapsedRealtime());
            WearHeartService.running = false;
            render(activity);
            Button complete = (Button) get(activity, "complete");
            assertTrue(complete.isEnabled());
            assertNotNull("Primary action has a vector icon", complete.getCompoundDrawablesRelative()[0]);
            assertFalse("Completion label does not contain a font-dependent icon", complete.getText().toString().contains("✓"));
            int readyInk = complete.getCurrentTextColor();
            set(activity, "confirmedAt", 0L); render(activity);
            complete = (Button) get(activity, "complete");
            assertFalse(complete.isEnabled());
            assertNotEquals("Disabled action has subdued ink", readyInk, complete.getCurrentTextColor());
            View root = activity.getWindow().getDecorView();
            assertNull("No connection text consumes workout space", root.findViewWithTag("connection-status"));
            View dot = root.findViewWithTag("connection-indicator");
            assertNotNull("Offline indicator is in the header", dot);
            assertEquals(View.VISIBLE, dot.getVisibility());
            assertEquals(activity.getString(R.string.phone_unresponsive), dot.getContentDescription());
            set(activity, "pending", "request"); set(activity, "confirmedAt", SystemClock.elapsedRealtime()); render(activity);
            assertEquals(View.INVISIBLE, root.findViewWithTag("connection-indicator").getVisibility());
            assertFalse(((Button) get(activity, "complete")).isEnabled());
            assertEquals(activity.getString(R.string.waiting), ((Button) get(activity, "complete")).getContentDescription());
            set(activity, "pending", ""); set(activity, "feedback", R.string.unconfirmed); render(activity);
            assertEquals("Recovered connection does not consume screen space", View.INVISIBLE, root.findViewWithTag("connection-indicator").getVisibility());
            set(activity, "phone", ""); render(activity);
            assertEquals(View.VISIBLE, root.findViewWithTag("connection-indicator").getVisibility());
            assertEquals(activity.getString(R.string.disconnected), root.findViewWithTag("connection-indicator").getContentDescription());
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
    @Test public void restControlsStayOnWorkoutAndOptionsAreSeparated() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            JSONObject current = new JSONObject().put("name", "Supino").put("setLabel", "2/4").put("canComplete", true).put("canEdit", true);
            JSONObject timer = new JSONObject().put("timerToken", "rest-fixture").put("endsAt", System.currentTimeMillis() + 90000).put("paused", false);
            set(activity, "state", new JSONObject().put("active", true).put("current", current).put("timer", timer));
            set(activity, "phone", "phone"); set(activity, "confirmedAt", SystemClock.elapsedRealtime());
            WearTimer.prefs(activity).edit().putLong("endsAt", timer.getLong("endsAt")).commit();
            render(activity);
            assertNotNull("Pause is available without opening options", get(activity, "pause"));
            assertNotNull(get(activity, "plus")); assertNotNull(get(activity, "skip"));
            assertNotNull("Load remains editable during rest", get(activity, "loadChip"));
            set(activity, "options", true); render(activity);
            assertNull("Workout controls are not mixed into settings", get(activity, "pause"));
            View root = activity.getWindow().getDecorView();
            assertNotNull(root.findViewWithTag("heart-settings"));
            View reconnect = root.findViewWithTag("reconnect");
            assertNotNull("Reconnect is available for live connectivity changes", reconnect);
            assertEquals(View.VISIBLE, reconnect.getVisibility());
            set(activity, "phone", "");
            var update = WearActivity.class.getDeclaredMethod("updateControls"); update.setAccessible(true); update.invoke(activity);
            assertEquals("Reconnect appears without leaving options", View.VISIBLE, reconnect.getVisibility());
            set(activity, "phone", "phone"); update.invoke(activity);
            assertEquals(View.VISIBLE, reconnect.getVisibility());
            View alerts = root.findViewWithTag("alerts-settings"); assertNotNull(alerts); alerts.performClick();
            assertNull("Alert detail does not mix in heart settings", root.findViewWithTag("heart-settings"));
            root.findViewWithTag("back").performClick();
            assertNotNull("Back returns to the options list", root.findViewWithTag("heart-settings"));
            root.findViewWithTag("back").performClick();
            assertNotNull("Root options have a reliable back target",root.findViewWithTag("rest-pause"));
            set(activity,"options",true);render(activity); activity.getOnBackPressedDispatcher().onBackPressed();
            assertNotNull("Watch back button closes settings before leaving the app",root.findViewWithTag("rest-pause"));
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
