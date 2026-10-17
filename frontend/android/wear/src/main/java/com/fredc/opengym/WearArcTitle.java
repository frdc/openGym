package com.fredc.opengym;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Path;
import android.graphics.RectF;
import android.text.TextUtils;
import android.widget.TextView;

/** Keeps the full accessible exercise name while drawing a bounded upper arc. */
final class WearArcTitle extends TextView {
    private final Path arc = new Path();

    WearArcTitle(Context context) { super(context); }

    @Override protected void onDraw(Canvas canvas) {
        if (getWidth() == 0) return;
        float density = getResources().getDisplayMetrics().density;
        float radius = getWidth() * .45f;
        float centerX = getWidth() / 2f, centerY = radius + 18 * density;
        arc.reset();
        arc.addArc(new RectF(centerX - radius, centerY - radius, centerX + radius, centerY + radius), 238, 64);
        float length = radius * (float) Math.toRadians(64);
        var paint = getPaint(); paint.setColor(getCurrentTextColor());
        String visible = TextUtils.ellipsize(getText().toString().replace('\n', ' '), paint, length - 4 * density, TextUtils.TruncateAt.END).toString();
        canvas.drawTextOnPath(visible, arc, Math.max(0, (length - paint.measureText(visible)) / 2f), 0, paint);
    }
}
