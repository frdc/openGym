package com.fredc.opengym;

import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.os.Looper;

/** Slow violet ribbons below the workout controls. */
final class WearBackdrop extends Drawable {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private float phase;
    private boolean moving;
    private final Runnable frame = new Runnable() {
        @Override public void run() {
            if (!moving) return;
            phase += 0.06f; invalidateSelf(); handler.postDelayed(this, 150);
        }
    };
    void motion(boolean active) {
        if (moving == active) return;
        moving = active; handler.removeCallbacks(frame);
        if (active) handler.postDelayed(frame, 150);
        else { phase = 0; invalidateSelf(); }
    }
    private Bitmap texture;
    private static final int MESH = 20;
    private final float[] vertices = new float[(MESH+1)*(MESH+1)*2];
    void texture(android.content.res.Resources resources) {
        if (texture != null) return;
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize=2;
        texture = BitmapFactory.decodeResource(resources,R.drawable.wear_violet_aurora,options);
        paint.setFilterBitmap(true);
    }
    @Override public void draw(Canvas canvas) {
        Rect bounds=getBounds(); float w=bounds.width(),h=bounds.height();
        if (w<=0 || h<=0) return;
        if (texture==null) { paint.setColor(Color.BLACK); canvas.drawRect(bounds,paint); return; }
        // Keep the perimeter fixed; only local regions of the artwork flex.
        // Canvas bitmap meshes work on every supported Wear OS API, without a shader dependency.
        double time=moving ? phase : 0;
        int index=0;
        for (int row=0;row<=MESH;row++) {
            float v=(float)row/MESH;
            double vertical=Math.sin(Math.PI*interior(v));
            for (int column=0;column<=MESH;column++) {
                float u=(float)column/MESH;
                double envelope=vertical*Math.sin(Math.PI*interior(u));
                double waveX=Math.sin(v*Math.PI*2+time)-Math.sin(v*Math.PI*2);
                double waveY=Math.sin(u*Math.PI*2+time*.8)-Math.sin(u*Math.PI*2);
                vertices[index++]=bounds.left+u*w+(float)(waveX*envelope*w*.055);
                vertices[index++]=bounds.top+v*h+(float)(waveY*envelope*h*.040);
            }
        }
        canvas.drawBitmapMesh(texture,MESH,MESH,vertices,0,null,0,paint);
    }
    private static float interior(float position) {
        return Math.max(0,Math.min(1,(position-.10f)/.80f));
    }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
