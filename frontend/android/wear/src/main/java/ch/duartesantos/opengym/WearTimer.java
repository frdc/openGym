package ch.duartesantos.opengym;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;

final class WearTimer {
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("wear-timer", Context.MODE_PRIVATE); }
    static boolean canSchedule(Context context) { return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms(); }
    static PendingIntent intent(Context context, String key) {
        return PendingIntent.getBroadcast(context, 42, new Intent(context, WearTimerReceiver.class).putExtra("key", key), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized boolean apply(Context context, JSONObject state, long phoneSentAt) {
        JSONObject timer = state.optJSONObject("timer");
        SharedPreferences p = prefs(context);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (!state.optBoolean("active") || timer == null || timer.optBoolean("paused") || timer.optBoolean("ready")) {
            alarms.cancel(intent(context, "")); p.edit().remove("token").remove("endsAt").remove("key").apply(); return true;
        }
        String token = timer.optString("timerToken"), key = token + ":" + timer.optLong("endsAt");
        if (token.isEmpty()) return false;
        p.edit().putBoolean("vibrate", state.optBoolean("vibrate", true)).apply();
        if (!WearProtocol.shouldArm(key, p.getString("key", ""), p.getString("fired", ""), p.getBoolean("armed", false))) return p.getBoolean("armed", false);
        alarms.cancel(intent(context, ""));
        // Unix time is shared by the devices. Adding transport latency would lengthen rest.
        long endsAt = timer.optLong("endsAt");
        // Do not deliver an old cached timer that expired before this snapshot was sent.
        boolean armed = endsAt > System.currentTimeMillis() && canSchedule(context);
        p.edit().putString("token", token).putString("key", key).putLong("endsAt", endsAt).putBoolean("vibrate", state.optBoolean("vibrate", true)).putBoolean("armed", armed).apply();
        if (armed) {
            try { alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, intent(context, key)); }
            catch (SecurityException e) { p.edit().putBoolean("armed", false).apply(); return false; }
        }
        return armed;
    }
}
