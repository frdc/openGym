package com.fredc.opengym;

import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.widget.Button;
import androidx.core.graphics.PathParser;

/** Material-inspired violet surfaces and font-independent icons for the native watch UI. */
final class WearStyle {
    static final class EdgeButton extends Button {
        EdgeButton(android.content.Context context) { super(context); }
        @Override protected void onDraw(Canvas canvas) {
            // Center the icon and label as one group, rather than pinning the icon to the left padding.
            Paint text = getPaint(); text.setColor(getCurrentTextColor());
            String label = getText().toString(); Drawable icon = getCompoundDrawablesRelative()[0];
            float gap = icon == null ? 0 : 8 * getResources().getDisplayMetrics().density;
            float iconWidth = icon == null ? 0 : icon.getBounds().width();
            float x = (getWidth() - text.measureText(label) - iconWidth - gap) / 2f;
            float y = (getHeight() + 12 * getResources().getDisplayMetrics().density) / 2f;
            if (icon != null) { canvas.save(); canvas.translate(x,y-icon.getBounds().height()/2f); icon.draw(canvas); canvas.restore(); }
            Paint.FontMetrics metrics = text.getFontMetrics();
            canvas.drawText(label,x+iconWidth+gap,y-(metrics.ascent+metrics.descent)/2f,text);
        }
    }
    static void typography(android.widget.TextView view, int weight, boolean numbers) {
        String variation = "'wght' " + weight;
        // Replacing the typeface clears the applied axes, even when TextView caches the same settings string.
        if (!variation.equals(view.getFontVariationSettings())) {
            android.graphics.Typeface base = view.getResources().getFont(R.font.nunito);
            view.setTypeface(android.graphics.Typeface.create(base, weight, false));
            view.setFontVariationSettings(variation);
        }
        if (numbers) view.setFontFeatureSettings("tnum");
    }
    static final int BACKGROUND = Color.rgb(16, 16, 12);
    static final int PRIMARY = Color.rgb(211, 177, 255);
    static final int REST = PRIMARY;
    static final int SURFACE = 0xA02A154B;
    static final int INK = Color.rgb(247, 239, 255);
    static final int MUTED = Color.rgb(201, 183, 224);
    static final int ON_PRIMARY = Color.rgb(32, 17, 48);
    static final int DISABLED = Color.rgb(36, 22, 53);
    static final int DISABLED_INK = Color.rgb(157, 142, 178);

    static void surface(Button button, int fill, int ink, boolean edge) {
        float density = button.getResources().getDisplayMetrics().density;
        float top = 24 * density, bottom = top;
        float[] corners = new float[] {top, top, top, top, bottom, bottom, bottom, bottom};
        Drawable surface = new Drawable() {
            private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            private final Path path = new Path();
            @Override public void draw(Canvas canvas) {
                paint.setColor(button.isEnabled() ? fill : DISABLED);
                path.reset();
                if (button instanceof EdgeButton) {
                    var bounds = getBounds(); float w = bounds.width(), h = bounds.height() - 6 * density, radius = Math.min(8 * density, h * .28f);
                    canvas.save(); canvas.translate(bounds.left, bounds.top + 6 * density);
                    path.moveTo(radius, 0); path.lineTo(w - radius, 0); path.quadTo(w, 0, w, radius);
                    path.lineTo(w, h * .22f); path.cubicTo(w, h * .65f, w * .76f, h, w * .5f, h);
                    path.cubicTo(w * .24f, h, 0, h * .65f, 0, h * .22f);
                    path.lineTo(0, radius); path.quadTo(0, 0, radius, 0); path.close();
                    canvas.drawPath(path, paint); canvas.restore(); return;
                }
                android.graphics.RectF box = new android.graphics.RectF(getBounds());
                if ("edit-reps".equals(button.getTag()) || "edit-load".equals(button.getTag()) || "cancel-edit".equals(button.getTag())) {
                    box.inset(0, 8 * density); path.addRoundRect(box, 20 * density, 20 * density, Path.Direction.CW);
                } else {
                    if ("heart-settings".equals(button.getTag()) || "alerts-settings".equals(button.getTag()) || "reconnect".equals(button.getTag())) box.inset(0,3*density);
                    path.addRoundRect(box,corners,Path.Direction.CW);
                }
                canvas.drawPath(path, paint);
                if (button.isEnabled() && fill == SURFACE) {
                    paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(density * .5f); paint.setColor(0x776A39B3);
                    canvas.drawPath(path,paint); paint.setStyle(Paint.Style.FILL);
                }
            }
            @Override public boolean isStateful() { return true; }
            @Override protected boolean onStateChange(int[] state) { invalidateSelf(); return true; }
            @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
            @Override public void setColorFilter(android.graphics.ColorFilter filter) { paint.setColorFilter(filter); }
            @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
        };
        button.setBackgroundTintList(null);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x30FFFFFF), surface, null));
        button.getBackground().setState(button.getDrawableState());
        button.setTextColor(new ColorStateList(new int[][] {new int[] {-android.R.attr.state_enabled}, new int[] {}}, new int[] {DISABLED_INK, ink}));
        typography(button, button instanceof EdgeButton ? 700 : 600, true);
        button.setPadding(Math.round(8 * density), button instanceof EdgeButton ? Math.round(12 * density) : 0, Math.round(8 * density), button instanceof EdgeButton ? Math.round(4 * density) : 0);
    }

    static void icon(Button button, String kind) {
        Drawable icon = kind == null || kind.isEmpty() ? null : new Symbol(button, kind);
        if (icon != null) {
            int size = Math.round((button instanceof EdgeButton ? 24 : "settings".equals(kind) ? 28 : 18) * button.getResources().getDisplayMetrics().density);
            icon.setBounds(0, 0, size, size);
        }
        button.setCompoundDrawablesRelative(icon, null, null, null);
        button.setCompoundDrawablePadding(Math.round(4 * button.getResources().getDisplayMetrics().density));
    }

    static void chevron(Button button) {
        Drawable arrow = new Symbol(button,"chevron"); int size=Math.round(16*button.getResources().getDisplayMetrics().density); arrow.setBounds(0,0,size,size);
        button.setCompoundDrawablesRelative(button.getCompoundDrawablesRelative()[0],null,arrow,null);
    }
    private static final class Symbol extends Drawable {
        private final Button owner;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path;
        private final boolean filled;
        Symbol(Button owner, String kind) {
            this.owner = owner;
            filled = "play".equals(kind) || "pause".equals(kind) || "skip".equals(kind) || "settings".equals(kind);
            String data = switch (kind) {
                case "play" -> "M7,4 L20,12 L7,20 Z";
                case "pause" -> "M6,4 H10 V20 H6 Z M14,4 H18 V20 H14 Z";
                case "check" -> "M4,12 L9,17 L20,6";
                case "skip" -> "M5,5 L15,12 L5,19 Z M17,5 H20 V19 H17 Z";
                case "heart" -> "M12,20 C9,17 3,13 3,8 C3,3 9,2 12,7 C15,2 21,3 21,8 C21,13 15,17 12,20 Z";
                case "bell" -> "M5,17 H19 L17,14 V9 C17,2 7,2 7,9 V14 Z M10,21 H14";
                case "clock" -> "M12,2 A10,10 0,1 0,12,22 A10,10 0,1 0,12,2 M12,6 V12 L16,14";
                case "refresh" -> "M20,8 C17,0 5,1 3,10 M20,3 V8 H15 M4,16 C7,24 19,23 21,14 M4,21 V16 H9";
                case "close" -> "M6,6 L18,18 M18,6 L6,18";
                case "chevron" -> "M9,5 L16,12 L9,19";
                case "back" -> "M14,5 L7,12 L14,19 M7,12 H21";
                case "menu" -> "M12,4 L12,4.1 M12,12 L12,12.1 M12,20 L12,20.1";
                case "settings" -> "M9,2 H15 L16,5 L19,5 L22,10 L20,12 L22,14 L19,19 L16,19 L15,22 H9 L8,19 L5,19 L2,14 L4,12 L2,10 L5,5 L8,5 Z M12,8 A4,4 0,1 1,12,16 A4,4 0,1 1,12,8 Z";
                default -> "M4,12 H20";
            };
            path = "settings".equals(kind) ? gear() : PathParser.createPathFromPathData(data);
            paint.setStrokeWidth(2); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
        }
        private static Path gear() {
            Path shape = new Path(); int point = 0;
            double[] offsets = {-18, -10, 10, 18};
            for (int tooth = 0; tooth < 8; tooth++) for (int edge = 0; edge < 4; edge++) {
                double angle = Math.toRadians(tooth * 45 + offsets[edge]);
                float radius = edge == 1 || edge == 2 ? 10 : 8;
                float x = 12 + radius * (float)Math.cos(angle), y = 12 + radius * (float)Math.sin(angle);
                if (point++ == 0) shape.moveTo(x,y); else shape.lineTo(x,y);
            }
            shape.close(); shape.addCircle(12,12,3.5f,Path.Direction.CW); shape.setFillType(Path.FillType.EVEN_ODD); return shape;
        }
        @Override public void draw(Canvas canvas) {
            int save = canvas.save();
            canvas.translate(getBounds().left, getBounds().top);
            canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
            paint.setColor(owner.getCurrentTextColor()); paint.setStyle(filled ? Paint.Style.FILL : Paint.Style.STROKE);
            canvas.drawPath(path, paint); canvas.restoreToCount(save);
        }
        @Override public boolean isStateful() { return true; }
        @Override protected boolean onStateChange(int[] state) { invalidateSelf(); return true; }
        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
        @Override public void setColorFilter(android.graphics.ColorFilter filter) { paint.setColorFilter(filter); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
}
