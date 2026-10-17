package com.fredc.opengym;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
public class WearPagerUiTest {
    @Test public void swipeAndAccessibilityChangePagesWithoutChangingModalState() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            boolean[] state = {true,false};
            WearPagerScroll pager = new WearPagerScroll(InstrumentationRegistry.getInstrumentation().getTargetContext(),new WearPagerScroll.Pages() {
                public boolean available() { return state[0]; }
                public boolean settings() { return state[1]; }
                public void show(boolean settings) { state[1]=settings; }
            });
            int right=AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_RIGHT.getId();
            int left=AccessibilityNodeInfo.AccessibilityAction.ACTION_PAGE_LEFT.getId();
            assertTrue(pager.performAccessibilityAction(right,null)); assertTrue(state[1]);
            assertTrue(pager.performAccessibilityAction(left,null)); assertFalse(state[1]);
            long now=android.os.SystemClock.uptimeMillis(); float scale=pager.getResources().getDisplayMetrics().density;
            MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,180*scale,50*scale,0);
            MotionEvent move=MotionEvent.obtain(now,now+50,MotionEvent.ACTION_MOVE,60*scale,52*scale,0);
            MotionEvent up=MotionEvent.obtain(now,now+100,MotionEvent.ACTION_UP,60*scale,52*scale,0);
            pager.onInterceptTouchEvent(down); assertTrue(pager.onInterceptTouchEvent(move)); pager.onTouchEvent(up); assertTrue(state[1]);
            state[0]=false;
            assertFalse(pager.performAccessibilityAction(left,null)); assertTrue(state[1]);
            down.recycle(); move.recycle(); up.recycle();
        });
    }
}
