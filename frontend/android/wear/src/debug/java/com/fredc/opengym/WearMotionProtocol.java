package com.fredc.opengym;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Session-owned sensor snapshot; all calls belong to the Activity's main thread. */
final class WearMotionProtocol {
    static final int RATE_HZ = 25;
    static final long SAMPLE_INTERVAL_MS = 1000 / RATE_HZ;
    static final long SESSION_LIMIT_MS = 30 * 60 * 1000L;
    private static final long VECTOR_MAX_AGE_NANOS = 1_000_000_000L;
    private final String session = UUID.randomUUID().toString();
    private final String model;
    private final String orientation;
    private final boolean hasAccel, hasGyro, hasLinear;
    private double[] q, accel, gyro, linear;
    private long orientationNanos;
    private long accelNanos = -1, gyroNanos = -1, linearNanos = -1;
    private int accuracy;
    private long sequence;

    WearMotionProtocol(String model, String orientation, boolean accel, boolean gyro, boolean linear) {
        this.model = model == null ? "" : model.substring(0, Math.min(model.length(), 128));
        if (!orientation.equals("game_rotation_vector") && !orientation.equals("rotation_vector") && !orientation.equals("unavailable")) {
            throw new IllegalArgumentException("Unknown orientation sensor");
        }
        this.orientation = orientation;
        hasAccel = accel; hasGyro = gyro; hasLinear = linear;
    }

    String hello() {
        try {
            return base("hello").put("model", model).put("orientation", orientation)
                .put("sensors", new JSONObject().put("orientation", hasOrientation())
                    .put("accel", hasAccel).put("gyro", hasGyro).put("linear", hasLinear))
                .put("rateHz", RATE_HZ).toString() + "\n";
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    String sample(long nowNanos) {
        try {
            return base("sample").put("seq", sequence++).put("tMs", nowNanos / 1_000_000.0)
                .put("q", array(q)).put("accel", freshArray(accel, accelNanos, nowNanos))
                .put("gyro", freshArray(gyro, gyroNanos, nowNanos)).put("linear", freshArray(linear, linearNanos, nowNanos))
                .put("accuracy", q == null ? 0 : accuracy)
                .put("orientationAgeMs", q == null ? JSONObject.NULL : Math.max(0, nowNanos - orientationNanos) / 1_000_000.0)
                .toString() + "\n";
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    void rotation(float[] values, long timestampNanos, int accuracy) {
        q = null;
        if (!hasOrientation() || values == null || values.length < 3 || timestampNanos < 0) return;
        double[] result = new double[4];
        for (int i = 0; i < Math.min(4, values.length); i++) {
            if (!Float.isFinite(values[i])) return;
            result[i] = values[i];
        }
        if (values.length == 3) result[3] = Math.sqrt(Math.max(0, 1 - result[0] * result[0] - result[1] * result[1] - result[2] * result[2]));
        double norm = Math.sqrt(result[0] * result[0] + result[1] * result[1] + result[2] * result[2] + result[3] * result[3]);
        if (!Double.isFinite(norm) || norm < 1e-12) return;
        for (int i = 0; i < 4; i++) result[i] /= norm;
        q = result;
        orientationNanos = timestampNanos;
        orientationAccuracy(accuracy);
    }

    void orientationAccuracy(int value) { accuracy = Math.max(0, Math.min(3, value)); }
    void accel(float[] values, long timestampNanos) {
        accel = hasAccel ? vector(values) : null;
        accelNanos = timestampNanos;
    }
    void gyro(float[] values, long timestampNanos) {
        gyro = hasGyro ? vector(values) : null;
        gyroNanos = timestampNanos;
    }
    void linear(float[] values, long timestampNanos) {
        linear = hasLinear ? vector(values) : null;
        linearNanos = timestampNanos;
    }
    boolean hasOrientation() { return !orientation.equals("unavailable"); }
    static boolean allowedPeer(int peerUid, int ownUid) { return peerUid == 0 || peerUid == 2000 || peerUid == ownUid; }

    private JSONObject base(String type) throws JSONException {
        return new JSONObject().put("v", 1).put("type", type).put("session", session);
    }

    private static double[] vector(float[] values) {
        if (values == null || values.length < 3) return null;
        double[] result = new double[3];
        for (int i = 0; i < 3; i++) {
            if (!Float.isFinite(values[i])) return null;
            result[i] = values[i];
        }
        return result;
    }

    private static Object array(double[] values) throws JSONException {
        if (values == null) return JSONObject.NULL;
        JSONArray result = new JSONArray();
        for (double value : values) result.put(value);
        return result;
    }

    private static Object freshArray(double[] values, long timestampNanos, long nowNanos) throws JSONException {
        if (timestampNanos < 0 || nowNanos < timestampNanos || nowNanos - timestampNanos > VECTOR_MAX_AGE_NANOS) return JSONObject.NULL;
        return array(values);
    }
}
