package com.fredc.opengym;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.health.services.client.HealthServices;
import androidx.health.services.client.ExerciseClient;
import androidx.health.services.client.ExerciseUpdateCallback;
import androidx.health.services.client.data.*;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.Collections;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** Optional user-started Health Services session; no wake lock or background startup. */
public class WearHeartService extends Service implements ExerciseUpdateCallback {
    static volatile boolean running;
    static volatile double latestBpm;
    static volatile long latestElapsed;
    static volatile int status = R.string.heart_off;
    private static WearHeartService instance;
    private ExerciseClient client;
    private boolean owned, ending, stopping;
    private String contextToken;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Executor executor = runnable -> handler.post(runnable);
    private final Runnable pulse = new Runnable() {
        @Override public void run() {
            if (ending || stopping) return;
            var state = WearStateService.cached(WearHeartService.this);
            if (checkSelfPermission(Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED || !state.optBoolean("active") || !contextToken.equals(state.optString("contextToken"))) { stopCollection("interrupted"); return; }
            WearHeartStore store = WearHeartStore.get(WearHeartService.this); store.save(); store.replay(contextToken);
            handler.postDelayed(this, 5000);
        }
    };
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() { super.onCreate(); instance = this; }
    static void flushClosed() {
        WearHeartService service = instance;
        if (service == null) return;
        service.handler.post(() -> {
            WearHeartStore store = WearHeartStore.get(service);
            var waiting = store.awaitingFlush();
            if (!service.owned || service.client == null) { store.flushed(waiting, false); return; }
            var flush = service.client.flushAsync();
            flush.addListener(() -> { boolean success = true; try { flush.get(); } catch (Exception e) { success = false; } store.flushed(waiting, success); }, service.executor);
            service.handler.postDelayed(() -> store.flushed(waiting, false), 3000);
        });
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop".equals(intent.getAction())) { getSharedPreferences("heart-session",MODE_PRIVATE).edit().remove("context").apply(); stopCollection("disabled"); return START_NOT_STICKY; }
        if (ending || stopping) return START_NOT_STICKY;
        if (running) return START_NOT_STICKY;
        var state = WearStateService.cached(this);
        contextToken=intent.getStringExtra("contextToken");
        if (!sessionCurrent()) { status=R.string.heart_unavailable; stopSelf(); return START_NOT_STICKY; }
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel("heart-workout", getString(R.string.heart_title), NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 42, new Intent(this, WearActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            startForeground(4201, new Notification.Builder(this, "heart-workout").setSmallIcon(R.drawable.ic_stat_dumbbell).setContentTitle(getString(R.string.heart_title)).setContentText(getString(R.string.heart_acquiring)).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build());
            running = true; status = R.string.heart_acquiring; client = HealthServices.getClient(this).getExerciseClient();
            result(client.getCurrentExerciseInfoAsync(), info -> {
                if (info.getExerciseTrackedStatus() == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) { reconnectOwnedExercise(); return; }
                if (info.getExerciseTrackedStatus() != ExerciseTrackedStatus.NO_EXERCISE_IN_PROGRESS) { fail(R.string.heart_conflict); return; }
                result(client.getCapabilitiesAsync(), capabilities -> {
                    ExerciseType chosen = null;
                    for (ExerciseType type : new ExerciseType[] {ExerciseType.STRENGTH_TRAINING, ExerciseType.WEIGHTLIFTING, ExerciseType.WORKOUT}) {
                        if (capabilities.getSupportedExerciseTypes().contains(type) && capabilities.getExerciseTypeCapabilities(type).getSupportedDataTypes().contains(DataType.HEART_RATE_BPM)) { chosen = type; break; }
                    }
                    if (chosen == null) { fail(R.string.heart_unavailable); return; }
                    client.setUpdateCallback(executor, this);
                    ExerciseConfig config = ExerciseConfig.builder(chosen).setDataTypes(Collections.singleton(DataType.HEART_RATE_BPM)).setIsGpsEnabled(false).setIsAutoPauseAndResumeEnabled(false).build();
                    // Capabilities may take time; recheck ownership immediately before starting.
                    result(client.getCurrentExerciseInfoAsync(), latest -> {
                        if (latest.getExerciseTrackedStatus() == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) { reconnectOwnedExercise(); return; }
                        if (latest.getExerciseTrackedStatus() != ExerciseTrackedStatus.NO_EXERCISE_IN_PROGRESS) { fail(R.string.heart_conflict); return; }
                        var start = client.startExerciseAsync(config);
                        start.addListener(() -> {
                            try {
                                start.get(); owned = true;
                                if (ending || stopping) client.endExerciseAsync(); else if (!sessionCurrent()) stopCollection("interrupted"); else handler.post(pulse);
                            } catch (Exception e) { if (!ending) fail(R.string.heart_unavailable); }
                        }, executor);
                    });
                });
            });
        } catch (Exception e) { fail(R.string.heart_unavailable); }
        return START_NOT_STICKY;
    }
    private boolean sessionCurrent() {
        var state=WearStateService.cached(this);
        return WearHeartResume.allowed(contextToken,state.optString("contextToken"),state.optBoolean("active"),checkSelfPermission(Manifest.permission.BODY_SENSORS)==PackageManager.PERMISSION_GRANTED,true)
            && contextToken.equals(getSharedPreferences("heart-session",MODE_PRIVATE).getString("context",""));
    }
    private <T> void result(ListenableFuture<T> future, Consumer<T> success) {
        future.addListener(() -> { try { if (!ending && !stopping) { if (!sessionCurrent()) { stopCollection("interrupted"); return; } success.accept(future.get()); } } catch (Exception e) { fail(R.string.heart_unavailable); } }, executor);
    }
    private void reconnectOwnedExercise() {
        // Health Services can retain our exercise when an APK update kills the process.
        // Reattach only to an exercise owned by this package; never replace another app.
        owned = true;
        client.setUpdateCallback(executor, this);
        handler.post(pulse);
    }
    private void fail(int message) { status = message; stopCollection("interrupted"); }
    private void stopCollection(String reason) {
        if (ending || stopping) return; stopping = true; running = false; latestBpm = 0; handler.removeCallbacks(pulse);
        long boundary = SystemClock.elapsedRealtime();
        Runnable finish = () -> {
            if (ending) return; ending = true;
            WearHeartStore store = WearHeartStore.get(this);
            synchronized (store) { WearHeartCapture capture = store.current(); if (capture != null) { capture.close(boundary, reason); store.save(); store.replay(contextToken); } }
            if (owned && client != null) client.endExerciseAsync();
            if (client != null) client.clearUpdateCallbackAsync(this);
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
        };
        if (owned && client != null) {
            var flush = client.flushAsync();
            flush.addListener(() -> { try { flush.get(); } catch (Exception e) { WearHeartCapture c = WearHeartStore.get(this).current(); if (c != null) c.partial = true; } finish.run(); }, executor);
            handler.postDelayed(() -> { if (!ending) { WearHeartCapture c = WearHeartStore.get(this).current(); if (c != null) c.partial = true; finish.run(); } }, 3000);
        } else finish.run();
    }
    @Override public void onDestroy() { stopCollection("interrupted"); if (instance == this) instance = null; super.onDestroy(); }
    @Override public void onRegistered() { }
    @Override public void onRegistrationFailed(Throwable e) { fail(R.string.heart_unavailable); }
    @Override public void onLapSummaryReceived(ExerciseLapSummary summary) { }
    @Override public void onAvailabilityChanged(DataType<?, ?> type, Availability availability) {
        if (!DataType.HEART_RATE_BPM.equals(type)) return;
        if (!DataTypeAvailability.AVAILABLE.equals(availability)) { latestBpm = 0; status = DataTypeAvailability.ACQUIRING.equals(availability) ? R.string.heart_acquiring : R.string.heart_unavailable; }
    }
    @Override public void onExerciseUpdateReceived(ExerciseUpdate update) {
        if (ending) return;
        if (update.getExerciseStateInfo().getState().isEnded() && !stopping) { fail(R.string.heart_unavailable); return; }
        for (SampleDataPoint<Double> point : update.getLatestMetrics().getData(DataType.HEART_RATE_BPM)) {
            if (!(point.getAccuracy() instanceof HeartRateAccuracy accuracy)) continue;
            var quality = accuracy.getSensorStatus();
            if (!quality.equals(HeartRateAccuracy.SensorStatus.ACCURACY_HIGH) && !quality.equals(HeartRateAccuracy.SensorStatus.ACCURACY_MEDIUM) && !quality.equals(HeartRateAccuracy.SensorStatus.ACCURACY_LOW)) continue;
            long timestamp = point.getTimeDurationFromBoot().toMillis(); double bpm = point.getValue();
            if (!Double.isFinite(bpm) || bpm < 25 || bpm > 250 || timestamp > SystemClock.elapsedRealtime()) continue;
            WearHeartStore.get(this).sample(timestamp, bpm);
            if (timestamp >= latestElapsed) { latestBpm = bpm; latestElapsed = timestamp; status = R.string.heart_acquiring; }
        }
    }
}
