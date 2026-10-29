package com.fredc.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

final class WearRemoteOpen {
    static final int ID = 44;
    static void request(Context context, JSONObject packet) {
        WearSyncDiagnostics.note(context,"open-request","");
        JSONObject state = packet.optJSONObject("state");
        String id = packet.optString("requestId"); long sentAt = packet.optLong("sentAt");
        if (!WearProtocol.canOpen(packet.optInt("v"), id, sentAt, System.currentTimeMillis(), state != null && state.optBoolean("active"))) {WearSyncDiagnostics.note(context,"open-request","open-rejected");return;}
        var prefs = context.getSharedPreferences("wear-open", Context.MODE_PRIVATE);
        if (id.equals(prefs.getString("requestId", ""))) return;
        if (!WearStateService.receive(context, state, sentAt)) {WearSyncDiagnostics.note(context,"open-request","open-state-rejected");return;}
        if (!prefs.edit().putString("requestId", id).commit()) return;
        Intent intent = new Intent(context, WearActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("remoteOpen", true);
        // Android may silently deny a background launch. Leave a tap-to-open alternative until onResume confirms visibility.
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel("wear-open", context.getString(R.string.open_workout), NotificationManager.IMPORTANCE_DEFAULT);
        channel.setSound(null, null); channel.enableVibration(false); manager.createNotificationChannel(channel);
        PendingIntent open = PendingIntent.getActivity(context, ID, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try { manager.notify(ID, new Notification.Builder(context, "wear-open").setSmallIcon(R.drawable.ic_stat_dumbbell).setContentTitle(context.getString(R.string.open_workout)).setContentIntent(open).setAutoCancel(true).setLocalOnly(true).build()); }
        catch (SecurityException ignored) {WearSyncDiagnostics.note(context,"open-notification","background-launch");}
        try { context.startActivity(intent); } catch (RuntimeException ignored) {WearSyncDiagnostics.note(context,"open-notification","background-launch");}
    }
}
