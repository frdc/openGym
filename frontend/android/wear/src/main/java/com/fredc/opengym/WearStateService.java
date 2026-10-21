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
    private static WearRefresh manualRefresh;
    private static synchronized WearRefresh refreshFlow(Context source) {
        if (manualRefresh == null) {
            Context c = source.getApplicationContext();
            manualRefresh = new WearRefresh(new WearRefresh.Port() {
                public String context() { return cached(c).optString("contextToken"); }
                public int pending() { return WearStandalone.pending(c); }
                public int heartPending() { return WearHeartStore.get(c).pending(); }
                public boolean conflicted() { return WearStandalone.conflicted(c) || WearOutbox.read(c) != null; }
                public void replay(String node) { WearStateService.replay(c, node); WearHeartStore.get(c).snapshot(cached(c), node); }
                public boolean receive(JSONObject state, long at) { return WearStateService.receive(c, state, at); }
                public void send(String node, String path, JSONObject payload) { Wearable.getMessageClient(c).sendMessage(node, path, payload.toString().getBytes(StandardCharsets.UTF_8)); }
            });
        }
        return manualRefresh;
    }
    static JSONObject remote(Context context) {
        try { return new JSONObject(context.getSharedPreferences("wear-state", MODE_PRIVATE).getString("json", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }
    static JSONObject cached(Context context) { return WearStandalone.view(context, remote(context)); }
    static synchronized boolean receive(Context context, JSONObject state, long sentAt) {
        if (state.optInt("v") != 1 || state.toString().getBytes(StandardCharsets.UTF_8).length > WearProtocol.STATE_BYTES) return false;
        JSONObject old = remote(context);
        long previousSentAt = context.getSharedPreferences("wear-state", MODE_PRIVATE).getLong("sentAt", 0);
        if (sentAt < previousSentAt || !WearProtocol.acceptSnapshot(old.optString("contextToken"), old.optLong("revision"), old.optString("publisherId"), state.optString("contextToken"), state.optLong("revision"), state.optString("publisherId"))) return false;
        if (!context.getSharedPreferences("wear-state", MODE_PRIVATE).edit().putString("json", state.toString()).putLong("sentAt", sentAt).commit()) return false;
        boolean applied = WearStandalone.receive(context, state);
        refresh(context);
        return applied;
    }
    static void refresh(Context context) {
        JSONObject visible = cached(context);
        WearHeartStore.get(context).snapshot(visible, null);
        WearTimer.apply(context, visible, System.currentTimeMillis());
        WearOngoing.update(context, visible);
        context.sendBroadcast(new Intent("com.fredc.opengym.WEAR_STATE").setPackage(context.getPackageName()));
    }
    static void replay(Context context, String node) {
        if (node == null || node.isEmpty()) return;
        JSONObject packet = WearStandalone.packet(context);
        // A new phone/profile must never receive the previous session's journal.
        if (packet == null || !packet.optString("contextToken").equals(remote(context).optString("contextToken"))) return;
        byte[] bytes = packet.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= 65536) Wearable.getMessageClient(context).sendMessage(node, "/opengym/v1/command", bytes);
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
                String json = map.getString("json"); if (json == null || json.length() > WearProtocol.STATE_BYTES) continue;
                receive(this, new JSONObject(json), map.getLong("sentAt"));
                WearHeartStore.get(this).snapshot(cached(this), event.getDataItem().getUri().getHost());
                replay(this, event.getDataItem().getUri().getHost());
            } catch (Exception ignored) { }
        }
    }
    @Override public void onMessageReceived(MessageEvent event) {
        if ("/opengym/v1/refresh".equals(event.getPath()) && event.getData().length <= 4096 && trusted(event.getSourceNodeId())) {
            try { refreshFlow(this).request(event.getSourceNodeId(), new JSONObject(new String(event.getData(), StandardCharsets.UTF_8)), System.currentTimeMillis()); } catch (Exception ignored) { }
            return;
        }
        if ("/opengym/v1/state".equals(event.getPath()) && event.getData().length <= WearProtocol.STATE_MESSAGE_BYTES && trusted(event.getSourceNodeId())) {
            try { refreshFlow(this).state(event.getSourceNodeId(), new JSONObject(new String(event.getData(), StandardCharsets.UTF_8)), System.currentTimeMillis()); } catch (Exception ignored) { }
            return;
        }
        if ("/opengym/v1/reply".equals(event.getPath()) && event.getData().length <= 16384 && trusted(event.getSourceNodeId())) {
            try {
                JSONObject reply = new JSONObject(new String(event.getData(), StandardCharsets.UTF_8));
                if (WearStandalone.acknowledge(this, reply)) { refresh(this); replay(this, event.getSourceNodeId()); refreshFlow(this).advance(System.currentTimeMillis()); }
            } catch (Exception ignored) { }
        }
        if ("/opengym/v1/heart-ack".equals(event.getPath()) && event.getData().length <= 16384 && trusted(event.getSourceNodeId())) {
            try { WearHeartStore.get(this).acknowledge(event.getSourceNodeId(), new JSONObject(new String(event.getData(), StandardCharsets.UTF_8))); } catch (Exception ignored) { }
        }
        if ("/opengym/v1/open".equals(event.getPath()) && event.getData().length > 0 && event.getData().length <= WearProtocol.STATE_MESSAGE_BYTES && trusted(event.getSourceNodeId())) {
            try { WearRemoteOpen.request(this, new JSONObject(new String(event.getData(), StandardCharsets.UTF_8))); } catch (Exception ignored) { }
        }
        // Foreground activity owns sync freshness; durable journal receipts also work in the background.
    }
}
