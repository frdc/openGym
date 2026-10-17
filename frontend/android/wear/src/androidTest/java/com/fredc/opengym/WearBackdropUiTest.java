package com.fredc.opengym;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.widget.Button;
import android.widget.ScrollView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearBackdropUiTest {
    private Bitmap pixels(android.graphics.drawable.Drawable drawable) {
        Bitmap bitmap = Bitmap.createBitmap(180, 180, Bitmap.Config.ARGB_8888);
        drawable.setBounds(0, 0, 180, 180); drawable.draw(new Canvas(bitmap)); return bitmap;
    }
    @Test public void wavesMoveInsideFixedEdgesAndStopWithMotion() {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.runOnMainSync(() -> { try {
            WearBackdrop backdrop=new WearBackdrop(); backdrop.texture(instrumentation.getTargetContext().getResources());
            var phase=WearBackdrop.class.getDeclaredField("phase"); phase.setAccessible(true);
            backdrop.motion(true); Bitmap first=pixels(backdrop); phase.setFloat(backdrop,1.2f); Bitmap second=pixels(backdrop);
            assertFalse("The texture visibly deforms as time changes",first.sameAs(second));
            assertEquals("Top edge stays fixed rather than panning",first.getPixel(90,0),second.getPixel(90,0));
            assertEquals("Left edge stays fixed rather than zooming",first.getPixel(0,90),second.getPixel(0,90));
            int changed=0; for(int y=30;y<150;y+=4) for(int x=30;x<150;x+=4) if(first.getPixel(x,y)!=second.getPixel(x,y)) changed++;
            assertTrue("Waves change throughout the interior",changed>100);
            backdrop.motion(false); Bitmap stopped=pixels(backdrop); assertTrue("Stopping returns to the original static texture",first.sameAs(stopped));
            first.recycle(); second.recycle(); stopped.recycle();
        } catch(Exception e) { throw new RuntimeException(e); } });
    }
    @Test public void completionUsesSameRoundedSurfaceAsStart() {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.runOnMainSync(() -> {
            Button start = new Button(instrumentation.getTargetContext());
            Button complete = new Button(instrumentation.getTargetContext());
            WearStyle.surface(start, WearStyle.PRIMARY, WearStyle.ON_PRIMARY, false);
            WearStyle.surface(complete, WearStyle.PRIMARY, WearStyle.ON_PRIMARY, true);
            assertTrue("Start and Complete have identical corner silhouettes", pixels(start.getBackground()).sameAs(pixels(complete.getBackground())));
        });
    }
    @Test public void interactiveGradientBecomesBlackInAmbient() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        WearActivity activity = (WearActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try { instrumentation.runOnMainSync(() -> { try {
            var field = WearActivity.class.getDeclaredField("scroll"); field.setAccessible(true);
            ScrollView scroll = (ScrollView) field.get(activity);
            Bitmap interactive = pixels(scroll.getBackground());
            assertNotEquals("Interactive backdrop has a visible gradient", interactive.getPixel(20, 20), interactive.getPixel(160, 160));
            var backdrop = scroll.getBackground();
            var handlerField = backdrop.getClass().getDeclaredField("handler"); handlerField.setAccessible(true);
            var frameField = backdrop.getClass().getDeclaredField("frame"); frameField.setAccessible(true);
            var handler = (android.os.Handler) handlerField.get(backdrop);
            var frame = (Runnable) frameField.get(backdrop);
            if (android.animation.ValueAnimator.areAnimatorsEnabled()) assertTrue("Foreground movement is scheduled", handler.hasCallbacks(frame));
            var enter = WearActivity.class.getDeclaredMethod("enterAmbient"); enter.setAccessible(true); enter.invoke(activity);
            assertFalse("Ambient removes movement callbacks", handler.hasCallbacks(frame));
            Bitmap ambient = pixels(scroll.getBackground());
            assertEquals(Color.BLACK, ambient.getPixel(20, 20)); assertEquals(Color.BLACK, ambient.getPixel(160, 160));
            var exit = WearActivity.class.getDeclaredMethod("exitAmbient"); exit.setAccessible(true); exit.invoke(activity);
            instrumentation.callActivityOnPause(activity);
            assertFalse("Paused activity removes movement callbacks", handler.hasCallbacks(frame));
            var phaseField = backdrop.getClass().getDeclaredField("phase"); phaseField.setAccessible(true);
            assertEquals("Pause resets the drift", 0f, phaseField.getFloat(backdrop), 0f);
            instrumentation.callActivityOnResume(activity);
        } catch (Exception e) { throw new RuntimeException(e); } }); }
        finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
