package com.fredc.opengym;

import android.content.Context;
import org.json.JSONObject;

/** One durable, idempotent command. Never retarget a queued tap to a newer set. */
final class WearOutbox {
    private static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("wear-outbox", Context.MODE_PRIVATE); }
    static JSONObject read(Context c) {
        try { String json=prefs(c).getString("command",""); return json.isEmpty()?null:new JSONObject(json); }
        catch(Exception e) { return null; }
    }
    static boolean save(Context c, JSONObject command) { return prefs(c).edit().putString("command",command.toString()).putBoolean("conflict",false).commit(); }
    static boolean conflicted(Context c) { return prefs(c).getBoolean("conflict",false); }
    static void conflict(Context c) { prefs(c).edit().putBoolean("conflict",true).commit(); }
    static void clear(Context c) { prefs(c).edit().clear().commit(); }
}
