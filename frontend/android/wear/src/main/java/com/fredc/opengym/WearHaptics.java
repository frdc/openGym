package com.fredc.opengym;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;

final class WearHaptics {
    static VibrationAttributes attributes() { return new VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_ALARM).build(); }
    @SuppressWarnings("deprecation")
    static void alarm(Context context) {
        Vibrator vibrator = context.getSystemService(Vibrator.class);
        if (vibrator == null) return;
        VibrationEffect effect = VibrationEffect.createWaveform(new long[] {0, 600, 200, 600, 200, 600}, -1);
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, attributes());
        else vibrator.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
    }
}
