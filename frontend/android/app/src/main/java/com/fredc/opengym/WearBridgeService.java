package com.fredc.opengym;

import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class WearBridgeService extends WearableListenerService {
    @Override public void onMessageReceived(MessageEvent event) {
        if (!WearBridgeGuard.allowed(event.getPath(), event.getData().length)) return;
        try {
            boolean trusted = Tasks.await(Wearable.getCapabilityClient(this).getCapability("opengym_watch_v1", CapabilityClient.FILTER_REACHABLE), 3, TimeUnit.SECONDS)
                .getNodes().stream().anyMatch(n -> n.getId().equals(event.getSourceNodeId()));
            if (!trusted) return;
            JSONObject payload = new JSONObject(new String(event.getData(), StandardCharsets.UTF_8));
            if (payload.optInt("v") != 1) return;
            WearBridgePlugin.trace(this,"incoming-bytes",event.getData().length);
            if ("/opengym/v1/refresh-result".equals(event.getPath())) {
                WearBridgePlugin.deliverSync(event.getSourceNodeId(), payload);
                return;
            }
            if ("/opengym/v1/heart".equals(event.getPath())) {
                WearBridgePlugin.trace(this,"heart-rx",1);
                WearInboxStore.get(this).offer(event.getSourceNodeId(),"heart",payload);
                WearBridgePlugin.deliverInbox();
                return;
            }
            if ("/opengym/v1/command".equals(event.getPath()) && "standalone-sync".equals(payload.optString("action"))) {
                WearBridgePlugin.trace(this,"journal-rx",1);
                WearInboxStore.get(this).offer(event.getSourceNodeId(),"command",payload);
                WearBridgePlugin.deliverInbox();
                return;
            }
            String syncId = event.getPath().endsWith("/sync") ? payload.optString("requestId") : null;
            if (syncId != null && (syncId.isEmpty() || syncId.length() > 100)) return;
            if (syncId != null) {
                String key = payload.optString("alarmKey");
                if (key.length() <= 160) getSharedPreferences("wear-ack", MODE_PRIVATE).edit().putString("alarmKey", key).apply();
            }
            if (!WearBridgePlugin.deliver(event.getSourceNodeId(), payload, syncId)) {
                JSONObject response = new JSONObject(); response.put("v", 1); response.put("requestId", payload.optString("requestId")); response.put("status", "error"); response.put("code", "unavailable");
                Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(), "/opengym/v1/reply", response.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {WearBridgePlugin.trace(this,"receive-failed",0);}
    }
}
