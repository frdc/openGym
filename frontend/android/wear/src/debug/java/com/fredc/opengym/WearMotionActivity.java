package com.fredc.opengym;

import android.app.Activity;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.IOException;

/** Visible, debug-only motion capture; never starts or modifies workout/heart capture. */
public final class WearMotionActivity extends Activity implements SensorEventListener {
    public static final String ACTION_STOP = "com.fredc.opengym.action.STOP_MOTION";
    private static final int SENSOR_PERIOD_US = 20_000;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SensorManager sensors;
    private Sensor orientationSensor, accelSensor, gyroSensor, linearSensor;
    private WearMotionProtocol protocol;
    private WearMotionSocket transport;
    private TextView status, sensorStatus;
    private final Runnable sessionTimeout = () -> { stopCapture(); finish(); };
    private final Runnable transmit = new Runnable() {
        @Override public void run() {
            if (protocol == null || transport == null) return;
            transport.publish(protocol.sample(SystemClock.elapsedRealtimeNanos()));
            // Schedule from now, so a delayed UI thread never catches up with a burst.
            main.postDelayed(this, WearMotionProtocol.SAMPLE_INTERVAL_MS);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sensors = getSystemService(SensorManager.class);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(dp(24), dp(12), dp(24), dp(12));
        TextView title = label(16);
        title.setText(R.string.motion_title);
        content.addView(title);
        status = label(12);
        status.setTag("motion-status");
        content.addView(status);
        sensorStatus = label(12);
        sensorStatus.setPadding(0, dp(6), 0, dp(6));
        content.addView(sensorStatus);
        Button stop = new Button(this);
        stop.setText(R.string.motion_stop);
        stop.setAllCaps(false);
        stop.setTag("motion-stop");
        stop.setOnClickListener(view -> { stopCapture(); finish(); });
        content.addView(stop, new LinearLayout.LayoutParams(-1, dp(48)));
        scroll.addView(content);
        setContentView(scroll);
    }

    @Override protected void onResume() {
        super.onResume();
        if (isFinishing() || ACTION_STOP.equals(getIntent().getAction())) { finish(); return; }
        if (protocol != null) return;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        orientationSensor = register(Sensor.TYPE_GAME_ROTATION_VECTOR);
        if (orientationSensor == null) orientationSensor = register(Sensor.TYPE_ROTATION_VECTOR);
        accelSensor = register(Sensor.TYPE_ACCELEROMETER);
        gyroSensor = register(Sensor.TYPE_GYROSCOPE);
        linearSensor = register(Sensor.TYPE_LINEAR_ACCELERATION);
        String orientation = orientationSensor == null ? "unavailable"
            : orientationSensor.getType() == Sensor.TYPE_GAME_ROTATION_VECTOR ? "game_rotation_vector" : "rotation_vector";
        WearMotionProtocol session = new WearMotionProtocol(Build.MODEL, orientation, accelSensor != null, gyroSensor != null, linearSensor != null);
        protocol = session;
        status.setText(R.string.motion_waiting);
        sensorStatus.setText(getString(R.string.motion_sensors, available(orientationSensor), available(accelSensor), available(gyroSensor)));
        try {
            transport = new WearMotionSocket(session.hello(), state -> main.post(() -> {
                if (protocol != session) return;
                if (state == WearMotionSocket.Status.ERROR) stopCapture();
                status.setText(switch (state) {
                    case CONNECTED -> R.string.motion_connected;
                    case WAITING -> R.string.motion_waiting;
                    case SLOW -> R.string.motion_slow;
                    case ERROR -> R.string.motion_error;
                    default -> R.string.motion_error;
                });
            }));
            main.post(transmit);
            main.postDelayed(sessionTimeout, WearMotionProtocol.SESSION_LIMIT_MS);
        } catch (IOException e) {
            stopCapture();
            status.setText(R.string.motion_error);
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ACTION_STOP.equals(intent.getAction())) { stopCapture(); finish(); }
    }

    @Override protected void onPause() { stopCapture(); super.onPause(); }
    @Override protected void onDestroy() { stopCapture(); super.onDestroy(); }

    private Sensor register(int type) {
        if (sensors == null) return null;
        Sensor sensor = sensors.getDefaultSensor(type);
        if (sensor == null) return null;
        try { return sensors.registerListener(this, sensor, SENSOR_PERIOD_US, 0, main) ? sensor : null; }
        catch (RuntimeException e) { return null; }
    }

    private void stopCapture() {
        main.removeCallbacks(transmit);
        main.removeCallbacks(sessionTimeout);
        protocol = null;
        if (sensors != null) sensors.unregisterListener(this);
        orientationSensor = null; accelSensor = null; gyroSensor = null; linearSensor = null;
        WearMotionSocket previous = transport;
        transport = null;
        if (previous != null) previous.close();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override public void onSensorChanged(SensorEvent event) {
        if (protocol == null) return;
        if (event.sensor == orientationSensor) protocol.rotation(event.values, event.timestamp, event.accuracy);
        else if (event.sensor == accelSensor) protocol.accel(event.values, event.timestamp);
        else if (event.sensor == gyroSensor) protocol.gyro(event.values, event.timestamp);
        else if (event.sensor == linearSensor) protocol.linear(event.values, event.timestamp);
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {
        if (protocol != null && sensor == orientationSensor) protocol.orientationAccuracy(accuracy);
    }

    private String available(Sensor sensor) { return getString(sensor == null ? R.string.motion_unavailable : R.string.motion_available); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(int size) {
        TextView text = new TextView(this);
        text.setTextSize(size);
        text.setGravity(Gravity.CENTER);
        text.setTextColor(0xfff4f4f4);
        return text;
    }
}
