package com.fredc.opengym;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "WearBridge")
public class WearBridgePlugin extends Plugin {
    private volatile JSObject latestState;
    @PluginMethod public void sync(PluginCall call) {
        JSObject request = call.getObject("request");
        JSObject state = latestState;
        if (request == null || request.optInt("v") != 1 || request.optString("requestId").isEmpty() || request.optString("requestId").length() > 100
                || state == null || !state.optBoolean("localReady") || !state.optBoolean("active")
                || !state.optString("contextToken").equals(request.optString("contextToken")) || request.toString().length() > 4096) { call.reject("wear unavailable"); return; }
        Wearable.getCapabilityClient(getContext()).getCapability("opengym_watch_v1", CapabilityClient.FILTER_REACHABLE).addOnSuccessListener(capability -> {
            if (capability.getNodes().size() != 1) { call.reject("wear unavailable"); return; }
            String node = capability.getNodes().iterator().next().getId();
            Wearable.getMessageClient(getContext()).sendMessage(node, "/opengym/v1/refresh", request.toString().getBytes(StandardCharsets.UTF_8))
                .addOnSuccessListener(id -> { JSObject result = new JSObject(); result.put("nodeId", node); call.resolve(result); })
                .addOnFailureListener(error -> call.reject("wear unavailable"));
        }).addOnFailureListener(error -> call.reject("wear unavailable"));
    }
    static void deliverSync(String node, JSONObject response) {
        WearBridgePlugin plugin = instance;
        if (plugin == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            if (instance != plugin) return;
            JSObject event = new JSObject(); event.put("nodeId", node); event.put("response", response);
            plugin.notifyListeners("sync", event);
        });
    }
    @PluginMethod public void open(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null || !state.optBoolean("active") || state.toString().getBytes(StandardCharsets.UTF_8).length > 131072) { call.reject("invalid state"); return; }
        final long sentAt = System.currentTimeMillis();
        Wearable.getCapabilityClient(getContext()).getCapability("opengym_watch_v1", CapabilityClient.FILTER_REACHABLE).addOnSuccessListener(capability -> {
            JSObject latest = latestState;
            if (latest == null || !WearBridgeGuard.currentOpenRequest(latest.optString("contextToken"), latest.optLong("revision"), latest.optBoolean("active"), state.optString("contextToken"), state.optLong("revision"))) { call.reject("stale context"); return; }
            if (capability.getNodes().size() != 1) { call.reject("wear unavailable"); return; }
            String node = capability.getNodes().iterator().next().getId();
            JSObject packet = new JSObject(); packet.put("v", 1); packet.put("requestId", UUID.randomUUID().toString()); packet.put("sentAt", sentAt); packet.put("state", state);
            Wearable.getMessageClient(getContext()).sendMessage(node, "/opengym/v1/open", packet.toString().getBytes(StandardCharsets.UTF_8))
                .addOnSuccessListener(id -> { JSObject result = new JSObject(); result.put("requested", true); call.resolve(result); }).addOnFailureListener(e -> call.reject("wear unavailable"));
        }).addOnFailureListener(e -> call.reject("wear unavailable"));
    }
    private static volatile WearBridgePlugin instance;
    @Override public void load() { instance = this; }
    @Override protected void handleOnResume() {
        JSObject state = latestState;
        if (state != null) WearWorkoutService.update(getContext(), state.optBoolean("active"));
    }
    @Override protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
            WearRequestLocks.clear();
            WearWorkoutService.update(getContext(), false);
        }
        super.handleOnDestroy();
    }
    static boolean deliver(String node, JSONObject command, String syncId) {
        WearBridgePlugin plugin = instance;
        if (plugin == null) return false;
        String requestId = syncId == null ? command.optString("requestId") : syncId;
        WearRequestLocks.hold(plugin.getContext(), node, requestId);
        new Handler(Looper.getMainLooper()).post(() -> {
            if (instance != plugin) { WearRequestLocks.finish(node, requestId); return; }
            JSObject event = new JSObject(); event.put("nodeId", node);
            if (syncId != null) event.put("syncId", syncId); else event.put("command", command);
            plugin.notifyListeners("command", event);
        });
        return true;
    }
    static boolean deliverHeart(String node, JSONObject packet) {
        WearBridgePlugin plugin = instance;
        if (plugin == null) return false;
        String requestId = packet.optString("requestId");
        WearRequestLocks.hold(plugin.getContext(), node, requestId);
        new Handler(Looper.getMainLooper()).post(() -> {
            if (instance != plugin) { WearRequestLocks.finish(node, requestId); return; }
            JSObject event = new JSObject(); event.put("nodeId", node); event.put("packet", packet);
            plugin.notifyListeners("heart", event);
        });
        return true;
    }
    @PluginMethod public void getHeartBindings(PluginCall call) {
        String key = WearHeartJournalGuard.ownerKey(call.getString("ownerKey"));
        if (key == null) { call.reject("invalid owner"); return; }
        try {
            JSONObject bindings = new JSONObject(getContext().getSharedPreferences("wear-heart-journal", android.content.Context.MODE_PRIVATE).getString(key, "{}"));
            JSObject result = new JSObject(); result.put("bindings", bindings); call.resolve(result);
        } catch (Exception e) { call.reject("invalid journal"); }
    }
    @PluginMethod public void saveHeartBindings(PluginCall call) {
        String key = WearHeartJournalGuard.ownerKey(call.getString("ownerKey"));
        JSObject bindings = call.getObject("bindings");
        if (key == null || bindings == null || !WearHeartJournalGuard.validJournal(bindings.length(), bindings.toString().getBytes(StandardCharsets.UTF_8).length)) { call.reject("invalid journal"); return; }
        // Acknowledgments must follow the durable commit, never asynchronous apply().
        if (!getContext().getSharedPreferences("wear-heart-journal", android.content.Context.MODE_PRIVATE).edit().putString(key, bindings.toString()).commit()) { call.reject("journal write failed"); return; }
        call.resolve();
    }
    @PluginMethod public void replyHeart(PluginCall call) {
        JSObject response = call.getObject("response"); String node = call.getString("nodeId");
        if (node == null || node.isEmpty() || response == null || response.optInt("v") != 1 || !WearHeartJournalGuard.validAck(response.optString("requestId"), response.optString("token"), response.optString("status"))) { call.reject("invalid acknowledgment"); return; }
        Wearable.getMessageClient(getContext()).sendMessage(node, "/opengym/v1/heart-ack", response.toString().getBytes(StandardCharsets.UTF_8))
            .addOnCompleteListener(task -> WearRequestLocks.finish(node, response.optString("requestId")))
            .addOnSuccessListener(id -> call.resolve()).addOnFailureListener(error -> call.reject("wear unavailable"));
    }
    @PluginMethod public void publish(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null || state.toString().getBytes(StandardCharsets.UTF_8).length > 131072) { call.reject("invalid state"); return; }
        latestState = state;
        WearWorkoutService.update(getContext(), state.optBoolean("active"));
        PutDataMapRequest request = PutDataMapRequest.create("/opengym/v1/state");
        request.getDataMap().putString("json", state.toString());
        request.getDataMap().putLong("sentAt", System.currentTimeMillis());
        Wearable.getDataClient(getContext()).putDataItem(request.asPutDataRequest().setUrgent())
            .addOnSuccessListener(item -> {
                String node = call.getString("nodeId"), syncId = call.getString("syncId");
                JSObject packet = new JSObject(); packet.put("state", state); packet.put("syncId", syncId == null ? "" : syncId); packet.put("sentAt", System.currentTimeMillis());
                byte[] bytes = packet.toString().getBytes(StandardCharsets.UTF_8);
                if (node != null) Wearable.getMessageClient(getContext()).sendMessage(node, "/opengym/v1/state", bytes)
                    .addOnCompleteListener(task -> WearRequestLocks.finish(node, syncId));
                call.resolve();
            }).addOnFailureListener(error -> {
                WearRequestLocks.finish(call.getString("nodeId"), call.getString("syncId"));
                call.reject("wear unavailable");
            });
    }
    @PluginMethod public void reply(PluginCall call) {
        JSObject response = call.getObject("response"); String node = call.getString("nodeId");
        if (response == null || node == null) { call.reject("invalid reply"); return; }
        Wearable.getMessageClient(getContext()).sendMessage(node, "/opengym/v1/reply", response.toString().getBytes(StandardCharsets.UTF_8))
            .addOnCompleteListener(task -> WearRequestLocks.finish(node, response.optString("requestId")))
            .addOnSuccessListener(id -> call.resolve()).addOnFailureListener(error -> call.reject("wear unavailable"));
    }
    @PluginMethod public void clear(PluginCall call) {
        // Detaching the WebView is not the user ending/replacing the workout.
        JSObject state = new JSObject(); state.put("v", 1); state.put("active", false); state.put("localReady", false); state.put("contextToken", ""); state.put("revision", 0);
        latestState = state;
        WearRequestLocks.clear();
        WearWorkoutService.update(getContext(), false);
        PutDataMapRequest request = PutDataMapRequest.create("/opengym/v1/state"); request.getDataMap().putString("json", state.toString()); request.getDataMap().putLong("sentAt", System.currentTimeMillis());
        Wearable.getDataClient(getContext()).putDataItem(request.asPutDataRequest().setUrgent()).addOnCompleteListener(t -> call.resolve());
    }
    @PluginMethod public void status(PluginCall call) {
        Wearable.getNodeClient(getContext()).getConnectedNodes().addOnSuccessListener(nodes -> { JSObject result = new JSObject(); result.put("connected", !nodes.isEmpty()); call.resolve(result); }).addOnFailureListener(e -> call.reject("wear unavailable"));
    }
}
