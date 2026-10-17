package com.fredc.opengym;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import java.util.HashMap;
import java.util.Map;

/** Keeps only the asynchronous request/response window awake, never the phone screen. */
final class WearRequestLocks {
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static final Map<String, PowerManager.WakeLock> locks = new HashMap<>();
    static synchronized void hold(Context context, String node, String requestId) {
        if (node == null || requestId == null || requestId.isEmpty() || requestId.length() > 100) return;
        String key = node + ":" + requestId;
        finish(node, requestId);
        try {
            PowerManager manager = context.getSystemService(PowerManager.class);
            PowerManager.WakeLock lock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:wear-request");
            lock.setReferenceCounted(false);
            lock.acquire(10000);
            locks.put(key, lock);
            handler.postDelayed(() -> expire(key, lock), 10000);
        } catch (RuntimeException e) { android.util.Log.w("WearBridge", "Could not hold CPU for request", e); }
    }
    private static synchronized void expire(String key, PowerManager.WakeLock expected) {
        if (locks.get(key) != expected) return;
        locks.remove(key); release(expected);
    }
    static synchronized void finish(String node, String requestId) {
        release(locks.remove(node + ":" + requestId));
    }
    static synchronized void clear() {
        for (PowerManager.WakeLock lock : locks.values()) release(lock);
        locks.clear();
    }
    private static void release(PowerManager.WakeLock lock) {
        if (lock != null && lock.isHeld()) lock.release();
    }
}
