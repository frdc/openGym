package com.fredc.opengym;

import android.content.Context;
import android.os.SystemClock;
import android.util.AtomicFile;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;

/** Private bounded outbox; acknowledgments retire only their exact final snapshot. */
final class WearHeartStore {
    private static WearHeartStore singleton;
    static synchronized WearHeartStore get(Context c) { if (singleton == null) singleton = new WearHeartStore(c.getApplicationContext()); return singleton; }
    final Context context;
    final AtomicFile file;
    final List<WearHeartCapture> captures = new ArrayList<>();
    String contextToken = "", phone = "";
    WearHeartCapture provisional;
    long completionTap = -1;
    String completionToken = "";
    boolean storageFailed, limitReached;
    final Set<String> authorized = new HashSet<>();
    WearHeartStore(Context c) {
        context = c; file = new AtomicFile(new File(c.getFilesDir(), "heart-outbox.json"));
        try {
            JSONObject root = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            contextToken = root.optString("contextToken"); phone = root.optString("phone");
            JSONArray entries = root.optJSONArray("captures");
            if (entries != null && entries.length() <= 200) for (int i = 0; i < entries.length(); i++) {
                JSONObject o = entries.getJSONObject(i);
                WearHeartCapture capture = new WearHeartCapture(o.getString("token"), o.getLong("startedAt"), o.getLong("tapElapsed"));
                capture.effortEndMs = o.optLong("effortEndMs", -1); capture.recoveryEndMs = o.optLong("recoveryEndMs", -1);
                capture.partial = o.optBoolean("partial"); capture.endReason = o.optString("endReason"); capture.packetId = o.optString("requestId");
                if (o.optBoolean("awaitingFlush")) { capture.partial = true; capture.packetId = ""; }
                capture.contextToken = o.optString("contextToken", contextToken); capture.phone = o.optString("phone", phone);
                JSONArray points = o.getJSONArray("raw");
                for (int j = 0; j < Math.min(10000, points.length()); j++) { JSONArray p = points.getJSONArray(j); capture.points.add(new double[] {p.getDouble(0), p.getDouble(1)}); }
                // A process restart loses sensor continuity. Do not silently resume a workout.
                if (capture.recoveryEndMs < 0) { capture.partial = true; capture.close(capture.tapElapsed + (capture.points.isEmpty() ? 0 : (long) capture.points.get(capture.points.size()-1)[0]), "interrupted"); }
                captures.add(capture);
            }
        } catch (Exception ignored) { }
    }
    synchronized WearHeartCapture current() { for (int i = captures.size() - 1; i >= 0; i--) if (captures.get(i).recoveryEndMs < 0) return captures.get(i); return null; }
    synchronized void startTap(long wall, long elapsed) { provisional = new WearHeartCapture("", wall, elapsed); }
    synchronized void completeTap(String token, long elapsed) { completionToken = token; completionTap = elapsed; }
    synchronized void rejected() { provisional = null; completionTap = -1; completionToken = ""; }
    synchronized void sample(long elapsed, double bpm) {
        WearHeartCapture current = current();
        if (storageFailed || limitReached) { if (current != null) current.partial = true; return; }
        List<WearHeartCapture> added = new ArrayList<>();
        for (WearHeartCapture capture : captures) if (capture.awaitingFlush || (capture.contextToken.equals(contextToken) && capture.recoveryEndMs < 0)) if (capture.add(elapsed, bpm)) added.add(capture);
        if (provisional != null && provisional.add(elapsed, bpm)) added.add(provisional);
        try {
            if (bytes().length > 2 * 1024 * 1024 - 16384) {
                limitReached = true;
                for (WearHeartCapture capture : added) { capture.points.removeIf(p -> p[0] == elapsed - capture.tapElapsed); capture.partial = true; }
            }
        } catch (Exception e) { storageFailed = true; if (current != null) current.partial = true; }
    }
    synchronized void snapshot(JSONObject state, String node) {
        authorized.clear(); JSONArray allowed = state.optJSONArray("heartAuthorizedTokens");
        if (allowed != null) for (int i = 0; i < allowed.length(); i++) authorized.add(allowed.optString(i));
        String incoming = state.optString("contextToken");
        WearHeartCapture current = current();
        if (!contextToken.isEmpty() && !incoming.equals(contextToken)) {
            if (current != null) {
                boolean workoutEnded = !state.optBoolean("active") && authorized.contains(current.token);
                current.partial |= !workoutEnded;
                current.close(SystemClock.elapsedRealtime(), workoutEnded ? "workout-ended" : "interrupted");
                current.awaitingFlush = WearHeartService.running; WearHeartService.flushClosed();
            }
            provisional = null; save();
            current = null;
        }
        contextToken = incoming;
        if (node != null && !node.isEmpty()) phone = node;
        JSONObject mark = state.optJSONObject("heartCapture");
        if (mark != null && !mark.optString("token").isEmpty()) {
            String token = mark.optString("token");
            if (current == null || !current.token.equals(token)) {
                // Only an explicit visible tap can authorize a new local capture.
                if (provisional != null && provisional.startedAt == mark.optLong("startedAt") && captures.size() < 200) {
                    if (current != null) { current.close(provisional.tapElapsed, "next-set"); current.awaitingFlush = WearHeartService.running; WearHeartService.flushClosed(); }
                    provisional.token = token; provisional.contextToken = incoming; provisional.phone = phone; captures.add(provisional); current = provisional; provisional = null;
                }
            }
            if (current != null && current.token.equals(token) && "recovery".equals(mark.optString("phase"))) {
                long elapsed = completionToken.equals(token) && completionTap >= 0 ? completionTap : current.tapElapsed + mark.optLong("effortEndMs", 0);
                current.complete(elapsed); completionTap = -1; completionToken = "";
            }
        } else if (current != null) {
            if (!state.optBoolean("active")) { current.close(SystemClock.elapsedRealtime(), "workout-ended"); current.awaitingFlush = WearHeartService.running; WearHeartService.flushClosed(); }
            else if (authorized.contains(current.token)) { current.partial = true; current.close(SystemClock.elapsedRealtime(), "disabled"); current.awaitingFlush = WearHeartService.running; WearHeartService.flushClosed(); }
            else { captures.remove(current); } // Cancelled/removed unauthorized targets cannot receive measurements.
        }
        // A trusted same-context snapshot explicitly invalidates canceled/removed tokens.
        // Older owner contexts remain private until that owner authorizes their replay.
        captures.removeIf(c -> c.contextToken.equals(incoming) && c.phone.equals(phone) && !authorized.contains(c.token));
        try { limitReached = bytes().length >= 2 * 1024 * 1024 - 16384; } catch (Exception e) { storageFailed = true; }
        if (!save()) { WearHeartCapture active = current(); if (active != null) active.partial = true; }
        replay(incoming);
    }
    synchronized void close(String reason) { WearHeartCapture active = current(); if (active != null) active.close(SystemClock.elapsedRealtime(), reason); provisional = null; save(); replay(contextToken); }
    private JSONObject encode(WearHeartCapture c, boolean raw) throws Exception {
        JSONObject o = new JSONObject(); o.put("token", c.token); o.put("startedAt", c.startedAt);
        o.put("effortEndMs", c.effortEndMs < 0 ? JSONObject.NULL : c.effortEndMs);
        o.put("recoveryEndMs", c.recoveryEndMs < 0 ? JSONObject.NULL : c.recoveryEndMs);
        o.put("endReason", c.endReason.isEmpty() ? JSONObject.NULL : c.endReason); o.put("partial", c.partial);
        JSONArray points = new JSONArray(); for (double[] p : raw ? c.points : c.plot()) points.put(new JSONArray().put((long)p[0]).put(p[1]));
        o.put(raw ? "raw" : "points", points);
        if (raw) { o.put("tapElapsed", c.tapElapsed); o.put("requestId", c.packetId); o.put("contextToken", c.contextToken); o.put("phone", c.phone); o.put("awaitingFlush", c.awaitingFlush); }
        else {
            for (boolean recovery : new boolean[] {false, true}) {
                double[] summary = c.summary(recovery);
                o.put(recovery ? "recovery" : "effort", summary == null ? JSONObject.NULL : new JSONObject().put("count", (int)summary[0]).put("mean", summary[1]).put("peak", summary[2]));
            }
            JSONArray milestones = new JSONArray(); double[] base = c.milestone(0);
            if (base != null) for (int seconds : new int[] {0,30,60,120}) {
                double[] p = c.milestone(seconds); if (p != null) milestones.put(new JSONObject().put("seconds", seconds).put("atMs", (long)p[0]).put("bpm", p[1]).put("delta", base[1]-p[1]));
            }
            o.put("milestones", milestones);
        }
        return o;
    }
    synchronized boolean save() {
        FileOutputStream output = null;
        try {
            byte[] bytes = bytes();
            if (bytes.length > 2 * 1024 * 1024) { storageFailed = true; return false; }
            output = file.startWrite(); output.write(bytes); file.finishWrite(output); storageFailed = false; return true;
        } catch (Exception e) { if (output != null) file.failWrite(output); storageFailed = true; return false; }
    }
    private byte[] bytes() throws Exception {
        JSONArray entries = new JSONArray(); for (WearHeartCapture c : captures) entries.put(encode(c, true));
        return new JSONObject().put("contextToken", contextToken).put("phone", phone).put("captures", entries).toString().getBytes(StandardCharsets.UTF_8);
    }
    synchronized boolean canStart() { return captures.size() < 200 && !limitReached && !storageFailed; }
    synchronized void replay(String confirmedContext) {
        if (phone.isEmpty()) return;
        for (WearHeartCapture c : captures) {
            if (c.awaitingFlush) continue;
            if (!authorized.contains(c.token) || !c.phone.equals(phone)) continue;
            try {
                if (c.packetId.isEmpty()) c.packetId = UUID.randomUUID().toString();
                JSONObject measurement = encode(c, false); measurement.remove("token");
                byte[] data = new JSONObject().put("v", 1).put("requestId", c.packetId).put("token", c.token).put("measurement", measurement).toString().getBytes(StandardCharsets.UTF_8);
                if (data.length <= 16384 && save()) Wearable.getMessageClient(context).sendMessage(phone, "/opengym/v1/heart", data);
            } catch (Exception e) { c.partial = true; }
        }
    }
    synchronized void acknowledge(String node, JSONObject ack) {
        if (!phone.equals(node) || ack.optInt("v") != 1) return;
        captures.removeIf(c -> c.phone.equals(node) && c.token.equals(ack.optString("token")) && c.canRetire(ack.optString("requestId"), ack.optString("status")));
        try { limitReached = bytes().length >= 2 * 1024 * 1024 - 16384; } catch (Exception e) { storageFailed = true; }
        save();
    }
    synchronized void flushed(boolean success) {
        flushed(new ArrayList<>(captures), success);
    }
    synchronized List<WearHeartCapture> awaitingFlush() { List<WearHeartCapture> waiting = new ArrayList<>(); for (WearHeartCapture c : captures) if (c.awaitingFlush) waiting.add(c); return waiting; }
    synchronized void flushed(List<WearHeartCapture> waiting, boolean success) {
        for (WearHeartCapture c : waiting) if (c.awaitingFlush) { c.awaitingFlush = false; c.partial |= !success; c.packetId = ""; }
        save(); replay(contextToken);
    }
}
