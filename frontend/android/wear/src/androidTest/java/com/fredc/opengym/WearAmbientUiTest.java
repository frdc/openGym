package com.fredc.opengym;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearAmbientUiTest {
    private void set(WearActivity activity, String name, Object value) throws Exception {
        var field = WearActivity.class.getDeclaredField(name); field.setAccessible(true); field.set(activity, value);
    }
    private Object get(WearActivity activity, String name) throws Exception {
        var field = WearActivity.class.getDeclaredField(name); field.setAccessible(true); return field.get(activity);
    }
    private void call(WearActivity activity, String name) throws Exception {
        var method = WearActivity.class.getDeclaredMethod(name); method.setAccessible(true); method.invoke(activity);
    }
    @Test public void ambientPreservesWorkoutAndEditorAndNeverShowsStaleSeconds() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            ((Handler)get(activity, "handler")).removeCallbacks((Runnable)get(activity, "tick"));
            JSONObject current = new JSONObject().put("name", "Supino Reto").put("setLabel", "Série 2/4").put("canComplete", true).put("canEdit", true)
                .put("entryIdx",0).put("setIdx",1).put("repsValue",10).put("loadValue",40).put("loadUnit","kg");
            JSONObject state = new JSONObject().put("active",true).put("lang","pt-BR").put("contextToken","ambient-test").put("current",current)
                .put("timer",new JSONObject().put("endsAt",System.currentTimeMillis()+90000).put("paused",false));
            set(activity,"state",state); set(activity,"phone","test-phone"); set(activity,"confirmedAt",SystemClock.elapsedRealtime());
            call(activity,"render");
            View root = activity.getWindow().getDecorView(); root.findViewWithTag("edit-load").performClick();
            Object draft = get(activity,"draft"); assertNotNull(draft);
            call(activity,"enterAmbient");
            assertNotNull(root.findViewWithTag("ambient-screen"));
            assertNull("Ambient screen has no interactive controls",root.findViewWithTag("confirm-edit"));
            assertEquals("The screen is genuinely black",Color.BLACK,((ColorDrawable)((View)get(activity,"scroll")).getBackground()).getColor());
            assertTrue(((TextView)root.findViewWithTag("ambient-detail")).getText().toString().startsWith("Até "));
            assertEquals(0,activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            assertSame("Ambient does not discard an editor",draft,get(activity,"draft"));
            call(activity,"exitAmbient");
            assertNull(root.findViewWithTag("ambient-screen")); assertNotNull(root.findViewWithTag("confirm-edit"));
            assertTrue("Wake may save an edit locally while the phone is unconfirmed",root.findViewWithTag("confirm-edit").isEnabled());
            assertSame(draft,get(activity,"draft"));
            set(activity,"draft",null);
            state.remove("timer"); state.put("heartCapture",new JSONObject().put("phase","effort").put("startedAt",System.currentTimeMillis()-24000));
            call(activity,"render");
            assertTrue("Effort keeps live timers visible",(activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0);
            call(activity,"enterAmbient"); assertEquals("Em série",((TextView)root.findViewWithTag("ambient-phase")).getText().toString());
            assertEquals("No frozen seconds during effort","",((TextView)root.findViewWithTag("ambient-detail")).getText().toString());
            set(activity,"lowBitAmbient",true); call(activity,"refreshAmbient");
            assertEquals(0,((TextView)root.findViewWithTag("ambient-phase")).getPaintFlags() & android.graphics.Paint.ANTI_ALIAS_FLAG);
            state.put("active",false); state.remove("current"); call(activity,"refreshAmbient");
            assertEquals(activity.getString(R.string.open_phone),((TextView)root.findViewWithTag("ambient-phase")).getText().toString());
        } catch(Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
    @Test public void ambientPreviewHasLowPixelUsageAndReturnsToWorkout() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            instrumentation.runOnMainSync(() -> { try {
                ((Handler)get(activity,"handler")).removeCallbacks((Runnable)get(activity,"tick"));
                JSONObject current = new JSONObject().put("name","Supino Reto").put("setLabel","Série 2/4").put("canComplete",true).put("canEdit",true).put("repsValue",10).put("loadValue",40).put("loadUnit","kg");
                set(activity,"state",new JSONObject().put("active",true).put("lang","pt-BR").put("current",current).put("timer",new JSONObject().put("endsAt",System.currentTimeMillis()+90000)));
                call(activity,"enterAmbient");
            } catch(Exception e) {throw new RuntimeException(e);} });
            instrumentation.waitForIdleSync(); SystemClock.sleep(150);
            android.graphics.Bitmap image = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(image);
            try {
                int bright = 0;
                for(int y=0;y<image.getHeight();y++) for(int x=0;x<image.getWidth();x++) {
                    int color = image.getPixel(x,y); if(Color.red(color)>10 || Color.green(color)>10 || Color.blue(color)>10) bright++;
                }
                assertTrue("At least 85% of the ambient screen stays black",bright < image.getWidth()*image.getHeight()*0.15);
                try(var output = new java.io.FileOutputStream(new java.io.File(activity.getCacheDir(),"wear-ambient-rest.png"))) {image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}
            } finally {image.recycle();}
            instrumentation.runOnMainSync(() -> {try {
                call(activity,"exitAmbient"); assertNotNull(activity.getWindow().getDecorView().findViewWithTag("rest-pause"));
            } catch(Exception e) {throw new RuntimeException(e);} });
        } finally {instrumentation.runOnMainSync(activity::finish);}
    }
}
