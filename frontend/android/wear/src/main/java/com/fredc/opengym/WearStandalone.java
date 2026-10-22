package com.fredc.opengym;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** One durable document owns the prepared session, runtime and ordered event journal. */
final class WearStandalone {
    private static final int MAX_EVENTS = 1024, MAX_STEPS = 200, MAX_SNAPSHOT_BYTES = 128 * 1024, MAX_COMMAND_BYTES = 64 * 1024;
    private static final Set<String> ACTIONS = Set.of("start", "complete", "edit-set", "pause-effort", "resume-effort", "cancel-effort", "pause", "resume", "plus15", "skip");
    interface Store { String read(); boolean write(String value); }
    private final Store store;
    WearStandalone(Store store) { this.store = store; }

    private static WearStandalone engine(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("wear-standalone", Context.MODE_PRIVATE);
        return new WearStandalone(new Store() {
            public String read() { return prefs.getString("document", null); }
            public boolean write(String value) {
                String before = read();
                boolean saved = prefs.edit().putString("document", value).commit();
                // SharedPreferences updates its memory before writing the file. Roll back
                // that memory on a failed commit, so a failed action never appears saved.
                if (!saved) prefs.edit().putString("document", before).commit();
                return saved;
            }
        });
    }
    static synchronized JSONObject view(Context context, JSONObject remote) { return engine(context).view(remote); }
    static synchronized boolean receive(Context context, JSONObject remote) { return engine(context).receive(remote); }
    static synchronized boolean perform(Context context, JSONObject event) { return engine(context).perform(event); }
    static synchronized JSONObject packet(Context context) { return engine(context).packet(); }
    static synchronized boolean acknowledge(Context context, JSONObject reply) { return engine(context).acknowledge(reply); }
    static synchronized int pending(Context context) { return engine(context).pending(); }
    static synchronized boolean conflicted(Context context) { return engine(context).conflicted(); }
    static synchronized boolean available(Context context) { return engine(context).available(); }
    static synchronized boolean discard(Context context) { return engine(context).discard(); }

    private JSONObject read() {
        try {
            String text = store.read();
            if (text == null) return null;
            JSONObject doc = new JSONObject(text);
            if (doc.optInt("v") != 1 || doc.optJSONArray("events") == null || doc.optJSONArray("steps") == null || doc.optJSONObject("base") == null || doc.optJSONObject("runtime") == null) return null;
            return doc;
        } catch (Exception e) { return null; }
    }
    private boolean save(JSONObject doc) { try { return store.write(doc == null ? null : doc.toString()); } catch (Exception e) { return false; } }
    private static JSONObject copy(JSONObject object) throws Exception { return new JSONObject(object.toString()); }
    private static int bytes(JSONObject object) { return object.toString().getBytes(StandardCharsets.UTF_8).length; }
    private static boolean token(String text) { return text != null && !text.isEmpty() && text.length() <= 100; }
    private static boolean integer(Object value, long min, long max) {
        if (!(value instanceof Number)) return false;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number == Math.rint(number) && number >= min && number <= max;
    }
    private static int lastSeq(JSONObject doc) {
        JSONArray events = doc.optJSONArray("events");
        return events.length() == 0 ? doc.optInt("ack") : events.optJSONObject(events.length() - 1).optInt("seq");
    }
    private static int pending(JSONObject doc) { return doc == null ? 0 : Math.max(0, lastSeq(doc) - doc.optInt("ack")); }
    int pending() { return pending(read()); }
    boolean conflicted() { JSONObject doc = read(); return doc == null ? store.read() != null : !doc.optString("conflict").isEmpty(); }
    boolean available() {
        JSONObject doc = read();
        return doc != null && doc.optString("conflict").isEmpty();
    }
    boolean discard() { return save(null); }

    private static boolean validSnapshot(JSONObject remote) {
        if (remote == null || remote.optInt("v") != 1 || !remote.optBoolean("active") || bytes(remote) > MAX_SNAPSHOT_BYTES) return false;
        JSONObject standalone = remote.optJSONObject("standalone");
        if (standalone == null || standalone.optInt("v") != 1 || !token(standalone.optString("sessionId")) || !standalone.optString("sessionId").equals(remote.optString("contextToken")) || !token(standalone.optString("baseline"))) return false;
        JSONArray steps = standalone.optJSONArray("steps");
        if (steps == null || steps.length() > MAX_STEPS || !integer(standalone.opt("cursor"), 0, steps.length()) || !validRuntime(standalone.optJSONObject("runtime"))) return false;
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            if (step == null || !integer(step.opt("entryIdx"), 0, Integer.MAX_VALUE) || !integer(step.opt("setIdx"), 0, Integer.MAX_VALUE) || !(step.opt("canComplete") instanceof Boolean) || !integer(step.opt("restAfterSec"), 0, 86400)) return false;
            if (!Set.of("kg", "lb").contains(step.optString("loadUnit")) || !nullableValue(step.opt("loadValue"), false) || !nullableValue(step.opt("repsValue"), true)) return false;
            if (!step.isNull("side") && !Set.of("L", "R").contains(step.optString("side"))) return false;
        }
        JSONObject ack = standalone.optJSONObject("ack");
        return ack == null || token(ack.optString("streamId")) && integer(ack.opt("seq"), 0, MAX_EVENTS);
    }

    private static boolean nullableValue(Object value, boolean whole) {
        if (value == null || value == JSONObject.NULL) return true;
        if (!(value instanceof Number)) return false;
        double n = ((Number) value).doubleValue();
        return Double.isFinite(n) && n >= 0 && n <= 10000 && (!whole || n == Math.rint(n));
    }

    private static boolean validRuntime(JSONObject runtime) {
        if (runtime == null) return false;
        JSONObject effort = runtime.optJSONObject("effort"), timer = runtime.optJSONObject("timer");
        if (!runtime.isNull("effort") && effort == null || !runtime.isNull("timer") && timer == null || effort != null && timer != null) return false;
        if (effort != null && (!token(effort.optString("token")) || !integer(effort.opt("startedAt"), 1, 9007199254740991L)
            || !integer(effort.opt("elapsedMs"), 0, 9007199254740991L) || !integer(effort.opt("resumedAt"), 0, 9007199254740991L)
            || !(effort.opt("paused") instanceof Boolean) || !(effort.opt("heart") instanceof Boolean)
            || !effort.optBoolean("paused") && effort.optLong("resumedAt") < effort.optLong("startedAt"))) return false;
        return timer == null || token(timer.optString("timerToken")) && integer(timer.opt("endsAt"), 0, 9007199254740991L)
            && integer(timer.opt("leftMs"), 0, 9007199254740991L) && timer.opt("paused") instanceof Boolean && timer.opt("ready") instanceof Boolean;
    }

    private static JSONObject fresh(JSONObject remote) throws Exception {
        JSONObject standalone = remote.getJSONObject("standalone"), ack = standalone.optJSONObject("ack");
        return new JSONObject().put("v", 1).put("base", copy(remote)).put("sessionId", standalone.getString("sessionId"))
            .put("baseline", standalone.getString("baseline")).put("streamId", ack == null ? UUID.randomUUID().toString() : ack.getString("streamId"))
            .put("steps", new JSONArray(standalone.getJSONArray("steps").toString())).put("cursor", standalone.optInt("cursor"))
            .put("runtime", copy(standalone.getJSONObject("runtime"))).put("events", new JSONArray()).put("ack", ack == null ? 0 : ack.getInt("seq"));
    }
    private static boolean older(JSONObject remote, JSONObject doc) {
        JSONObject base = doc.optJSONObject("base");
        return remote.optString("publisherId").equals(base.optString("publisherId")) && remote.optLong("revision") < base.optLong("revision");
    }
    private boolean conflict(JSONObject doc, String code) throws Exception { doc.put("conflict", code); return save(doc); }

    private void receiveReceipt(JSONObject doc, JSONObject remote) throws Exception {
        JSONObject standalone = remote.optJSONObject("standalone");
        JSONObject receipt = standalone == null ? null : standalone.optJSONObject("receipt");
        if (receipt == null || !doc.optString("sessionId").equals(remote.optString("contextToken"))
                || !doc.optString("baseline").equals(receipt.optString("baseline"))
                || !doc.optString("streamId").equals(receipt.optString("streamId"))
                || !integer(receipt.opt("seq"), 1, lastSeq(doc))) return;
        int seq = receipt.getInt("seq");
        JSONArray events = doc.getJSONArray("events");
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            if (event.optInt("seq") != seq || !event.optString("id").equals(receipt.optString("requestId"))) continue;
            doc.put("ack", Math.max(doc.optInt("ack"), seq));
            if (pending(doc) == 0) doc.remove("conflict");
            return;
        }
    }

    boolean receive(JSONObject remote) {
        try {
            // A boot-time phone snapshot is not an owner/session replacement.
            if (remote == null || remote.has("localReady") && !remote.optBoolean("localReady")) return true;
            JSONObject doc = read();
            if (doc == null) return store.read() == null && validSnapshot(remote) && save(fresh(remote));
            if (validSnapshot(remote)) {
                receiveReceipt(doc, remote);
                if (!save(doc)) return false;
                // A transient owner during phone startup may have rejected this
                // journal. Only the original session with its unchanged prepared
                // baseline can make that stale-context rejection retryable again.
                if ("stale-context".equals(doc.optString("conflict"))
                        && doc.optString("sessionId").equals(remote.optString("contextToken"))
                        && doc.optString("baseline").equals(remote.getJSONObject("standalone").optString("baseline"))
                        && !older(remote, doc)) doc.remove("conflict");
            }
            if (!doc.optString("conflict").isEmpty()) return true;
            if (!doc.optString("sessionId").equals(remote.optString("contextToken")) || !remote.optBoolean("active")) {
                if (pending(doc) > 0) return conflict(doc, "stale-context");
                return validSnapshot(remote) ? save(fresh(remote)) : save(null);
            }
            if (older(remote, doc)) return true;
            if (!validSnapshot(remote)) return pending(doc) > 0 ? conflict(doc, "state-conflict") : save(null);
            JSONObject standalone = remote.getJSONObject("standalone"), ack = standalone.optJSONObject("ack");
            int incomingSeq = ack == null ? 0 : ack.getInt("seq");
            boolean sameStream = ack != null && doc.optString("streamId").equals(ack.optString("streamId"));
            if (!doc.optString("baseline").equals(standalone.optString("baseline"))) {
                if (pending(doc) > 0) return conflict(doc, "baseline-conflict");
                // A snapshot predating our receipt cannot undo an acknowledged action.
                JSONObject base = doc.getJSONObject("base");
                boolean newer = !remote.optString("publisherId").equals(base.optString("publisherId")) || remote.optLong("revision") > base.optLong("revision");
                if (doc.optInt("ack") > incomingSeq && !newer) return true;
                return save(fresh(remote));
            }
            if (ack != null && !sameStream) return pending(doc) > 0 ? conflict(doc, "stream-conflict") : save(fresh(remote));
            if (incomingSeq < doc.optInt("ack")) return true;
            if (sameStream && incomingSeq > lastSeq(doc)) return pending(doc) > 0 ? conflict(doc, "event-conflict") : save(fresh(remote));
            if (pending(doc) > 0) {
                if (sameStream && incomingSeq > doc.optInt("ack")) doc.put("ack", incomingSeq);
                // The local cursor/runtime already includes every accepted event, even
                // when the snapshot is only an acknowledgment of an earlier packet.
                return save(doc);
            }
            if (lastSeq(doc) > 0 && !sameStream) return true;
            doc.put("base", copy(remote)).put("steps", new JSONArray(standalone.getJSONArray("steps").toString()))
                .put("cursor", standalone.optInt("cursor")).put("runtime", copy(standalone.getJSONObject("runtime")));
            return save(doc);
        } catch (Exception e) { return false; }
    }

    JSONObject view(JSONObject remote) {
        JSONObject doc = read();
        try {
            if (doc == null) return remote == null ? new JSONObject() : copy(remote);
            JSONObject result = copy(doc.getJSONObject("base")), runtime = copy(doc.getJSONObject("runtime"));
            JSONObject standalone = new JSONObject().put("v", 1).put("sessionId", doc.getString("sessionId")).put("baseline", doc.getString("baseline"))
                .put("steps", new JSONArray(doc.getJSONArray("steps").toString())).put("cursor", doc.getInt("cursor"))
                .put("runtime", runtime).put("ack", new JSONObject().put("streamId", doc.getString("streamId")).put("seq", doc.optInt("ack")));
            result.put("standalone", standalone).put("standalonePending", pending(doc)).put("standaloneConflict", !doc.optString("conflict").isEmpty())
                .put("standaloneConflictCode", doc.optString("conflict")).put("effort", runtime.opt("effort")).put("timer", runtime.opt("timer"));
            result.put("current", doc.getJSONArray("steps").optJSONObject(doc.getInt("cursor")) == null ? JSONObject.NULL : copy(doc.getJSONArray("steps").getJSONObject(doc.getInt("cursor"))));
            mergeHeart(result, doc);
            return result;
        } catch (Exception e) { return remote == null ? new JSONObject() : remote; }
    }

    boolean perform(JSONObject input) {
        try {
            JSONObject doc = read();
            if (doc == null || !doc.optString("conflict").isEmpty() || lastSeq(doc) >= MAX_EVENTS || input == null || !ACTIONS.contains(input.optString("action")) || !integer(input.opt("at"), 1, 9007199254740991L)) return false;
            int cursor = doc.getInt("cursor");
            if (input.has("step") && (!integer(input.opt("step"), 0, MAX_STEPS) || input.getInt("step") != cursor)) return false;
            JSONArray events = doc.getJSONArray("events");
            long at = input.getLong("at");
            if (events.length() > 0 && at < events.getJSONObject(events.length() - 1).getLong("at")) return false;
            JSONObject event = new JSONObject().put("seq", lastSeq(doc) + 1).put("id", UUID.randomUUID().toString()).put("action", input.getString("action")).put("at", at).put("step", cursor);
            String action = event.getString("action");
            if (input.has("heart")) { if (!action.equals("start") || !(input.opt("heart") instanceof Boolean)) return false; event.put("heart", input.getBoolean("heart")); }
            if (action.equals("edit-set")) {
                String field = input.optString("field"); Object value = input.opt("value");
                if (!Set.of("r", "w").contains(field) || !(value instanceof Number)) return false;
                double number = ((Number) value).doubleValue();
                if (!Double.isFinite(number) || number < 0 || number > 10000 || field.equals("r") && number != Math.rint(number)) return false;
                event.put("field", field).put("value", number);
                if (field.equals("w")) event.put("unit", input.optString("unit"));
            } else if (input.has("field") || input.has("value") || input.has("unit")) return false;
            if (!reduce(doc, event)) return false;
            events.put(event);
            return save(doc);
        } catch (Exception e) { return false; }
    }

    private static boolean reduce(JSONObject doc, JSONObject event) throws Exception {
        JSONObject runtime = doc.getJSONObject("runtime"), effort = runtime.optJSONObject("effort"), timer = runtime.optJSONObject("timer");
        JSONArray steps = doc.getJSONArray("steps"); int cursor = doc.getInt("cursor"); JSONObject current = steps.optJSONObject(cursor);
        String action = event.getString("action"); long at = event.getLong("at");
        if (Set.of("start", "complete", "edit-set", "pause-effort", "resume-effort", "cancel-effort").contains(action) && (current == null || !current.optBoolean("canComplete"))) return false;
        if (action.equals("start")) {
            if (effort != null) return false;
            runtime.put("effort", new JSONObject().put("startedAt", at).put("elapsedMs", 0).put("paused", false).put("resumedAt", at).put("token", event.getString("id")).put("heart", event.optBoolean("heart"))).put("timer", JSONObject.NULL);
        } else if (action.equals("pause-effort")) {
            if (effort == null || effort.optBoolean("paused") || at < effort.optLong("resumedAt")) return false;
            effort.put("elapsedMs", effort.optLong("elapsedMs") + at - effort.optLong("resumedAt")).put("paused", true).put("resumedAt", 0);
        } else if (action.equals("resume-effort")) {
            if (effort == null || !effort.optBoolean("paused")) return false;
            effort.put("paused", false).put("resumedAt", at);
        } else if (action.equals("cancel-effort")) {
            if (effort == null) return false;
            runtime.put("effort", JSONObject.NULL);
        } else if (action.equals("complete")) {
            if (effort == null) return false;
            long rest = current.optLong("restAfterSec") * 1000;
            doc.put("cursor", cursor + 1); runtime.put("effort", JSONObject.NULL);
            runtime.put("timer", rest > 0 ? new JSONObject().put("timerToken", event.getString("id")).put("endsAt", at + rest).put("leftMs", rest).put("paused", false).put("ready", false) : JSONObject.NULL);
        } else if (action.equals("edit-set")) {
            String field = event.getString("field"); double value = event.getDouble("value");
            if (field.equals("w")) {
                if (!event.optString("unit").equals(current.optString("loadUnit"))) return false;
                current.put("manualLoad", true);
                for (int i = cursor + 1; i < steps.length(); i++) {
                    JSONObject later = steps.getJSONObject(i);
                    if (later.optInt("entryIdx") == current.optInt("entryIdx") && later.optInt("setIdx") > current.optInt("setIdx") && later.optString("side").equals(current.optString("side")) && later.optBoolean("warmup") == current.optBoolean("warmup") && !later.optBoolean("manualLoad")) setValue(later, field, value);
                }
            }
            setValue(current, field, value);
        } else {
            if (timer == null) return false;
            long left = Math.max(0, timer.optBoolean("paused") ? timer.optLong("leftMs") : timer.optLong("endsAt") - at);
            if (action.equals("pause")) {
                if (timer.optBoolean("paused") || left == 0) return false;
                timer.put("leftMs", left).put("paused", true).put("endsAt", 0);
            } else if (action.equals("resume")) {
                if (!timer.optBoolean("paused") || left == 0) return false;
                timer.put("endsAt", at + left).put("paused", false);
            } else if (action.equals("plus15")) {
                long extended = Math.min(900000, left + 15000);
                timer.put("leftMs", extended).put("ready", false);
                if (!timer.optBoolean("paused")) timer.put("endsAt", at + extended);
            } else runtime.put("timer", JSONObject.NULL);
        }
        return true;
    }
    private static void setValue(JSONObject step, String field, double value) throws Exception {
        String number = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
        if (field.equals("w")) step.put("loadValue", value).put("loadLabel", number + " " + step.optString("loadUnit"));
        else step.put("repsValue", value).put("repsLabel", number);
    }

    JSONObject packet() {
        try {
            JSONObject doc = read();
            if (doc == null || pending(doc) == 0 || !doc.optString("conflict").isEmpty()) return null;
            JSONArray batch = new JSONArray(), events = doc.getJSONArray("events");
            JSONObject packet = new JSONObject().put("v", 1).put("action", "standalone-sync").put("contextToken", doc.getString("sessionId")).put("streamId", doc.getString("streamId")).put("baseline", doc.getString("baseline")).put("events", batch);
            for (int i = 0; i < events.length() && batch.length() < 64; i++) {
                JSONObject event = events.getJSONObject(i);
                if (event.getInt("seq") <= doc.optInt("ack")) continue;
                batch.put(copy(event)); packet.put("requestId", event.getString("id"));
                if (bytes(packet) > MAX_COMMAND_BYTES) { batch.remove(batch.length() - 1); if (batch.length() == 0) return null; packet.put("requestId", batch.getJSONObject(batch.length() - 1).getString("id")); break; }
            }
            return batch.length() == 0 ? null : packet;
        } catch (Exception e) { return null; }
    }

    boolean acknowledge(JSONObject reply) {
        try {
            JSONObject doc = read();
            if (doc == null || reply == null || reply.optInt("v") != 1 || !doc.optString("streamId").equals(reply.optString("streamId"))) return false;
            JSONArray events = doc.getJSONArray("events"); JSONObject matched = null;
            for (int i = 0; i < events.length(); i++) { JSONObject event = events.getJSONObject(i); if (event.optString("id").equals(reply.optString("requestId"))) { matched = event; break; } }
            if (matched == null) return false;
            if (!reply.optString("status").equals("ok")) {
                if (matched.getInt("seq") <= doc.optInt("ack")) return false;
                String code = reply.optString("code");
                if (Set.of("baseline-conflict", "state-conflict", "stream-conflict", "event-conflict", "stale-context", "stale-target", "unsupported-set", "stale-unit").contains(code)) return conflict(doc, code);
                return false;
            }
            if (!integer(reply.opt("seq"), 1, MAX_EVENTS) || reply.getInt("seq") != matched.getInt("seq")) return false;
            if (reply.getInt("seq") <= doc.optInt("ack")) return true;
            doc.put("ack", reply.getInt("seq")); return save(doc);
        } catch (Exception e) { return false; }
    }

    private static void mergeHeart(JSONObject result, JSONObject doc) throws Exception {
        JSONArray events = doc.getJSONArray("events"); if (events.length() == 0) return;
        Set<String> allowed = new HashSet<>(); JSONArray remoteAllowed = result.optJSONArray("heartAuthorizedTokens");
        if (remoteAllowed != null) for (int i = 0; i < remoteAllowed.length(); i++) allowed.add(remoteAllowed.optString(i));
        JSONObject mark = result.optJSONObject("heartCapture"); boolean changed = false;
        JSONObject baseStandalone = doc.getJSONObject("base").optJSONObject("standalone");
        JSONObject baseAck = baseStandalone == null ? null : baseStandalone.optJSONObject("ack");
        int reflected = baseAck != null && doc.optString("streamId").equals(baseAck.optString("streamId")) ? baseAck.optInt("seq") : 0;
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i); String action = event.getString("action");
            if (event.optInt("seq") <= reflected) continue;
            if (action.equals("start")) {
                changed = true; mark = null;
                if (event.optBoolean("heart")) {
                    String id = event.getString("id"); allowed.add(id);
                    mark = new JSONObject().put("token", id).put("startedAt", event.getLong("at")).put("phase", "effort");
                }
            } else if (mark != null && action.equals("complete")) {
                mark.put("phase", "recovery").put("effortEndMs", event.getLong("at") - mark.getLong("startedAt")); changed = true;
            } else if (mark != null && action.equals("cancel-effort")) { allowed.remove(mark.optString("token")); mark = null; changed = true; }
        }
        if (changed) { if (mark == null) result.remove("heartCapture"); else result.put("heartCapture", mark); }
        JSONArray tokens = new JSONArray(); for (String id : allowed) tokens.put(id);
        result.put("heartAuthorizedTokens", tokens);
    }
}
