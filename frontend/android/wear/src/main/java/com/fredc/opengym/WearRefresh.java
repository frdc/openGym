package com.fredc.opengym;

import org.json.JSONObject;

/** Correlated pull-before-publish handshake. Journals remain owned by their durable stores. */
final class WearRefresh {
    interface Port {
        String context(); int pending(); int heartPending(); boolean conflicted();
        default boolean authorized() {return false;}
        default JSONObject replayHint() {return null;}
        void replay(String node);
        void send(String node, String path, JSONObject payload);
        boolean receive(JSONObject state, long sentAt);
    }
    private final Port port;
    private String node = "", id = "", context = "";
    private long deadline;
    private boolean awaitingState,requestedAuthorization;
    WearRefresh(Port port) { this.port = port; }
    synchronized void request(String sender, JSONObject request, long now) throws Exception {
        String nextId = request.optString("requestId"), nextContext = request.optString("contextToken");
        long sent = request.optLong("sentAt");
        if (request.optInt("v") != 1 || nextId.isEmpty() || nextId.length() > 100 || nextContext.isEmpty() || nextContext.length() > 100
                || sender == null || sender.isEmpty() || sent <= 0 || now - sent < -5000 || now - sent >= 30000) return;
        node = sender; id = nextId; context = nextContext; deadline = sent + 30000; awaitingState = false;requestedAuthorization=false;
        advance(now);
    }
    synchronized void advance(long now) throws Exception {
        if (id.isEmpty() || now >= deadline) { id = ""; return; }
        if(awaitingState) return;
        if (port.conflicted() || port.pending() > 0 && !context.equals(port.context()) && !port.authorized()) {
            if(!requestedAuthorization && port.replayHint()!=null) {requestedAuthorization=true;requestState();return;}
            finish("error", "sync-conflict"); return;
        }
        port.replay(node);
        if (port.pending() > 0 || awaitingState) return;
        requestState();
    }
    private void requestState() throws Exception {
        awaitingState=true;
        port.send(node,"/opengym/v1/sync",new JSONObject().put("v",1).put("requestId",id).put("replay",port.replayHint()));
    }
    synchronized boolean state(String sender, JSONObject packet, long now) throws Exception {
        if (id.isEmpty() || !awaitingState || now >= deadline || !node.equals(sender) || !id.equals(packet.optString("syncId"))) return false;
        JSONObject state = packet.optJSONObject("state");
        if (state == null || !state.optBoolean("localReady") || !context.equals(state.optString("contextToken"))) { finish("error", "sync-unconfirmed"); return true; }
        if (!port.receive(state, packet.optLong("sentAt"))) { finish("error", "sync-unconfirmed"); return true; }
        awaitingState = false;
        if (port.conflicted()) finish("error", "sync-conflict");
        else if (port.pending() > 0) advance(now);
        else { port.replay(node); finish("ok", ""); }
        return true;
    }
    private void finish(String status, String code) throws Exception {
        JSONObject result = new JSONObject().put("v", 1).put("requestId", id).put("contextToken", context)
            .put("status", status).put("code", code).put("heartPending", port.heartPending());
        id = ""; awaitingState = false;
        port.send(node, "/opengym/v1/refresh-result", result);
    }
}
