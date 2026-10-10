package com.fredc.opengym;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class WearActivity extends Activity implements MessageClient.OnMessageReceivedListener {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private JSONObject state = new JSONObject();
    private String phone = "", syncId = "", pending = "";
    private long confirmedAt, pendingAt, lastSync;
    private boolean foreground, options, pendingEdit;
    private WearEditor draft;
    private android.animation.ObjectAnimator heartPulse;
    private int feedback;
    private LinearLayout content;
    private TextView rest, heartReading, connection;
    private TextView phaseLabel;
    private android.content.res.Resources workoutResources;
    private String workoutLanguage = "";
    @Override public android.content.res.Resources getResources() { return workoutResources == null ? super.getResources() : workoutResources; }
    private void applyWorkoutLanguage() {
        String language = state.optString("lang", "");
        if (language.equals(workoutLanguage)) return;
        workoutLanguage = language;
        if (language.isEmpty()) { workoutResources = null; return; }
        android.content.res.Configuration configuration = new android.content.res.Configuration(super.getResources().getConfiguration());
        configuration.setLocale(java.util.Locale.forLanguageTag(language));
        workoutResources = getBaseContext().createConfigurationContext(configuration).getResources();
    }
    private Button complete, pause, plus, skip, cancelHeart, enableHeart;
    private Button repsChip, loadChip, confirmEdit, decrease, increase, cancelEdit;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            JSONObject incoming = WearStateService.cached(WearActivity.this);
            if (incoming.optString("contextToken").equals(state.optString("contextToken")) && incoming.optLong("revision") == state.optLong("revision")) return;
            state = incoming;
            // A cache update may be newer, but only the round-trip sync enables controls.
            confirmedAt = 0; render(); sync();
        }
    };
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!foreground) return;
            long now = SystemClock.elapsedRealtime();
            if (!pending.isEmpty() && now - pendingAt >= 8000) { failedCommand(); sync(); }
            if (now - lastSync >= 5000) sync();
            updateTimer(); updateControls(); updateHeart(); handler.postDelayed(this, 500);
        }
    };
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTurnScreenOn(getIntent().getBooleanExtra("remoteOpen", false));
        state = WearStateService.cached(this);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(Color.BLACK); scroll.setVerticalScrollBarEnabled(false);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(30), dp(12), dp(30), dp(8));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(dp(30) + insets.getSystemWindowInsetLeft(), dp(12) + insets.getSystemWindowInsetTop(), dp(30) + insets.getSystemWindowInsetRight(), dp(8) + insets.getSystemWindowInsetBottom()); return insets;
        }); scroll.addView(content); setContentView(scroll); render();
    }
    int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); setTurnScreenOn(intent.getBooleanExtra("remoteOpen", false));
    }
    @Override public void onResume() {
        super.onResume(); foreground = true; confirmedAt = 0;
        getSystemService(android.app.NotificationManager.class).cancel(WearRemoteOpen.ID);
        Wearable.getMessageClient(this).addListener(this);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, new IntentFilter("com.fredc.opengym.WEAR_STATE"), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(receiver, new IntentFilter("com.fredc.opengym.WEAR_STATE"));
        state = WearStateService.cached(this); WearOngoing.update(this, state); render(); sync(); handler.post(tick);
    }
    @Override public void onPause() {
        foreground = false; getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); stopHeartPulse(); if(heartReading!=null)heartReading.setTextColor(Color.GRAY); confirmedAt = 0; handler.removeCallbacks(tick); Wearable.getMessageClient(this).removeListener(this); unregisterReceiver(receiver); super.onPause();
    }
    private void sync() {
        if (!foreground) return;
        lastSync = SystemClock.elapsedRealtime();
        Wearable.getCapabilityClient(this).getCapability("opengym_phone_v1", CapabilityClient.FILTER_REACHABLE).addOnSuccessListener(capability -> {
            if (!foreground) return;
            // Exactly one phone; do not route a workout to an arbitrary device.
            if (capability.getNodes().size() != 1) { phone = ""; confirmedAt = 0; updateControls(); return; }
            phone = capability.getNodes().iterator().next().getId(); syncId = UUID.randomUUID().toString();
            try {
                JSONObject request = new JSONObject(); request.put("v", 1); request.put("requestId", syncId);
                var timerPrefs = WearTimer.prefs(this);
                String key = timerPrefs.getString("key", "");
                boolean handled = timerPrefs.getBoolean("armed", false) || key.equals(timerPrefs.getString("fired", ""));
                request.put("alarmKey", handled ? key : "");
                Wearable.getMessageClient(this).sendMessage(phone, "/opengym/v1/sync", request.toString().getBytes(StandardCharsets.UTF_8)).addOnFailureListener(e -> { confirmedAt = 0; updateControls(); });
            } catch (Exception ignored) { }
        }).addOnFailureListener(e -> { phone = ""; confirmedAt = 0; updateControls(); });
    }
    @Override public void onMessageReceived(MessageEvent event) {
        if (!foreground || !event.getSourceNodeId().equals(phone) || event.getData().length > 16384) return;
        try {
            JSONObject packet = new JSONObject(new String(event.getData(), StandardCharsets.UTF_8));
            if ("/opengym/v1/state".equals(event.getPath())) {
                if (!syncId.equals(packet.optString("syncId"))) return;
                JSONObject incoming = packet.getJSONObject("state");
                if (!WearStateService.receive(this, incoming, packet.optLong("sentAt", System.currentTimeMillis()))) return;
                state = incoming; confirmedAt = SystemClock.elapsedRealtime(); render();
                WearHeartStore.get(this).snapshot(incoming, phone);
            } else if ("/opengym/v1/reply".equals(event.getPath())) {
                if (packet.optInt("v") != 1) return;
                if (pending.equals(packet.optString("requestId")) && !pending.isEmpty()) {
                    if (!pendingEdit && !"ok".equals(packet.optString("status"))) WearHeartStore.get(this).rejected();
                    pending = ""; pendingEdit = false; draft = null; confirmedAt = 0;
                    feedback = "ok".equals(packet.optString("status")) ? R.string.saved : R.string.unconfirmed;
                    render(); sync();
                } else if (syncId.equals(packet.optString("requestId"))) { confirmedAt = 0; feedback = R.string.open_phone; render(); }
            }
        } catch (Exception ignored) { }
    }
    private boolean enabled() { return WearProtocol.canControl(!phone.isEmpty(), confirmedAt, SystemClock.elapsedRealtime(), !pending.isEmpty()); }
    private void failedCommand() {
        if (!pendingEdit) WearHeartStore.get(this).rejected();
        pending = ""; pendingEdit = false; draft = null; confirmedAt = 0; feedback = R.string.unconfirmed; render();
    }
    private void send(String action) {
        if (!enabled()) return;
        try {
            JSONObject target = new JSONObject(), current = state.optJSONObject("current"), timer = state.optJSONObject("timer");
            boolean edit = "edit-set".equals(action);
            if (edit || "complete".equals(action) || "heart-start".equals(action) || "heart-cancel".equals(action)) {
                if (edit && (draft == null || draft.pending || !validDraft(current))) return;
                if (!edit && !"heart-cancel".equals(action) && (current == null || !current.optBoolean("canComplete"))) return;
                if (current != null) { target.put("entryIdx", current.getInt("entryIdx")); target.put("setIdx", current.getInt("setIdx")); target.put("side", current.opt("side")); }
            } else { if (timer == null) return; target.put("timerToken", timer.getString("timerToken")); }
            JSONObject command = new JSONObject(); pending = UUID.randomUUID().toString(); pendingAt = SystemClock.elapsedRealtime(); pendingEdit = edit;
            command.put("v", 1); command.put("requestId", pending); command.put("contextToken", state.getString("contextToken")); command.put("revision", state.getLong("revision")); command.put("action", action); command.put("target", target);
            if (edit) {
                command.put("field", draft.field); command.put("value", draft.value);
                if ("w".equals(draft.field)) command.put("unit", draft.unit);
                draft.pending = true;
            }
            if ("heart-start".equals(action)) {
                if (!WearHeartService.running || !WearHeartStore.get(this).canStart()) { pending = ""; return; }
                long wall = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
                command.put("startedAt", wall); WearHeartStore.get(this).startTap(wall, elapsed);
            }
            JSONObject capture = state.optJSONObject("heartCapture");
            if (capture != null && "complete".equals(action) && "effort".equals(capture.optString("phase"))) {
                WearHeartCapture local = WearHeartStore.get(this).current();
                if (local != null && local.token.equals(capture.optString("token"))) {
                    long tap = SystemClock.elapsedRealtime(); command.put("heartElapsedMs", tap - local.tapElapsed); WearHeartStore.get(this).completeTap(local.token, tap);
                }
            }
            if (capture != null && "heart-cancel".equals(action)) command.put("heartCapture", capture.optString("token"));
            feedback = R.string.waiting; render();
            String requestId = pending;
            Wearable.getMessageClient(this).sendMessage(phone, "/opengym/v1/command", command.toString().getBytes(StandardCharsets.UTF_8)).addOnFailureListener(e -> { if(requestId.equals(pending)) failedCommand(); });
        } catch (Exception ignored) { failedCommand(); }
    }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setGravity(Gravity.CENTER); view.setTextColor(Color.WHITE); view.setPadding(0, dp(4), 0, dp(4)); content.addView(view); return view;
    }
    private Button button(int label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setMinHeight(dp(48)); content.addView(b, new LinearLayout.LayoutParams(-1, -2)); b.setOnClickListener(v -> action.run()); return b;
    }
    private String targetIdentity(JSONObject current) {
        return current == null ? "" : current.optInt("entryIdx") + ":" + current.optInt("setIdx") + ":" + current.optString("side") + ":" + current.optString("name") + ":" + current.optString("setLabel");
    }
    private boolean validDraft(JSONObject current) {
        return current != null && current.optBoolean("canEdit") && state.optBoolean("active") && draft != null && draft.matches(state.optString("contextToken"), targetIdentity(current), current.optString("loadUnit"), current.optDouble("r".equals(draft.field) ? "repsValue" : "loadValue", Double.NaN));
    }
    private void openEditor(String field) {
        JSONObject current = state.optJSONObject("current");
        if (!enabled() || current == null || !current.optBoolean("canEdit")) return;
        double value = current.optDouble("r".equals(field) ? "repsValue" : "loadValue", Double.NaN);
        if (!Double.isNaN(value) && (!Double.isFinite(value) || value < 0 || value > 10000 || ("r".equals(field) && value != Math.rint(value)))) return;
        draft = new WearEditor(state.optString("contextToken"), targetIdentity(current), field, current.optString("loadUnit"), value, current.optDouble("loadStep", 1)); options = false; render();
    }
    private String displayNumber(double value) {
        char separator = java.text.DecimalFormatSymbols.getInstance(getResources().getConfiguration().getLocales().get(0)).getDecimalSeparator();
        return WearEditor.number(value).replace('.', separator);
    }
    private void rounded(Button b, boolean yellow) {
        android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
        shape.setColor(yellow ? Color.rgb(255, 196, 0) : Color.rgb(31, 33, 29)); shape.setCornerRadius(dp(28));
        b.setBackground(shape); b.setTextColor(yellow ? Color.BLACK : Color.WHITE); b.setPadding(dp(6), 0, dp(6), 0);
    }
    private Button compactButton(String label, String description, Runnable action, boolean yellow) {
        Button b = button(R.string.complete, action); b.setText(label); b.setTag(description); b.setContentDescription(label); b.setTextSize(16); rounded(b, yellow);
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams)b.getLayoutParams(); params.height = dp(48); params.topMargin = dp(3); b.setLayoutParams(params); return b;
    }
    private Button rowButton(LinearLayout row, String label, String description, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setTextSize(16); b.setMaxLines(1); b.setAutoSizeTextTypeUniformWithConfiguration(12,16,1,android.util.TypedValue.COMPLEX_UNIT_SP); b.setAllCaps(false); b.setTag(description); b.setContentDescription("edit-reps".equals(description) ? getString(R.string.edit_reps) + ": " + label : "edit-load".equals(description) ? getString(R.string.edit_load) + ": " + label : "increase".equals(description) ? getString(R.string.increase) : "decrease".equals(description) ? getString(R.string.decrease) : description); b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(dp(48)); rounded(b, false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1); params.setMargins(dp(2), 0, dp(2), 0); row.addView(b, params); b.setOnClickListener(v -> action.run()); return b;
    }
    private TextView heartIcon() {
        TextView icon = new TextView(this) {
            private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(android.graphics.Canvas canvas) {
                float size = dp(20), x = (getWidth()-size)/2f, y = (getHeight()-size)/2f;
                android.graphics.Path heart = new android.graphics.Path();
                heart.moveTo(x+size*0.5f, y+size*0.9f);
                heart.cubicTo(x+size*0.43f,y+size*0.83f,x+size*0.06f,y+size*0.57f,x+size*0.06f,y+size*0.3f);
                heart.cubicTo(x+size*0.06f,y+size*0.07f,x+size*0.34f,y+size*0.02f,x+size*0.5f,y+size*0.23f);
                heart.cubicTo(x+size*0.66f,y+size*0.02f,x+size*0.94f,y+size*0.07f,x+size*0.94f,y+size*0.3f);
                heart.cubicTo(x+size*0.94f,y+size*0.57f,x+size*0.57f,y+size*0.83f,x+size*0.5f,y+size*0.9f);
                heart.close(); paint.setColor(getCurrentTextColor()); canvas.drawPath(heart,paint);
            }
        };
        icon.setTextColor(Color.GRAY); return icon;
    }
    private LinearLayout row() { LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER); content.addView(row, new LinearLayout.LayoutParams(-1, dp(48))); return row; }
    private void render() {
        if (content == null) return;
        applyWorkoutLanguage(); phaseLabel = null;
        stopHeartPulse(); content.removeAllViews(); complete = pause = plus = skip = cancelHeart = enableHeart = null; heartReading = rest = connection = null;
        repsChip = loadChip = confirmEdit = decrease = increase = cancelEdit = null;
        JSONObject current = state.optJSONObject("current");
        if (draft != null && !validDraft(current)) { draft = null; feedback = R.string.edit_changed; }
        if (options) { renderOptions(); updateControls(); updateHeart(); return; }
        if (draft != null) {
            TextView title = text(getString("r".equals(draft.field) ? R.string.edit_reps : R.string.edit_load), 16); title.setPadding(0,0,0,0);
            TextView exercise = text(current.optString("name"), 14); exercise.setPadding(0,0,0,0); exercise.setMaxLines(1); exercise.setEllipsize(android.text.TextUtils.TruncateAt.END);
            TextView value = text(displayNumber(draft.value) + (draft.field.equals("w") ? " " + draft.unit : ""), 30); value.setPadding(0,dp(2),0,dp(2)); value.setTag("draft-value");
            LinearLayout adjust = row(); decrease = rowButton(adjust, "−", "decrease", () -> { draft.adjust(-1); render(); }); increase = rowButton(adjust, "+", "increase", () -> { draft.adjust(1); render(); });
            adjust.getLayoutParams().height = dp(56);
            for (Button control : new Button[] {decrease, increase}) {
                control.getLayoutParams().height = dp(56);
                control.setAutoSizeTextTypeWithDefaults(TextView.AUTO_SIZE_TEXT_TYPE_NONE);
                control.setTextSize(28);
                android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
                background.setColor(Color.rgb(43, 46, 42)); background.setCornerRadius(dp(28));
                background.setStroke(dp(1), Color.rgb(74, 78, 72)); control.setBackground(background);
            }
            LinearLayout actions = row();
            ((LinearLayout.LayoutParams)actions.getLayoutParams()).topMargin = dp(8);
            confirmEdit = rowButton(actions, getString(R.string.confirm_edit), "confirm-edit", () -> send("edit-set")); rounded(confirmEdit,true); confirmEdit.setContentDescription(getString(R.string.confirm_edit));
            cancelEdit = rowButton(actions, getString(android.R.string.cancel), "cancel-edit", () -> { draft = null; render(); }); cancelEdit.setContentDescription(getString(android.R.string.cancel));
        } else {
            if (state.optBoolean("active") && current != null) {
                LinearLayout header = row();
                heartReading = heartIcon(); header.addView(heartReading, new LinearLayout.LayoutParams(dp(32), dp(48)));
                LinearLayout labels = new LinearLayout(this); labels.setOrientation(LinearLayout.VERTICAL); labels.setGravity(Gravity.CENTER);
                header.addView(labels, new LinearLayout.LayoutParams(0,dp(48),1));
                TextView name = new TextView(this); name.setText(current.optString("name")); name.setTextSize(16); name.setTextColor(Color.WHITE); name.setGravity(Gravity.CENTER); name.setMaxLines(1); name.setEllipsize(android.text.TextUtils.TruncateAt.END); labels.addView(name,new LinearLayout.LayoutParams(-1,-2));
                phaseLabel = new TextView(this); phaseLabel.setTextSize(11); phaseLabel.setTextColor(Color.LTGRAY); phaseLabel.setGravity(Gravity.CENTER); phaseLabel.setMaxLines(1); phaseLabel.setAutoSizeTextTypeUniformWithConfiguration(9,11,1,android.util.TypedValue.COMPLEX_UNIT_SP); labels.addView(phaseLabel,new LinearLayout.LayoutParams(-1,-2));
                Button menu = new Button(this); menu.setText("•••"); menu.setTextColor(Color.WHITE); menu.setTextSize(16); menu.setContentDescription(getString(R.string.options)); menu.setBackgroundColor(Color.TRANSPARENT); menu.setPadding(0,0,0,0); menu.setMinWidth(0); menu.setMinimumWidth(0); header.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(48)));menu.setOnClickListener(v -> { options=true;render(); });
                rest = text("00:00", 32); rest.setPadding(0, 0, 0, 0); rest.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
                LinearLayout chips = row();
                double reps = current.optDouble("repsValue", Double.NaN), load = current.optDouble("loadValue", Double.NaN);
                repsChip = rowButton(chips, Double.isFinite(reps) ? displayNumber(reps) + " " + getString(R.string.reps_short) : "— " + getString(R.string.reps_short), "edit-reps", () -> openEditor("r"));
                loadChip = rowButton(chips, Double.isFinite(load) ? displayNumber(load) + " " + current.optString("loadUnit") : "— " + current.optString("loadUnit"), "edit-load", () -> openEditor("w"));
                if (current.optBoolean("canComplete")) complete = compactButton(getString(R.string.complete), "main-action", () -> {
                    JSONObject mark = state.optJSONObject("heartCapture"); send(WearHeartService.running && (mark == null || !"effort".equals(mark.optString("phase"))) ? "heart-start" : "complete");
                }, true); else text(getString(R.string.use_phone), 12);
                if(complete!=null)((LinearLayout.LayoutParams)complete.getLayoutParams()).width=dp(148);
            } else text(getString(state.optBoolean("active") ? R.string.sets_finished : R.string.open_phone), 17);
            if(heartReading == null) { LinearLayout footer = row();
            heartReading = heartIcon(); footer.addView(heartReading, new LinearLayout.LayoutParams(dp(48), dp(48)));
            rowButton(footer, "•••", getString(R.string.options), () -> { options = true; render(); }); }
            if (feedback == R.string.unconfirmed || feedback == R.string.edit_changed) text(getString(feedback), 11);
        }
        updateTimer(); updateControls(); updateHeart();
    }
    private void renderOptions() {
        compactButton(getString(R.string.back), "back", () -> { options = false; render(); }, false);
        connection = text("", 13);
        heartReading = text("", 14);
        enableHeart = button(WearHeartService.running ? R.string.heart_disable : R.string.heart_enable, this::toggleHeart);
        JSONObject capture = state.optJSONObject("heartCapture");
        if (capture != null && "effort".equals(capture.optString("phase"))) cancelHeart = button(R.string.heart_cancel_set, () -> send("heart-cancel"));
        JSONObject timer = state.optJSONObject("timer");
        if (timer != null && !timer.optBoolean("ready")) {
            rest = text("", 19);
            pause = button(timer.optBoolean("paused") ? R.string.resume : R.string.pause, () -> send(timer.optBoolean("paused") ? "resume" : "pause"));
            plus = button(R.string.rest, () -> send("plus15")); plus.setText("+15 s"); skip = button(R.string.skip, () -> send("skip"));
        }
        if (!WearTimer.canSchedule(this)) button(R.string.alarm_permission, () -> { try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { } });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) button(R.string.notification_permission, () -> requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1));
        button(R.string.refresh, this::sync); updateTimer();
    }
    private void updateControls() {
        JSONObject capture = state.optJSONObject("heartCapture");
        boolean effort = foreground && state.optBoolean("active") && capture != null && "effort".equals(capture.optString("phase"));
        if (effort) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        boolean enabled = enabled() && state.optBoolean("active");
        if(connection != null) connection.setText(feedback != 0 ? feedback : enabled ? R.string.connected : R.string.disconnected);
        if (complete != null) complete.setEnabled(enabled);
        JSONObject current = state.optJSONObject("current");
        boolean editable = enabled && current != null && current.optBoolean("canEdit");
        if (repsChip != null) repsChip.setEnabled(editable);
        if (loadChip != null) loadChip.setEnabled(editable);
        if (confirmEdit != null) confirmEdit.setEnabled(editable && validDraft(current) && !draft.pending);
        if (decrease != null) decrease.setEnabled(draft != null && !draft.pending && pending.isEmpty());
        if (increase != null) increase.setEnabled(draft != null && !draft.pending && pending.isEmpty());
        if (cancelEdit != null) cancelEdit.setEnabled(pending.isEmpty());
        if (pause != null) pause.setEnabled(enabled);
        if (plus != null) plus.setEnabled(enabled);
        if (skip != null) skip.setEnabled(enabled);
        if (cancelHeart != null) cancelHeart.setEnabled(enabled);
        if (enableHeart != null) enableHeart.setEnabled(WearHeartService.running || enabled);
    }
    private void toggleHeart() {
        if (WearHeartService.running) {
            JSONObject capture = state.optJSONObject("heartCapture");
            if (enabled() && capture != null && "effort".equals(capture.optString("phase"))) send("heart-cancel");
            startService(new Intent(this, WearHeartService.class).setAction("stop")); render(); return;
        }
        if (!enabled()) return;
        new AlertDialog.Builder(this).setTitle(R.string.heart_title).setMessage(R.string.heart_consent)
            .setNegativeButton(android.R.string.cancel, null).setPositiveButton(R.string.heart_enable, (dialog, which) -> {
                if (checkSelfPermission(Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[] { Manifest.permission.BODY_SENSORS }, 42);
                else startHeart();
            }).show();
    }
    private void startHeart() {
        if (!foreground || !state.optBoolean("active") || !enabled()) return;
        try { startForegroundService(new Intent(this, WearHeartService.class).setAction("start")); } catch (Exception e) { WearHeartService.status = R.string.heart_unavailable; }
        render();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == 42) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) { if (enabled()) startHeart(); else { sync(); render(); } }
            else { WearHeartService.status = R.string.heart_unavailable; render(); }
        }
    }
    private void stopHeartPulse() {
        if (heartPulse != null) { heartPulse.cancel(); heartPulse = null; }
        if (heartReading != null) heartReading.setAlpha(1f);
    }
    private void updateHeart() {
        if (heartReading == null) return;
        boolean fresh = foreground && WearEditor.heartFresh(WearHeartService.running, WearHeartService.latestBpm, WearHeartService.latestElapsed, SystemClock.elapsedRealtime());
        int status = WearHeartStore.get(this).storageFailed || !WearHeartStore.get(this).canStart() ? R.string.heart_queue_full : (fresh ? R.string.heart_receiving : WearHeartService.status);
        heartReading.setContentDescription(getString(status));
        if (options) heartReading.setText(status);
        else {
            heartReading.setTextColor(fresh ? Color.rgb(255, 59, 79) : Color.GRAY);
            if (fresh && heartPulse == null) { heartPulse = android.animation.ObjectAnimator.ofFloat(heartReading, "alpha", 1f, 0.35f, 1f); heartPulse.setDuration(1200); heartPulse.setRepeatCount(android.animation.ValueAnimator.INFINITE); heartPulse.start(); }
            if (!fresh) stopHeartPulse();
        }
        if (enableHeart != null) { enableHeart.setText(WearHeartService.running ? R.string.heart_disable : R.string.heart_enable); enableHeart.setEnabled(WearHeartService.running || enabled()); }
        JSONObject mark = state.optJSONObject("heartCapture");
        if (complete != null) complete.setText(WearHeartService.running && (mark == null || !"effort".equals(mark.optString("phase"))) ? R.string.heart_start_set : R.string.complete);
    }
    private void updateTimer() {
        if (rest == null) return;
        JSONObject timer = state.optJSONObject("timer"), capture = state.optJSONObject("heartCapture");
        if (phaseLabel != null) {
            boolean effort = capture != null && "effort".equals(capture.optString("phase"));
            boolean resting = timer != null && !timer.optBoolean("ready") && (timer.optBoolean("paused") ? timer.optLong("leftMs") > 0 : timer.optLong("endsAt") > System.currentTimeMillis());
            int label = effort ? R.string.phase_effort : resting ? (timer.optBoolean("paused") ? R.string.phase_paused : R.string.phase_rest) : R.string.phase_ready;
            phaseLabel.setText(getString(label) + " · " + state.optJSONObject("current").optString("setLabel"));
        }
        if (!options && capture != null && "effort".equals(capture.optString("phase"))) {
            WearHeartCapture local = WearHeartStore.get(this).current();
            long elapsed = local != null && local.token.equals(capture.optString("token")) ? SystemClock.elapsedRealtime() - local.tapElapsed : Math.max(0, System.currentTimeMillis() - capture.optLong("startedAt", System.currentTimeMillis()));
            long seconds = Math.max(0, elapsed / 1000); rest.setText(String.format(java.util.Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60)); return;
        }
        if (!options && timer == null) { rest.setText("00:00"); return; }
        if (timer == null) { rest.setText(enabled() ? "" : getString(R.string.disconnected)); return; }
        long left = timer.optBoolean("paused") ? timer.optLong("leftMs") : WearTimer.prefs(this).getLong("endsAt", 0) - System.currentTimeMillis();
        long seconds = Math.max(0, (left + 999) / 1000);
        String label = timer.optBoolean("ready") || seconds == 0 ? getString(R.string.ready) : String.format(java.util.Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60);
        if (options && !enabled() && pending.isEmpty()) label += "\n" + getString(R.string.last_timer);
        if (options && !timer.optBoolean("paused") && !timer.optBoolean("ready") && !WearTimer.prefs(this).getBoolean("armed", false) && seconds > 0) label += "\n" + getString(R.string.alarm_unavailable);
        rest.setText(label);
    }
}
