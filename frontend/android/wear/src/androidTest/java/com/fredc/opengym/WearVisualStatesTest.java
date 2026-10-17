package com.fredc.opengym;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/** Captures the real native UI using controlled workout states, without sending commands. */
public class WearVisualStatesTest {
    private void set(WearActivity activity, String field, Object value) throws Exception {
        var member = WearActivity.class.getDeclaredField(field); member.setAccessible(true); member.set(activity, value);
    }
    private Object get(WearActivity activity, String field) throws Exception {
        var member = WearActivity.class.getDeclaredField(field); member.setAccessible(true); return member.get(activity);
    }
    private void render(WearActivity activity) throws Exception {
        var method = WearActivity.class.getDeclaredMethod("render"); method.setAccessible(true); method.invoke(activity);
    }
    private JSONObject workout() throws Exception {
        JSONObject current = new JSONObject().put("name", "Supino Reto").put("setLabel", "Série 2/4")
            .put("entryIdx", 0).put("setIdx", 1).put("side", JSONObject.NULL).put("canComplete", true).put("canEdit", true)
            .put("repsValue", 10).put("loadValue", 40).put("loadUnit", "kg").put("loadStep", 2.5);
        return new JSONObject().put("v", 1).put("active", true).put("lang", "pt-BR").put("contextToken", "visual-workout").put("revision", 1).put("current", current);
    }
    private void configure(WearActivity activity, JSONObject state, boolean heart, String phone, String pending, boolean options, String page) throws Exception {
        ((Handler) get(activity, "handler")).removeCallbacks((Runnable) get(activity, "tick"));
        set(activity, "state", state); set(activity, "phone", phone); set(activity, "confirmedAt", phone.isEmpty() ? 0L : SystemClock.elapsedRealtime());
        set(activity, "pending", pending); set(activity, "feedback", 0); set(activity, "draft", null); set(activity, "options", options); set(activity, "optionsPage", page);
        WearHeartService.running = heart; WearHeartService.latestBpm = 0; WearHeartService.status = heart ? R.string.heart_acquiring : R.string.heart_off;
        JSONObject timer = state.optJSONObject("timer");
        WearTimer.prefs(activity).edit().putLong("endsAt", timer == null ? 0 : timer.optLong("endsAt")).commit();
        render(activity);
    }
    private void checkTargets(WearActivity activity, View view) {
        if (view instanceof Button && view.isShown()) {
            assertTrue("Touch height: " + view.getTag(), view.getHeight() >= activity.dp(48));
            assertTrue("Touch width: " + view.getTag(), view.getWidth() >= activity.dp(48));
            Rect visible = new Rect(); assertTrue(view.getGlobalVisibleRect(visible));
            assertEquals("Button is fully visible: " + view.getTag(), view.getHeight(), visible.height());
            View root = activity.getWindow().getDecorView();
            double x = visible.exactCenterX() - root.getWidth() / 2.0, y = visible.exactCenterY() - root.getHeight() / 2.0;
            assertTrue("Button center fits the round display: " + view.getTag(), Math.hypot(x, y) < Math.min(root.getWidth(), root.getHeight()) / 2.0);
        }
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) checkTargets(activity, group.getChildAt(i));
    }
    private void capture(WearActivity activity, String name) throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation(); instrumentation.waitForIdleSync();
        SystemClock.sleep(150);
        instrumentation.runOnMainSync(() -> {
            checkTargets(activity,activity.getWindow().getDecorView());
            View heart=activity.getWindow().getDecorView().findViewWithTag("heart-status");
            if (heart!=null) { Rect visible=new Rect(); assertTrue("Heart status is visible beyond the content inset",heart.getGlobalVisibleRect(visible)); assertEquals(heart.getWidth(),visible.width()); }
        });
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(screenshot);
        instrumentation.runOnMainSync(() -> {
            View main = activity.getWindow().getDecorView().findViewWithTag("main-action");
            if (main != null) {
                Rect bounds = new Rect(); assertTrue(main.getGlobalVisibleRect(bounds));
                int color = screenshot.getPixel(bounds.centerX(), bounds.top + activity.dp(20));
                assertEquals("Primary surface matches its enabled state", main.isEnabled() ? WearStyle.PRIMARY : WearStyle.DISABLED, color);
            }
        });
        try (var stream = new FileOutputStream(new File(activity.getCacheDir(), "wear-state-" + name + ".png"))) {
            assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream));
        } finally { screenshot.recycle(); }
    }
    private void screen(WearActivity activity, String name, JSONObject state, boolean heart, String phone, String pending, boolean options, String page) throws Exception {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> { try { configure(activity, state, heart, phone, pending, options, page); } catch (Exception e) { throw new RuntimeException(e); } });
        capture(activity, name);
    }
    @Test public void captureWorkoutAndSettingsStatesWithUsableTouchTargets() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        boolean previousRunning = WearHeartService.running;
        try {
            screen(activity, "01-start", workout(), true, "fixture-phone", "", false, "");
            instrumentation.runOnMainSync(() -> { try {
                WearHeartService.latestBpm = 78; WearHeartService.latestElapsed = SystemClock.elapsedRealtime(); render(activity);
            } catch (Exception e) { throw new RuntimeException(e); } });
            capture(activity, "17-ready-heart");
            if (Boolean.parseBoolean(InstrumentationRegistry.getArguments().getString("wavePreview","false"))) SystemClock.sleep(10000);
            screen(activity, "02-complete", workout(), false, "fixture-phone", "", false, "");
            JSONObject effort = workout().put("heartCapture", new JSONObject().put("phase", "effort").put("token", "visual-effort").put("startedAt", System.currentTimeMillis() - 24000));
            screen(activity, "03-effort", effort, true, "fixture-phone", "", false, "");
            JSONObject rest = workout().put("timer", new JSONObject().put("timerToken", "visual-rest").put("endsAt", System.currentTimeMillis() + 90000).put("paused", false));
            screen(activity, "04-rest", rest, true, "fixture-phone", "", false, "");
            JSONObject paused = workout().put("timer", new JSONObject().put("timerToken", "visual-rest").put("paused", true).put("leftMs", 90000));
            screen(activity, "05-paused", paused, true, "fixture-phone", "", false, "");
            screen(activity, "06-pending", workout(), false, "fixture-phone", "fixture-request", false, "");
            screen(activity, "07-offline", workout(), false, "", "", false, "");
            screen(activity, "08-options", rest, true, "fixture-phone", "", true, "");
            screen(activity, "09-heart-settings", effort, true, "fixture-phone", "", true, "heart");
            screen(activity, "10-alert-settings", workout(), false, "fixture-phone", "", true, "alerts");
            screen(activity, "11-edit-load-base", workout(), false, "fixture-phone", "", false, "");
            instrumentation.runOnMainSync(() -> activity.getWindow().getDecorView().findViewWithTag("edit-load").performClick());
            capture(activity, "11-edit-load");
            JSONObject longLoad=workout(); longLoad.getJSONObject("current").put("loadValue",333);
            screen(activity,"18-long-load",longLoad,false,"fixture-phone","",false,"");
            instrumentation.runOnMainSync(() -> activity.getWindow().getDecorView().findViewWithTag("edit-load").performClick());
            capture(activity,"19-edit-long-load");
            screen(activity, "12-edit-reps-base", workout(), false, "fixture-phone", "", false, "");
            instrumentation.runOnMainSync(() -> activity.getWindow().getDecorView().findViewWithTag("edit-reps").performClick());
            capture(activity, "12-edit-reps");
            screen(activity, "13-open-phone", new JSONObject().put("v", 1).put("active", false).put("lang", "pt-BR"), false, "fixture-phone", "", false, "");
            JSONObject finished = workout(); finished.remove("current");
            screen(activity, "14-finished", finished, false, "fixture-phone", "", false, "");
            JSONObject special = workout(); special.getJSONObject("current").put("canComplete", false).put("canEdit", false);
            screen(activity, "15-use-phone", special, false, "fixture-phone", "", false, "");
            screen(activity, "16-options-offline", rest, false, "", "", true, "");
        } finally { WearHeartService.running = previousRunning; instrumentation.runOnMainSync(activity::finish); }
    }
}
