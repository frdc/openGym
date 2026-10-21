package com.fredc.opengym;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.graphics.Rect;
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
            for (int size : new int[] {192,225}) {
              Rect previousTimer=null,previousMetrics=null;
              for (boolean resting : new boolean[] {false,true}) {
                state.remove("timer");
                if (resting) state.put("timer",new JSONObject().put("endsAt",System.currentTimeMillis()+90000));
                render.invoke(activity);
                View panel=activity.getWindow().getDecorView().findViewWithTag("workout-panel");
                int height=activity.dp(size),width=activity.dp(size);
                View parent=(View)panel.getParent();
                parent.dispatchApplyWindowInsets(new android.view.WindowInsets.Builder().setSystemWindowInsets(android.graphics.Insets.NONE).build());
                parent.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));parent.layout(0,0,width,height);
                assertEquals("Insets must not compress the workout",width,panel.getWidth());
                View counter=panel.findViewWithTag("workout-counter"), metrics=panel.findViewWithTag("workout-metrics"), primary=panel.findViewWithTag(resting ? "rest-pause" : "main-action");
                assertNotNull("Metrics remain on both screens",metrics);
                assertTrue("Timer remains above metric centers",counter.getBottom() <= metrics.getTop()+metrics.getHeight()/2);
                assertTrue("Controls do not overlap primary touch area",metrics.getBottom()<=primary.getTop());
                Rect timerBounds=new Rect(counter.getLeft(),counter.getTop(),counter.getRight(),counter.getBottom());
                Rect metricBounds=new Rect(metrics.getLeft(),metrics.getTop(),metrics.getRight(),metrics.getBottom());
                if (resting) {
                    assertEquals("Timer does not move when rest begins",previousTimer,timerBounds);
                    assertEquals("Load does not move when rest begins",previousMetrics,metricBounds);
                    View skip=panel.findViewWithTag("rest-skip"), plus=panel.findViewWithTag("rest-plus");
                    assertTrue("Skip is left of the timer",skip.getRight()<=counter.getLeft());
                    assertTrue("Add time is right of the timer",plus.getLeft()>=counter.getRight());
                    for (View side : new View[] {skip,plus}) {
                        assertEquals("Side label stays level with the timer",(counter.getTop()+counter.getBottom())/2f,(side.getTop()+side.getBottom())/2f+((WearStyle.QuietButton)side).contentOffsetY,1f);
                        assertTrue("Rest taps cannot hit edit controls",side.getBottom()<=metrics.getTop());
                    }
                    assertTrue("Options and add time do not share a touch region",panel.findViewWithTag("options-menu").getBottom()<=plus.getTop());
                    for (View control : new View[] {skip,plus,panel.findViewWithTag("options-menu"),primary}) {
                        int touch=Math.round(activity.dp(48)*size/225f);
                        assertTrue("Touch target height scales with the approved layout",control.getHeight()>=touch);
                        assertTrue("Touch target width scales with the approved layout",control.getWidth()>=touch);
                        assertTrue("Touch target remains inside panel",control.getLeft()>=0 && control.getRight()<=width && control.getTop()>=0 && control.getBottom()<=height);
                        assertTrue("Touch center fits round screen",Math.hypot((control.getLeft()+control.getRight()-width)/2.0,(control.getTop()+control.getBottom()-height)/2.0)<width/2.0);
                    }
                }
                previousTimer=timerBounds;previousMetrics=metricBounds;
              }
            }
        } catch(Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
