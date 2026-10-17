package com.fredc.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Retains the live workout process while the phone is locked; does not recreate a session. */
public class WearWorkoutService extends Service {
    private static final int ID = 7302;
    private static final String CHANNEL = "wear-workout";
    private static volatile boolean requested;
    private static volatile WearWorkoutService instance;

    static synchronized void update(Context context, boolean active) {
        if (requested != active) android.util.Log.d("WearBridge", "Workout protection active=" + active);
        if (!active) {
            requested = false;
            context.stopService(new Intent(context, WearWorkoutService.class));
            return;
        }
        if (requested && instance != null) return;
        try {
            requested = true;
            Intent service = new Intent(context, WearWorkoutService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (RuntimeException e) {
            requested = false;
            // Android may forbid a first start in the background. Retry on foreground resume.
            android.util.Log.w("WearBridge", "Workout foreground protection unavailable", e);
        }
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() { super.onCreate(); instance = this; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!requested) { stopSelf(startId); return START_NOT_STICKY; }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.wear_workout_channel), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, ID, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_dumbbell).setContentTitle(getString(R.string.wear_workout_title))
            .setContentText(getString(R.string.wear_workout_description)).setContentIntent(open)
            .setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID, notification);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        android.util.Log.d("WearBridge", "Workout service destroyed; active=" + requested);
        // The desired state belongs to the latest update, not to this dying generation.
        if (instance == this) instance = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
        // stopService/startService may both reach the old instance before destruction.
        // Reconcile after that destruction so the latest active request gets a new instance.
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            if (requested) update(getApplicationContext(), true);
        });
    }
}
