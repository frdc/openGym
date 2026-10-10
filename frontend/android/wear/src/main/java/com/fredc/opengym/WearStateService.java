package com.fredc.opengym;

import android.content.Context;
import android.content.Intent;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class WearStateService extends WearableListenerService {
    static JSONObject cached(Context context) {
        try { return new JSONObject(context.getSharedPreferences("wear-state", MODE_PRIVATE).getString("json", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }
    static synchronized boolean receive(Context context, JSONObject state, long sentAt) {
        if (state.optInt("v") != 1 || state.toString().getBytes(StandardCharsets.UTF_8).length > 16384) return false;
        JSONObject old = cached(context);
        long previousSentAt = context.getSharedPreferences("wear-state", MODE_PRIVATE).getLong("sentAt", 0);
        if (sentAt < previousSentAt || !WearProtocol.acceptRevision(old.optString("contextToken"), old.optLong("revision"), state.optString("contextToken"), state.optLong("revision"))) return false;
        context.getSharedPreferences("wear-state", MODE_PRIVATE).edit().putString("json", state.toString()).putLong("sentAt", sentAt).apply();
        WearHeartStore.get(context).snapshot(state, null);
        WearTimer.apply(context, state, sentAt);
        WearOngoing.update(context, state);
        context.sendBroadcast(new Intent("com.fredc.opengym.WEAR_STATE").setPackage(context.getPackageName()));
        return true;
    }
    boolean trusted(String nodeId) {
        try { return Tasks.await(Wearable.getCapabilityClient(this).getCapability("opengym_phone_v1", CapabilityClient.FILTER_REACHABLE), 3, TimeUnit.SECONDS).getNodes().stream().anyMatch(n -> n.getId().equals(nodeId)); }
        catch (Exception e) { return false; }
    }
    @Override public void onDataChanged(DataEventBuffer events) {
        for (DataEvent event : events) {
            if (event.getType() != DataEvent.TYPE_CHANGED || !"/opengym/v1/state".equals(event.getDataItem().getUri().getPath()) || !trusted(event.getDataItem().getUri().getHost())) continue;
            try {
                var map = DataMapItem.fromDataItem(event.getDataItem()).getDataMap();
                String json = map.getString("json"); if (json == null || json.length() > 16384) continue;
                receive(this, new JSONObject(json), map.getLong("sentAt"));
                WearHeartStore.get(this).snapshot(cached(this), event.getDataItem().getUri().getHost());
            } catch (Exception ignored) { }
        }
    }
    @Override public void onMessageReceived(MessageEvent event) {
        if ("/opengym/v1/heart-ack".equals(event.getPath()) && event.getData().length <= 16384 && trusted(event.getSourceNodeId())) {
            try { WearHeartStore.get(this).acknowledge(event.getSourceNodeId(), new JSONObject(new String(event.getData(), StandardCharsets.UTF_8))); } catch (Exception ignored) { }
        }
        if ("/opengym/v1/open".equals(event.getPath()) && event.getData().length > 0 && event.getData().length <= 16384 && trusted(event.getSourceNodeId())) {
            try { WearRemoteOpen.request(this, new JSONObject(new String(event.getData(), StandardCharsets.UTF_8))); } catch (Exception ignored) { }
        }
        // Foreground activity owns message responses and freshness. The service only needs data snapshots for alarms.
    }
}
