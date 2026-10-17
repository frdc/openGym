package com.fredc.opengym;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
public class WearCompactLayoutUiTest {
    private void set(WearActivity activity,String name,Object value) throws Exception { var field=WearActivity.class.getDeclaredField(name);field.setAccessible(true);field.set(activity,value); }
    @Test public void compactWatchKeepsTimerAboveControlsAndFooterAtBottom() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        WearActivity activity=(WearActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            JSONObject current=new JSONObject().put("name","Supino Reto").put("setLabel","2/4").put("canComplete",true).put("canEdit",true).put("repsValue",10).put("loadValue",40).put("loadUnit","kg");
            JSONObject state=new JSONObject().put("active",true).put("current",current);
            set(activity,"state",state);set(activity,"phone","fixture");set(activity,"confirmedAt",SystemClock.elapsedRealtime());
            var render=WearActivity.class.getDeclaredMethod("render");render.setAccessible(true);
            for (boolean resting : new boolean[] {false,true}) {
                if (resting) state.put("timer",new JSONObject().put("endsAt",System.currentTimeMillis()+90000));
                render.invoke(activity);
                View panel=activity.getWindow().getDecorView().findViewWithTag("workout-panel");
                int height=activity.dp(184),width=activity.dp(132);
                panel.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));panel.layout(0,0,width,height);
                View counter=panel.findViewWithTag("workout-counter"), metrics=panel.findViewWithTag(resting ? "rest-actions" : "workout-metrics"), primary=panel.findViewWithTag(resting ? "rest-pause" : "main-action");
                assertTrue("Timer stays clear of control surfaces",counter.getBottom() <= metrics.getTop()+activity.dp(resting ? 0 : 8));
                assertEquals(height,primary.getBottom()); assertTrue("Controls do not overlap primary touch area",metrics.getBottom()<=primary.getTop());
            }
        } catch(Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
