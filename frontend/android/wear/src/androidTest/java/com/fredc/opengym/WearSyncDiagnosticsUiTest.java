package com.fredc.opengym;

import android.content.BroadcastReceiver;
import android.content.Intent;
import android.os.SystemClock;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearSyncDiagnosticsUiTest {
    private Object field(WearActivity a,String name) throws Exception {var f=WearActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(a);}
    private void set(WearActivity a,String name,Object value) throws Exception {var f=WearActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(a,value);}
    private void render(WearActivity a) throws Exception {var m=WearActivity.class.getDeclaredMethod("render");m.setAccessible(true);m.invoke(a);}
    @Test public void debugPageShowsSafeCountersAndReceivedStateDoesNotTriggerAnotherPull() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var ctx=instrumentation.getTargetContext();
        WearActivity activity=(WearActivity)instrumentation.startActivitySync(new Intent(ctx,WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            instrumentation.waitForIdleSync();
            instrumentation.runOnMainSync(()->{try {
                set(activity,"options",true);set(activity,"optionsPage","");render(activity);
                var root=activity.getWindow().getDecorView();assertNotNull(root.findViewWithTag("sync-diagnostics-open"));
                root.findViewWithTag("sync-diagnostics-open").performClick();
                TextView debug=root.findViewWithTag("sync-diagnostics");assertNotNull(debug);assertTrue(debug.getText().toString().contains("RX"));assertTrue(debug.getText().toString().contains("ACK"));
                int before=WearSyncDiagnostics.live.snapshot(SystemClock.elapsedRealtime(),0,0).optInt("requests");
                for(int i=0;i<3;i++) {
                    ((WearSyncPull)field(activity,"syncPull")).reset();
                    set(activity,"state",new JSONObject().put("test-ui-only",i));
                    ((BroadcastReceiver)field(activity,"receiver")).onReceive(ctx,new Intent("com.fredc.opengym.WEAR_STATE"));
                }
                assertEquals("A delivered state must not become another state request",before,WearSyncDiagnostics.live.snapshot(SystemClock.elapsedRealtime(),0,0).optInt("requests"));
                set(activity,"state",new JSONObject(WearStateService.cached(ctx).toString()).put("lang","pt-BR"));render(activity);
            } catch(Exception e) {throw new RuntimeException(e);}});
            var frames=new java.util.concurrent.CountDownLatch(1);
            instrumentation.runOnMainSync(()->activity.getWindow().getDecorView().postOnAnimation(()->activity.getWindow().getDecorView().postOnAnimation(frames::countDown)));
            assertTrue("Diagnostic frame was drawn",frames.await(3,java.util.concurrent.TimeUnit.SECONDS));
            instrumentation.waitForIdleSync();
            var screenshot=instrumentation.getUiAutomation().takeScreenshot();
            try(var out=new java.io.FileOutputStream(new java.io.File(ctx.getExternalFilesDir(null),"wear-sync-diagnostics-20261029.png"))) {screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
            screenshot.recycle();
        } finally {instrumentation.runOnMainSync(activity::finish);}
    }
}
