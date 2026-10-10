package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class WearTimerReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        synchronized (WearTimer.class) {
            SharedPreferences p = WearTimer.prefs(context); String key = intent.getStringExtra("key");
            if (key == null || !WearProtocol.shouldFire(key, p.getString("key", ""), p.getString("fired", ""), p.getLong("endsAt", 0), System.currentTimeMillis())) return;
            // commit before vibrating: duplicate delivery cannot repeat the alert.
            if (!p.edit().putString("fired", key).putBoolean("armed", false).commit()) return;
            if (p.getBoolean("vibrate", true)) {
                WearHaptics.alarm(context);
            }
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            NotificationChannel channel = new NotificationChannel("wear-rest", context.getString(R.string.rest), NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(null, null); channel.enableVibration(false); manager.createNotificationChannel(channel);
            PendingIntent open = PendingIntent.getActivity(context, 0, new Intent(context, WearActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try { manager.notify(42, new Notification.Builder(context, "wear-rest").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(context.getString(R.string.ready)).setContentText(context.getString(R.string.rest)).setContentIntent(open).setAutoCancel(true).setLocalOnly(true).build()); }
            catch (SecurityException ignored) { /* vibration still follows app preference */ }
        }
    }
}
