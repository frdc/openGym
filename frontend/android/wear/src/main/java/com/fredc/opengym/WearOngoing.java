package com.fredc.opengym;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import androidx.wear.ongoing.OngoingActivity;
import org.json.JSONObject;

final class WearOngoing {
    static final int ID = 43;
    static void update(Context context, JSONObject state) {
        update(context, state, ID);
    }
    static void update(Context context, JSONObject state, int id) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!state.optBoolean("active")) { manager.cancel(id); return; }
        // A workout indicator must never buzz when a snapshot/heartbeat updates it.
        NotificationChannel channel = new NotificationChannel("wear-workout", context.getString(R.string.workout_active), NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); channel.enableVibration(false); channel.setShowBadge(false); manager.createNotificationChannel(channel);
        JSONObject current = state.optJSONObject("current");
        String label = current == null ? context.getString(R.string.workout_active) : current.optString("name") + " · " + current.optString("setLabel");
        PendingIntent open = PendingIntent.getActivity(context, id, new Intent(context, WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, "wear-workout")
            .setSmallIcon(R.drawable.ic_stat_dumbbell).setContentTitle(context.getString(R.string.workout_active)).setContentText(label)
            .setContentIntent(open).setCategory("workout").setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setLocalOnly(true);
        OngoingActivity ongoing = new OngoingActivity.Builder(context, id, builder).setStaticIcon(R.drawable.ic_stat_dumbbell).setTouchIntent(open).build();
        ongoing.apply(context);
        try { manager.notify(id, builder.build()); } catch (SecurityException ignored) { /* UI still offers permission request */ }
    }
}
