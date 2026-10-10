package com.fredc.opengym;

import android.content.Intent;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearEditorUiTest {
 @Test public void screenStaysAwakeOnlyDuringForegroundEffort() throws Exception {
  var instrumentation=InstrumentationRegistry.getInstrumentation();
  WearActivity activity=(WearActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  try { instrumentation.runOnMainSync(()-> { try {
   var state=WearActivity.class.getDeclaredField("state");state.setAccessible(true);
   var render=WearActivity.class.getDeclaredMethod("render");render.setAccessible(true);
   JSONObject snapshot=new JSONObject().put("active",true).put("heartCapture",new JSONObject().put("phase","effort"));
   state.set(activity,snapshot);render.invoke(activity);
   assertTrue((activity.getWindow().getAttributes().flags & android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0);
   snapshot.getJSONObject("heartCapture").put("phase","recovery");render.invoke(activity);
   assertEquals(0,activity.getWindow().getAttributes().flags & android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  } catch(Exception e){throw new RuntimeException(e);} }); }
  finally {instrumentation.runOnMainSync(activity::finish);}
 }
    private View find(View root, String tag) {
        if (tag.equals(root.getTag())) return root;
        if (root instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) {
            View found = find(group.getChildAt(i), tag); if (found != null) return found;
        }
        return null;
    }
    private void render(WearActivity activity) throws Exception {
        var render = WearActivity.class.getDeclaredMethod("render"); render.setAccessible(true); render.invoke(activity);
    }
    private String decimal(WearActivity activity, String integer, String fraction) {
        return integer + java.text.DecimalFormatSymbols.getInstance(activity.getResources().getConfiguration().getLocales().get(0)).getDecimalSeparator() + fraction + " kg";
    }
    private void screenshot(String name) throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.waitForIdleSync();
        android.os.SystemClock.sleep(350);
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(screenshot);
        try (var stream = new java.io.FileOutputStream(new java.io.File(instrumentation.getTargetContext().getCacheDir(), name + ".png"))) {
            assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream));
        } finally { screenshot.recycle(); }
    }
    @Test public void chipsOpenCancelableDraftWithoutChangingSnapshot() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            JSONObject current = new JSONObject().put("name", "Supino Reto").put("setLabel", "S\u00e9rie 2/4").put("entryIdx", 0).put("setIdx", 1).put("side", JSONObject.NULL).put("canComplete", true).put("canEdit", true).put("repsValue", 10).put("loadValue", 40).put("loadUnit", "kg").put("loadStep", 2.5);
            JSONObject snapshot = new JSONObject().put("active", true).put("contextToken", "test-owner-session").put("revision", 1).put("current", current)
                    .put("heartCapture", new JSONObject().put("phase", "effort").put("token", "preview").put("startedAt", System.currentTimeMillis() - 24000));
            instrumentation.runOnMainSync(() -> { try {
                var state = WearActivity.class.getDeclaredField("state"); state.setAccessible(true); state.set(activity, snapshot);
                var phone = WearActivity.class.getDeclaredField("phone"); phone.setAccessible(true); phone.set(activity, "test-phone");
                var confirmed = WearActivity.class.getDeclaredField("confirmedAt"); confirmed.setAccessible(true); confirmed.setLong(activity, android.os.SystemClock.elapsedRealtime());
                render(activity);
                View load = find(activity.getWindow().getDecorView(), "edit-load"); assertNotNull(load); assertTrue(load.isEnabled());
            } catch (Exception e) { throw new RuntimeException(e); } });
            screenshot("wear-edit-main");
            instrumentation.runOnMainSync(() -> {
                View root = activity.getWindow().getDecorView(); find(root, "edit-load").performClick();
                assertNotNull(find(root, "draft-value")); find(root, "increase").performClick();
                assertEquals(decimal(activity, "42", "5"), ((android.widget.TextView) find(root, "draft-value")).getText().toString());
            });
            screenshot("wear-edit-load");
            instrumentation.runOnMainSync(() -> { try {
                View root = activity.getWindow().getDecorView();
                find(root, "cancel-edit").performClick(); assertNotNull(find(root, "edit-load")); assertEquals(40, current.optDouble("loadValue"), 0);
                find(root, "edit-reps").performClick(); find(root, "increase").performClick(); find(root, "increase").performClick();
                assertEquals("12", ((android.widget.TextView) find(root, "draft-value")).getText().toString());
            } catch (Exception e) { throw new RuntimeException(e); } });
            screenshot("wear-edit-reps");
            instrumentation.runOnMainSync(() -> { try {
                View root = activity.getWindow().getDecorView(); find(root, "cancel-edit").performClick(); assertEquals(10, current.optDouble("repsValue"), 0);
                find(root, "edit-load").performClick(); find(root, "increase").performClick(); snapshot.put("revision", 2); current.put("repsValue", 12); render(activity);
                assertEquals(decimal(activity, "42", "5"), ((android.widget.TextView) find(root, "draft-value")).getText().toString());
                current.put("loadValue", 45); render(activity); assertNull(find(root, "draft-value"));
                current.put("loadValue", JSONObject.NULL); render(activity); assertTrue(find(root, "edit-load").isEnabled()); find(root, "edit-load").performClick();
                assertEquals("0 kg", ((android.widget.TextView) find(root, "draft-value")).getText().toString()); find(root, "increase").performClick();
                assertEquals(decimal(activity, "2", "5"), ((android.widget.TextView) find(root, "draft-value")).getText().toString()); find(root, "cancel-edit").performClick(); assertTrue(current.isNull("loadValue"));
            } catch (Exception e) { throw new RuntimeException(e); } });
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
