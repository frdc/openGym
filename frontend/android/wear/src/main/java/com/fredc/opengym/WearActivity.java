package com.fredc.opengym;

import android.Manifest;
import androidx.activity.ComponentActivity;
import androidx.wear.ambient.AmbientLifecycleObserver;
import androidx.wear.ambient.AmbientLifecycleObserverKt;
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
import android.widget.FrameLayout;
import android.view.View;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class WearActivity extends ComponentActivity implements MessageClient.OnMessageReceivedListener {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private JSONObject state = new JSONObject();
    private String phone = "", syncId = "", pending = "";
    private long confirmedAt, pendingAt, lastSync;
    private boolean foreground, options, pendingEdit;
    private String optionsPage = "";
    private String heartRestoreAttempt = "";
    private boolean showingRest, showingHeartRunning;
    private boolean ambient, lowBitAmbient;
    private boolean workoutScreen, screenDimmed, wristListening;
    private android.hardware.SensorManager screenSensors;
    private static final long SCREEN_DIM_DELAY_MS = 15_000;
    private final Runnable dimScreen = this::dimWorkoutScreen;
    private final android.hardware.SensorEventListener wristListener = new android.hardware.SensorEventListener() {
        @Override public void onSensorChanged(android.hardware.SensorEvent event) { brightenWorkoutScreen(); }
        @Override public void onAccuracyChanged(android.hardware.Sensor sensor, int accuracy) { }
    };
    private ScrollView scroll;
    private final WearBackdrop backdrop = new WearBackdrop();
    private AmbientLifecycleObserver ambientObserver;
    private final AmbientLifecycleObserver.AmbientLifecycleCallback ambientCallbacks = new AmbientLifecycleObserver.AmbientLifecycleCallback() {
        @Override public void onEnterAmbient(AmbientLifecycleObserver.AmbientDetails details) {
            lowBitAmbient = details.getDeviceHasLowBitAmbient(); enterAmbient();
        }
        @Override public void onExitAmbient() { exitAmbient(); }
        @Override public void onUpdateAmbient() {
            state = WearStateService.cached(WearActivity.this); refreshAmbient();
        }
    };
    private WearEditor draft;
    private android.animation.ObjectAnimator heartPulse;
    private int feedback;
    private LinearLayout content;
    private TextView rest, heartReading, heartBpm;
    private View connectionIndicator;
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
    private Button complete, startSet, pause, plus, skip, cancelHeart, enableHeart, reconnect, manualComplete;
    private Button repsChip, loadChip, confirmEdit, decrease, increase, cancelEdit;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            JSONObject incoming = WearStateService.cached(WearActivity.this);
            if (incoming.toString().equals(state.toString())) return;
            state = incoming;
            // Online fallback controls still require a fresh round trip; local work is durable.
            confirmedAt = 0; render(); sync();
        }
    };
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!foreground || ambient) return;
            long now = SystemClock.elapsedRealtime();
            if (!pending.isEmpty() && now - pendingAt >= 8000) { failedCommand(); sync(); }
            if (now - lastSync >= 5000) sync();
            if (!options && draft == null && (showingRest != isResting() || showingHeartRunning != WearHeartService.running)) render();
            updateTimer(); updateControls(); updateHeart(); handler.postDelayed(this, 500);
        }
    };
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState); backdrop.texture(getResources());
        setTurnScreenOn(getIntent().getBooleanExtra("remoteOpen", false));
        state = WearStateService.cached(this);
        scroll = new WearPagerScroll(this, new WearPagerScroll.Pages() {
            public boolean available() { return foreground && !ambient && draft == null && optionsPage.isEmpty(); }
            public boolean settings() { return options; }
            public void show(boolean settings) { options = settings; optionsPage = ""; render(); }
        }); scroll.setFillViewport(true); scroll.setBackgroundColor(WearStyle.BACKGROUND); scroll.setVerticalScrollBarEnabled(false);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(30), dp(12), dp(30), dp(8));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            boolean workout = content.findViewWithTag("workout-panel") != null;
            view.setPadding((workout ? 0 : dp(30)) + insets.getSystemWindowInsetLeft(), (workout ? 0 : dp(12)) + insets.getSystemWindowInsetTop(), (workout ? 0 : dp(30)) + insets.getSystemWindowInsetRight(), (workout ? 0 : dp(8)) + insets.getSystemWindowInsetBottom()); return insets;
        }); scroll.addView(content); setContentView(scroll); render();
        getOnBackPressedDispatcher().addCallback(this,new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (draft != null) { if (pending.isEmpty()) { draft=null; render(); } return; }
                if (options) { if (!optionsPage.isEmpty()) optionsPage=""; else options=false; render(); return; }
                finish();
            }
        });
        ambientObserver = AmbientLifecycleObserverKt.AmbientLifecycleObserver(this, ambientCallbacks);
        getLifecycle().addObserver(ambientObserver);
    }
    int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); setTurnScreenOn(intent.getBooleanExtra("remoteOpen", false));
    }
    @Override public void onResume() {
        super.onResume(); foreground = true; confirmedAt = 0; heartRestoreAttempt = "";
        getSystemService(android.app.NotificationManager.class).cancel(WearRemoteOpen.ID);
        Wearable.getMessageClient(this).addListener(this);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, new IntentFilter("com.fredc.opengym.WEAR_STATE"), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(receiver, new IntentFilter("com.fredc.opengym.WEAR_STATE"));
        state = WearStateService.cached(this); WearOngoing.update(this, state); render(); sync(); handler.post(tick);
    }
    @Override public void onPause() {
        foreground = false; backdrop.motion(false); updateWorkoutScreen(); stopHeartPulse(); if(heartReading!=null)heartReading.setTextColor(Color.GRAY); confirmedAt = 0; handler.removeCallbacks(tick); Wearable.getMessageClient(this).removeListener(this); unregisterReceiver(receiver); super.onPause();
    }
    @Override public void onDestroy() { backdrop.motion(false); super.onDestroy(); }
    @Override public void onUserInteraction() { super.onUserInteraction(); brightenWorkoutScreen(); }
    private void setScreenBrightness(float brightness) {
        var attributes = getWindow().getAttributes();
        if (attributes.screenBrightness == brightness) return;
        attributes.screenBrightness = brightness; getWindow().setAttributes(attributes);
    }
    private void stopWristListener() {
        if (wristListening && screenSensors != null) screenSensors.unregisterListener(wristListener);
        wristListening = false;
    }
    private void brightenWorkoutScreen() {
        if (!workoutScreen) return;
        screenDimmed = false; stopWristListener();
        setScreenBrightness(android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
        handler.removeCallbacks(dimScreen); handler.postDelayed(dimScreen, SCREEN_DIM_DELAY_MS);
    }
    private void dimWorkoutScreen() {
        if (!workoutScreen || !foreground || ambient || !state.optBoolean("active") || screenDimmed) return;
        screenDimmed = true; setScreenBrightness(0.03f);
        // The wrist sensor is optional and may be hidden/restricted by the manufacturer.
        // Discover its public string type rather than referencing a hidden SDK constant.
        if (screenSensors == null) screenSensors = getSystemService(android.hardware.SensorManager.class);
        if (screenSensors == null) return;
        try {
            for (var sensor : screenSensors.getSensorList(android.hardware.Sensor.TYPE_ALL)) {
                if (!"android.sensor.wrist_tilt_gesture".equals(sensor.getStringType())) continue;
                wristListening = screenSensors.registerListener(wristListener, sensor, android.hardware.SensorManager.SENSOR_DELAY_NORMAL, handler);
                android.util.Log.d("OpenGymScreen", "Wrist gesture registered: " + wristListening);
                break;
            }
        } catch (SecurityException ignored) { wristListening = false; }
    }
    private void updateWorkoutScreen() {
        boolean active = foreground && !ambient && state.optBoolean("active");
        if (active) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (!workoutScreen) { workoutScreen = true; brightenWorkoutScreen(); }
        } else {
            workoutScreen = false; screenDimmed = false; handler.removeCallbacks(dimScreen); stopWristListener();
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setScreenBrightness(android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
        }
    }
    private void sync() {
        if (!foreground || ambient) return;
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
                request.put("replay",WearStandalone.replayHint(this));
                Wearable.getMessageClient(this).sendMessage(phone, "/opengym/v1/sync", request.toString().getBytes(StandardCharsets.UTF_8)).addOnFailureListener(e -> { confirmedAt = 0; updateControls(); });
            } catch (Exception ignored) { }
        }).addOnFailureListener(e -> { phone = ""; confirmedAt = 0; updateControls(); });
    }
    @Override public void onMessageReceived(MessageEvent event) {
        if (!foreground || !event.getSourceNodeId().equals(phone) || event.getData().length > WearProtocol.STATE_MESSAGE_BYTES) return;
        try {
            JSONObject packet = new JSONObject(new String(event.getData(), StandardCharsets.UTF_8));
            if ("/opengym/v1/state".equals(event.getPath())) {
                if (!syncId.equals(packet.optString("syncId"))) return;
                JSONObject incoming = packet.getJSONObject("state");
                if (!WearStateService.receive(this, incoming, packet.optLong("sentAt", System.currentTimeMillis()))) return;
                state = WearStateService.cached(this); confirmedAt = SystemClock.elapsedRealtime(); restoreHeartSession(); render(); drainOutbox();
                WearHeartStore.get(this).snapshot(state, phone);
                WearStateService.replay(this, phone);
            } else if ("/opengym/v1/reply".equals(event.getPath())) {
                if (packet.optInt("v") != 1) return;
                if (WearStandalone.acknowledge(this, packet)) {
                    WearStandalone.receive(this,WearStateService.remote(this));WearStateService.refresh(this); state = WearStateService.cached(this); render(); WearStateService.replay(this, phone); return;
                }
                if (pending.equals(packet.optString("requestId")) && !pending.isEmpty()) {
                    JSONObject queued=WearOutbox.read(this);
                    if(queued!=null && pending.equals(queued.optString("requestId"))) {
                        if("ok".equals(packet.optString("status"))) WearOutbox.clear(this);
                        else WearOutbox.conflict(this);
                    }
                    if (!pendingEdit && !"ok".equals(packet.optString("status"))) WearHeartStore.get(this).rejected();
                    pending = ""; pendingEdit = false; draft = null; confirmedAt = 0;
                    feedback = "ok".equals(packet.optString("status")) ? R.string.saved : R.string.unconfirmed;
                    render(); sync();
                } else if (syncId.equals(packet.optString("requestId"))) { confirmedAt = 0; feedback = R.string.open_phone; render(); }
            }
        } catch (Exception ignored) { }
    }
    private boolean enabled() { return !ambient && WearProtocol.canControl(!phone.isEmpty(), confirmedAt, SystemClock.elapsedRealtime(), !pending.isEmpty()); }
    private boolean standaloneMode() { return state.optJSONObject("standalone") != null && WearOutbox.read(this) == null; }
    private boolean standaloneEnabled() { return !ambient && standaloneMode() && WearStandalone.available(this); }
    private boolean controlsAvailable() { return standaloneMode() ? standaloneEnabled() : enabled(); }
    private JSONObject effort() {
        if (standaloneMode()) return state.optJSONObject("effort");
        JSONObject mark = state.optJSONObject("heartCapture");
        return mark != null && "effort".equals(mark.optString("phase")) ? mark : null;
    }
    private boolean localEditing() { return standaloneMode() ? standaloneEnabled() : !ambient && state.optBoolean("active") && !state.optString("contextToken").isEmpty() && pending.isEmpty() && WearOutbox.read(this)==null; }
    private void localAction(String action) {
        if (!standaloneEnabled()) return;
        try {
            long wall = System.currentTimeMillis();
            JSONObject event = new JSONObject().put("action", action).put("at", wall);
            if ("edit-set".equals(action)) {
                if (draft == null || !validDraft(state.optJSONObject("current"))) return;
                event.put("field",draft.field).put("value",draft.value).put("unit",draft.unit);
            }
            boolean heart = "start".equals(action) && WearHeartService.running && WearHeartStore.get(this).canStart();
            if ("start".equals(action)) {
                event.put("heart", heart);
                if (heart) WearHeartStore.get(this).startTap(wall,SystemClock.elapsedRealtime());
            }
            if ("complete".equals(action)) {
                WearHeartCapture capture = WearHeartStore.get(this).current();
                if (capture != null) WearHeartStore.get(this).completeTap(capture.token,SystemClock.elapsedRealtime());
            }
            if (!WearStandalone.perform(this,event)) {
                WearHeartStore.get(this).rejected(); feedback=R.string.unconfirmed; render(); return;
            }
            draft=null; feedback=R.string.offline_saved;
            WearStateService.refresh(this); state=WearStateService.cached(this); render();
            WearStateService.replay(this,phone);
        } catch (Exception e) { WearHeartStore.get(this).rejected(); feedback=R.string.unconfirmed; render(); }
    }
    private void drainOutbox() {
        JSONObject command=WearOutbox.read(this);
        if(command==null || WearOutbox.conflicted(this) || !enabled()) return;
        if(!command.optBoolean("sent")) {
            JSONObject cur=state.optJSONObject("current"), base=command.optJSONObject("baseline");
            if(cur!=null && !("edit-set".equals(command.optString("action"))?cur.optBoolean("canEdit"):cur.optBoolean("canComplete"))) return;
            if(!state.optString("contextToken").equals(command.optString("contextToken")) || cur==null || base==null ||
                !targetIdentity(cur).equals(targetIdentity(base)) || !cur.optString("loadUnit").equals(base.optString("loadUnit")) ||
                !String.valueOf(cur.opt("loadValue")).equals(String.valueOf(base.opt("loadValue"))) ||
                !String.valueOf(cur.opt("repsValue")).equals(String.valueOf(base.opt("repsValue"))) ||
                !String.valueOf(cur.opt("loadStep")).equals(String.valueOf(base.opt("loadStep"))) ||
                !String.valueOf(cur.opt("loadStart")).equals(String.valueOf(base.opt("loadStart")))) {
                WearOutbox.conflict(this); render(); return;
            }
            try { command.put("revision",state.getLong("revision")); command.put("sent",true); }
            catch(Exception e) { return; }
            if(!WearOutbox.save(this,command)) return;
        }
        pending=command.optString("requestId"); pendingEdit="edit-set".equals(command.optString("action")); pendingAt=SystemClock.elapsedRealtime();
        Wearable.getMessageClient(this).sendMessage(phone,"/opengym/v1/command",command.toString().getBytes(StandardCharsets.UTF_8))
            .addOnFailureListener(e -> { if(command.optString("requestId").equals(pending)) failedCommand(); });
        updateControls();
    }
    private void failedCommand() {
        if (!pendingEdit) WearHeartStore.get(this).rejected();
        pending = ""; pendingEdit = false; draft = null; confirmedAt = 0; feedback = WearOutbox.read(this)!=null ? R.string.offline_saved : R.string.unconfirmed; render();
    }
    private void send(String action) {
        if (standaloneMode()) {
            localAction("heart-start".equals(action) ? "start" : "heart-cancel".equals(action) ? "cancel-effort" : action);
            return;
        }
        boolean durable="edit-set".equals(action) || "complete".equals(action);
        boolean connected=enabled();
        if ((!connected && !(durable && localEditing())) || WearOutbox.read(this)!=null) return;
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
            if(durable) { command.put("baseline",new JSONObject(current.toString())); command.put("sent",connected); }
            if(durable && !WearOutbox.save(this,command)) { pending=""; if(draft!=null)draft.pending=false; feedback=R.string.unconfirmed; render(); return; }
            if(!connected) { pending=""; pendingEdit=false; draft=null; feedback=R.string.offline_saved; render(); return; }
            feedback = R.string.waiting; render();
            String requestId = pending;
            Wearable.getMessageClient(this).sendMessage(phone, "/opengym/v1/command", command.toString().getBytes(StandardCharsets.UTF_8)).addOnFailureListener(e -> { if(requestId.equals(pending)) failedCommand(); });
        } catch (Exception ignored) { failedCommand(); }
    }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); WearStyle.typography(view, size >= 30 ? 400 : 500, true); view.setText(value); view.setTextSize(size); view.setGravity(Gravity.CENTER); view.setTextColor(Color.WHITE); view.setPadding(0, dp(4), 0, dp(4)); content.addView(view); return view;
    }
    private Button button(int label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setMinHeight(dp(48)); rounded(b, false); content.addView(b, new LinearLayout.LayoutParams(-1, -2)); b.setOnClickListener(v -> action.run()); return b;
    }
    private String targetIdentity(JSONObject current) {
        return current == null ? "" : current.optInt("entryIdx") + ":" + current.optInt("setIdx") + ":" + current.optString("side") + ":" + current.optString("name") + ":" + current.optString("setLabel");
    }
    private boolean validDraft(JSONObject current) {
        return current != null && current.optBoolean("canEdit") && state.optBoolean("active") && draft != null && draft.matches(state.optString("contextToken"), targetIdentity(current), current.optString("loadUnit"), current.optDouble("r".equals(draft.field) ? "repsValue" : "loadValue", Double.NaN), current.optDouble("loadStep", 1), current.optDouble("loadStart", Double.NaN));
    }
    private void openEditor(String field) {
        JSONObject current = state.optJSONObject("current");
        if (!(controlsAvailable() || localEditing()) || current == null || !current.optBoolean("canEdit")) return;
        double value = current.optDouble("r".equals(field) ? "repsValue" : "loadValue", Double.NaN);
        if (!Double.isNaN(value) && (!Double.isFinite(value) || value < 0 || value > 10000 || ("r".equals(field) && value != Math.rint(value)))) return;
        draft = new WearEditor(state.optString("contextToken"), targetIdentity(current), field, current.optString("loadUnit"), value, current.optDouble("loadStep", 1), current.optDouble("loadStart", Double.NaN)); options = false; render();
    }
    private String displayNumber(double value) {
        char separator = java.text.DecimalFormatSymbols.getInstance(getResources().getConfiguration().getLocales().get(0)).getDecimalSeparator();
        return WearEditor.number(value).replace('.', separator);
    }
    private void rounded(Button b, boolean yellow) {
        palette(b, yellow ? WearStyle.PRIMARY : WearStyle.SURFACE, yellow ? WearStyle.ON_PRIMARY : WearStyle.INK);
    }
    private void palette(Button b, int fill, int ink) {
        WearStyle.surface(b, fill, ink, false);
    }
    private void action(Button b, int label, String icon, boolean green) {
        if (b == null) return;
        boolean waiting = !pending.isEmpty() && (b == complete || b == confirmEdit);
        b.setText(getString(waiting ? R.string.sending_short : label));
        WearStyle.icon(b, waiting ? null : symbol(icon));
        b.setContentDescription(getString(waiting ? R.string.waiting : label));
        palette(b, WearStyle.PRIMARY, WearStyle.ON_PRIMARY);
    }
    private String symbol(String icon) {
        return switch (icon) {
            case "▶" -> "play";
            case "Ⅱ" -> "pause";
            case "✓" -> "check";
            case "♥" -> "heart";
            case "◷" -> "clock";
            case "🔔" -> "bell";
            case "↻" -> "refresh";
            case "×" -> "close";
            default -> null;
        };
    }
    private int connectionStatus() {
        if (phone.isEmpty()) return R.string.disconnected;
        if (!WearProtocol.canControl(true, confirmedAt, SystemClock.elapsedRealtime(), false)) return R.string.phone_unresponsive;
        return state.optBoolean("active") ? R.string.connected : R.string.open_phone;
    }
    private boolean isResting() {
        JSONObject timer = state.optJSONObject("timer");
        if (effort() != null) return false;
        return state.optBoolean("active") && timer != null && !timer.optBoolean("ready") &&
            (timer.optBoolean("paused") ? timer.optLong("leftMs") > 0 : timer.optLong("endsAt") > System.currentTimeMillis());
    }
    private void indicator(FrameLayout host) {
        connectionIndicator = new View(this); connectionIndicator.setTag("connection-indicator");
        android.graphics.drawable.GradientDrawable dot = new android.graphics.drawable.GradientDrawable();
        dot.setShape(android.graphics.drawable.GradientDrawable.OVAL); dot.setColor(Color.rgb(255, 59, 79));
        connectionIndicator.setBackground(dot);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(8), dp(8), Gravity.TOP | Gravity.START);
        params.leftMargin = dp(6); params.topMargin = dp(7); host.addView(connectionIndicator, params);
    }
    private void menuButton(LinearLayout header) {
        FrameLayout host = new FrameLayout(this); header.addView(host, new LinearLayout.LayoutParams(dp(48), dp(48)));
        Button menu = new Button(this); menu.setText(""); menu.setTag("options-menu"); menu.setTextColor(WearStyle.INK); menu.setTextSize(16);
        menu.setContentDescription(getString(R.string.options)); menu.setBackgroundColor(Color.TRANSPARENT); menu.setPadding(0,0,0,0); menu.setMinWidth(0); menu.setMinimumWidth(0);
        host.addView(menu, new FrameLayout.LayoutParams(-1,-1));
        WearStyle.icon(menu, "menu"); menu.setPadding(dp(15),0,dp(15),0);
        menu.setOnClickListener(v -> { options = true; optionsPage = ""; render(); }); indicator(host);
    }
    private void pageHeader(String title, Runnable back) {
        LinearLayout header = row();
        Button button = rowButton(header, "", "back", back);
        button.setContentDescription(getString(R.string.back)); button.setTextSize(28); button.setBackgroundColor(Color.TRANSPARENT);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        WearStyle.icon(button, "back"); button.setPadding(dp(15),0,dp(15),0);
        TextView label = new TextView(this); WearStyle.typography(label,600,false); label.setText(title); label.setTextColor(Color.WHITE); label.setTextSize(16); label.setGravity(Gravity.CENTER);
        header.addView(label, new LinearLayout.LayoutParams(0, dp(48), 1));
        FrameLayout corner = new FrameLayout(this); header.addView(corner, new LinearLayout.LayoutParams(dp(48), dp(48))); indicator(corner);
    }
    private void editorHeader(String title) {
        FrameLayout header = new FrameLayout(this); content.addView(header, new LinearLayout.LayoutParams(-1, dp(48)));
        TextView label = new TextView(this); WearStyle.typography(label, 600, false); label.setText(title); label.setTextColor(Color.WHITE); label.setGravity(Gravity.CENTER); label.setMaxLines(1);
        label.setEllipsize(android.text.TextUtils.TruncateAt.END); label.setAutoSizeTextTypeUniformWithConfiguration(11,16,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(-1,-1); labelParams.leftMargin = dp(18); labelParams.rightMargin = dp(18);
        header.addView(label, labelParams);
        FrameLayout corner = new FrameLayout(this); header.addView(corner, new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END)); indicator(corner);
        Button back = new Button(this); back.setTag("back"); back.setContentDescription(getString(R.string.back)); back.setTextColor(WearStyle.PRIMARY); back.setBackgroundColor(Color.TRANSPARENT);
        WearStyle.icon(back,"back"); back.setPadding(dp(14),0,dp(14),0);
        header.addView(back,new FrameLayout.LayoutParams(dp(48),dp(48),Gravity.START));
        back.setOnClickListener(v -> { if (pending.isEmpty()) { draft=null; render(); } });
    }
    private Button option(int label, String icon, String tag, Runnable action) {
        Button button = compactButton(getString(label), tag, action, false);
        WearStyle.icon(button, "alerts-settings".equals(tag) ? "bell" : symbol(icon));
        ((LinearLayout.LayoutParams)button.getLayoutParams()).topMargin = dp(1);
        button.setContentDescription(getString(label));
        if ("heart-settings".equals(tag) || "alerts-settings".equals(tag) || "reconnect".equals(tag)) {
            button.setAutoSizeTextTypeUniformWithConfiguration(12,14,1,android.util.TypedValue.COMPLEX_UNIT_SP); WearStyle.chevron(button);
        }
        return button;
    }
    private Button compactButton(String label, String description, Runnable action, boolean yellow) {
        Button b = button(R.string.complete, action); b.setText(label); b.setTag(description); b.setContentDescription(label); b.setTextSize(16); rounded(b, yellow);
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams)b.getLayoutParams(); params.height = dp(48); params.topMargin = dp(3); b.setLayoutParams(params); return b;
    }
    private Button rowButton(LinearLayout row, String label, String description, Runnable action) {
        Button b = "edit-reps".equals(description) || "edit-load".equals(description) ? new WearStyle.MetricButton(this) : new Button(this); b.setText(label); b.setTextSize(16); b.setMaxLines(1); b.setAutoSizeTextTypeUniformWithConfiguration(12,16,1,android.util.TypedValue.COMPLEX_UNIT_SP); b.setAllCaps(false); b.setTag(description); b.setContentDescription("edit-reps".equals(description) ? getString(R.string.edit_reps) + ": " + label : "edit-load".equals(description) ? getString(R.string.edit_load) + ": " + label : "increase".equals(description) ? getString(R.string.increase) : "decrease".equals(description) ? getString(R.string.decrease) : description); b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(dp(48)); rounded(b, false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1); params.setMargins(dp(2), 0, dp(2), 0); row.addView(b, params); b.setOnClickListener(v -> action.run()); return b;
    }
    private TextView heartIcon() {
        TextView icon = new TextView(this) {
            private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(android.graphics.Canvas canvas) {
                float size = Math.min(dp(20), Math.min(getWidth(), getHeight())), x = (getWidth()-size)/2f, y = (getHeight()-size)/2f;
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
    private void heartHeader(LinearLayout header) {
        LinearLayout readings = new LinearLayout(this); readings.setOrientation(LinearLayout.VERTICAL); readings.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL); readings.setPadding(dp(8),0,0,0);
        header.addView(readings, new LinearLayout.LayoutParams(dp(48), dp(48)));
        heartReading = heartIcon(); readings.addView(heartReading, new LinearLayout.LayoutParams(dp(24), dp(20)));
        if (showingRest && !options && draft == null) heartReading.setTranslationY(dp(8));
        heartBpm = new TextView(this); WearStyle.typography(heartBpm, 600, true); heartBpm.setTag("heart-bpm"); heartBpm.setTextSize(12); heartBpm.setGravity(Gravity.CENTER); heartBpm.setTextColor(WearStyle.INK);
        readings.addView(heartBpm, new LinearLayout.LayoutParams(-1, dp(20)));
    }
    private void workoutHeader(JSONObject current) {
        FrameLayout header = new FrameLayout(this); header.setTag("workout-header");
        LinearLayout.LayoutParams headerParams = new LinearLayout.LayoutParams(-1, dp(showingRest ? 44 : 48));
        headerParams.leftMargin = -dp(30); headerParams.rightMargin = -dp(30);
        content.addView(header, headerParams);
        TextView name = new WearArcTitle(this); WearStyle.typography(name, 700, false);
        name.setTag("workout-title"); name.setText(current.optString("name")); name.setTextColor(WearStyle.INK);
        name.setTextSize(18.5f); name.setIncludeFontPadding(false);
        header.addView(name, new FrameLayout.LayoutParams(-1, dp(36)));
        FrameLayout info = new FrameLayout(this);
        FrameLayout.LayoutParams infoParams = new FrameLayout.LayoutParams(-1, dp(20)); infoParams.topMargin = dp(32); header.addView(info, infoParams);
        phaseLabel = new TextView(this); WearStyle.typography(phaseLabel, 600, true); phaseLabel.setTextSize(12);
        phaseLabel.setGravity(Gravity.CENTER);
        phaseLabel.setTextColor(WearStyle.MUTED); phaseLabel.setMaxLines(1); phaseLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        FrameLayout.LayoutParams seriesParams = new FrameLayout.LayoutParams(-1,-1); seriesParams.leftMargin = dp(30); seriesParams.rightMargin = dp(30);
        info.addView(phaseLabel,seriesParams);
    }
    private void workoutCounter() {
        FrameLayout counter = new FrameLayout(this); counter.setTag("workout-counter");
        LinearLayout.LayoutParams counterParams = new LinearLayout.LayoutParams(-1,dp(showingRest ? 48 : 56));
        counterParams.leftMargin = -dp(30); counterParams.rightMargin = -dp(30);
        content.addView(counter,counterParams);
        rest = new TextView(this); rest.setText("00:00"); rest.setTextColor(WearStyle.INK);
        rest.setIncludeFontPadding(false); rest.setGravity(Gravity.CENTER); WearStyle.typography(rest,700,true);
        rest.setMaxLines(1);
        if (showingRest) rest.setTextSize(40);
        else rest.setAutoSizeTextTypeUniformWithConfiguration(36,46,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        FrameLayout.LayoutParams timerParams = new FrameLayout.LayoutParams(-1,showingRest ? dp(40) : -1); timerParams.leftMargin = dp(36); timerParams.rightMargin = dp(20);
        counter.addView(rest,timerParams); if (showingRest) rest.setTranslationY(-dp(8));
        FrameLayout host = new FrameLayout(this); counter.addView(host,new FrameLayout.LayoutParams(dp(48),dp(48),Gravity.CENTER_VERTICAL | Gravity.START));
        heartReading = heartIcon(); heartReading.setTag("heart-status");
        host.addView(heartReading,new FrameLayout.LayoutParams(dp(12),dp(12),Gravity.CENTER)); indicator(host);
    }
    private void footerSpace() { content.addView(new View(this),new LinearLayout.LayoutParams(1,0,1)); }
    private Button primaryButton(Runnable action) {
        footerSpace();
        Button button = new WearStyle.EdgeButton(this); button.setTag("main-action"); button.setAllCaps(false); button.setTextSize(18);
        button.setMaxLines(1); button.setIncludeFontPadding(false);
        button.setAutoSizeTextTypeUniformWithConfiguration(18,20,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        button.setMinHeight(dp(48)); button.setMinWidth(0); button.setMinimumWidth(0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(164),dp(56));
        content.addView(button,params); button.setTranslationX(-dp(.5f)); rounded(button,true); button.setOnClickListener(v -> action.run()); return button;
    }
    private boolean freshHeart() {
        return WearEditor.heartFresh(WearHeartService.running, WearHeartService.latestBpm, WearHeartService.latestElapsed, SystemClock.elapsedRealtime());
    }
    private void startSet() {
        if (standaloneMode()) { localAction("start"); return; }
        if (!enabled()) return;
        if (!WearHeartService.running) { toggleHeart(); return; }
        if (freshHeart()) send("heart-start");
    }
    private LinearLayout row() { LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER); content.addView(row, new LinearLayout.LayoutParams(-1, dp(48))); return row; }
    private void enterAmbient() {
        ambient = true; confirmedAt = 0; handler.removeCallbacks(tick); stopHeartPulse();
        updateWorkoutScreen();
        render();
    }
    private void exitAmbient() {
        ambient = false; confirmedAt = 0; render();
        if (foreground) { sync(); handler.removeCallbacks(tick); handler.post(tick); }
    }
    private void refreshAmbient() { if (ambient) render(); }
    private TextView ambientText(String value, int size, String tag) {
        TextView label = text(value, size); label.setTag(tag);
        label.setTextColor(lowBitAmbient ? Color.WHITE : Color.rgb(170,170,170));
        label.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
        if (lowBitAmbient) label.setPaintFlags(label.getPaintFlags() & ~android.graphics.Paint.ANTI_ALIAS_FLAG);
        return label;
    }
    private String clockTime(long time) {
        return android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(time));
    }
    private void renderAmbient() {
        content.setTag("ambient-screen");
        ambientText(clockTime(System.currentTimeMillis()), 17, "ambient-clock").setPadding(0,dp(10),0,dp(10));
        JSONObject current = state.optJSONObject("current"), timer = state.optJSONObject("timer"), capture = effort();
        if (!state.optBoolean("active") || current == null) {
            ambientText("OpenGym",14,"ambient-name");
            ambientText(getString(state.optBoolean("active") ? R.string.sets_finished : R.string.open_phone),13,"ambient-phase");
            return;
        }
        TextView name = ambientText(current.optString("name"),16,"ambient-name"); name.setMaxLines(1); name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        ambientText(current.optString("setLabel"),12,"ambient-set");
        boolean effort = capture != null;
        boolean paused = timer != null && timer.optBoolean("paused") && timer.optLong("leftMs") > 0;
        boolean resting = !effort && timer != null && !timer.optBoolean("ready") && (paused || timer.optLong("endsAt") > System.currentTimeMillis());
        ambientText(getString(effort ? R.string.phase_effort : resting ? (paused ? R.string.phase_paused : R.string.phase_rest) : R.string.phase_ready),16,"ambient-phase");
        String detail = resting && !paused ? getString(R.string.ambient_rest_until, clockTime(timer.optLong("endsAt"))) : "";
        ambientText(detail,13,"ambient-detail");
        // No seconds/BPM or solid buttons: the system refreshes this display infrequently.
        // Existing side padding keeps all text clear of system burn-in shifts.
    }
    private void render() {
        if (content == null) return;
        updateWorkoutScreen();
        applyWorkoutLanguage(); phaseLabel = null;
        stopHeartPulse(); content.removeAllViews(); complete = startSet = pause = plus = skip = cancelHeart = enableHeart = reconnect = manualComplete = null; heartReading = heartBpm = rest = null; connectionIndicator = null;
        repsChip = loadChip = confirmEdit = decrease = increase = cancelEdit = null;
        content.setTag(null);
        backdrop.motion(foreground && !ambient && android.animation.ValueAnimator.areAnimatorsEnabled());
        if (ambient) scroll.setBackgroundColor(Color.BLACK); else scroll.setBackground(backdrop);
        if (ambient) { renderAmbient(); return; }
        JSONObject current = state.optJSONObject("current");
        if (draft != null && !validDraft(current)) { draft = null; feedback = R.string.edit_changed; }
        showingRest = !options && draft == null && isResting();
        content.setClipToPadding(false); content.setClipChildren(false);
        content.setPadding(dp(30), dp(4), dp(30), dp(4));
        showingHeartRunning = WearHeartService.running;
        if (options) { renderOptions(); updateControls(); updateHeart(); return; }
        if (draft != null) {
            editorHeader(getString("r".equals(draft.field) ? R.string.edit_reps : R.string.edit_load));
            TextView subtitle = text(current.optString("name"),12); subtitle.setPadding(0,0,0,0); subtitle.setLayoutParams(new LinearLayout.LayoutParams(-1,dp(16)));
            LinearLayout adjust = row();
            decrease = rowButton(adjust, "−", "decrease", () -> { draft.adjust(-1); render(); });
            decrease.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48)));
            TextView value = new TextView(this); WearStyle.typography(value,700,true);
            value.setText(displayNumber(draft.value) + (draft.field.equals("w") ? " " + draft.unit : ""));
            value.setTextColor(WearStyle.INK); value.setGravity(Gravity.CENTER); value.setTag("draft-value");
            value.setMaxLines(1); value.setAutoSizeTextTypeUniformWithConfiguration(14,28,1,android.util.TypedValue.COMPLEX_UNIT_SP);
            adjust.addView(value,new LinearLayout.LayoutParams(0,dp(48),1));
            increase = rowButton(adjust, "+", "increase", () -> { draft.adjust(1); render(); });
            increase.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48)));
            for (Button control : new Button[] {decrease,increase}) { rounded(control,true); control.setAutoSizeTextTypeWithDefaults(TextView.AUTO_SIZE_TEXT_TYPE_NONE); control.setTextSize(28); }
            if ("w".equals(draft.field)) arrangeLoadEditor(adjust,value);
            cancelEdit = compactButton(getString(R.string.cancel_edit),"cancel-edit", () -> { draft = null; render(); },false);
            cancelEdit.setLayoutParams(new LinearLayout.LayoutParams(dp(100),dp(48))); cancelEdit.setAutoSizeTextTypeUniformWithConfiguration(12,14,1,android.util.TypedValue.COMPLEX_UNIT_SP);
            confirmEdit = primaryButton(() -> send("edit-set")); confirmEdit.setTag("confirm-edit");
        } else {
            if (state.optBoolean("active") && current != null) {
                workoutHeader(current);
                workoutCounter();
                LinearLayout chips = row(); chips.setTag("workout-metrics");
                ((LinearLayout.LayoutParams)chips.getLayoutParams()).topMargin = dp(4);
                double reps = current.optDouble("repsValue", Double.NaN), load = current.optDouble("loadValue", Double.NaN);
                repsChip = rowButton(chips, Double.isFinite(reps) ? displayNumber(reps) + " " + getString(R.string.reps_short) : "— " + getString(R.string.reps_short), "edit-reps", () -> openEditor("r"));
                loadChip = rowButton(chips, Double.isFinite(load) ? displayNumber(load) + " " + current.optString("loadUnit") : "— " + current.optString("loadUnit"), "edit-load", () -> openEditor("w"));
                metricText(repsChip); metricText(loadChip);
                if (showingRest) {
                    skip = quietButton(getString(R.string.skip_short), "rest-skip", () -> send("skip"));
                    plus = quietButton("+15 s", "rest-plus", () -> send("plus15"));
                    pause = primaryButton(() -> { JSONObject timer = state.optJSONObject("timer"); if (timer != null) send(timer.optBoolean("paused") ? "resume" : "pause"); });
                    pause.setTag("rest-pause");
                } else if (current.optBoolean("canComplete")) {
                    complete = primaryButton(() -> {
                        if (effort() == null) startSet(); else send("complete");
                    });
                } else text(getString(R.string.use_phone), 12);
            } else {
                LinearLayout header = row(); heartHeader(header);
                TextView title = new TextView(this); WearStyle.typography(title, 600, false); title.setText("OpenGym"); title.setTextColor(Color.WHITE); title.setTextSize(16); title.setGravity(Gravity.CENTER);
                header.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1)); menuButton(header);
                TextView message = text(getString(state.optBoolean("active") ? R.string.sets_finished : R.string.open_phone), 17);
                message.setPadding(dp(16), dp(16), dp(16), dp(8));
            }
            if (state.optBoolean("active") && current != null && (complete != null || pause != null)) arrangeWorkout();
            if (feedback == R.string.unconfirmed || feedback == R.string.edit_changed) text(getString(feedback), 11);
        }
        if((WearOutbox.read(this)!=null || WearStandalone.pending(this)>0 || WearStandalone.conflicted(this)) && phaseLabel!=null) {
            phaseLabel.setText(getString(WearOutbox.conflicted(this) || WearStandalone.conflicted(this)?R.string.offline_conflict:R.string.offline_saved));
            phaseLabel.setTextSize(10);
        }
        updateTimer(); updateControls(); updateHeart();
    }
    private void arrangeLoadEditor(LinearLayout adjust,TextView value) {
        int index=content.indexOfChild(adjust);
        adjust.removeAllViews(); content.removeView(adjust);
        FrameLayout panel=new FrameLayout(this) {
            @Override protected void onMeasure(int widthSpec,int heightSpec) {
                int width=View.MeasureSpec.getSize(widthSpec);
                // The approved editor spreads the controls to expose a wider central value.
                boolean compact=width<dp(160);
                float left=compact ? 24 : 8, right=compact ? width/getResources().getDisplayMetrics().density-24 : 155.5f;
                FrameLayout.LayoutParams minus=new FrameLayout.LayoutParams(dp(48),dp(48)); minus.leftMargin=dp(left-24); decrease.setLayoutParams(minus);
                FrameLayout.LayoutParams plus=new FrameLayout.LayoutParams(dp(48),dp(48)); plus.leftMargin=dp(right-24); increase.setLayoutParams(plus);
                int gapLeft=dp(left+24),gapRight=dp(right-24);
                FrameLayout.LayoutParams label=new FrameLayout.LayoutParams(Math.max(dp(36),gapRight-gapLeft),dp(48)); label.leftMargin=compact ? gapLeft : dp(82.5f)-label.width/2; value.setLayoutParams(label);
                decrease.setTranslationY(compact ? 0 : -dp(2)); increase.setTranslationY(compact ? 0 : -dp(2));
                super.onMeasure(widthSpec,heightSpec);
            }
        };
        panel.setClipChildren(false); panel.setClipToPadding(false);
        for(View view:new View[] {decrease,value,increase}) panel.addView(view);
        content.addView(panel,index,new LinearLayout.LayoutParams(-1,dp(48)));
    }
    private void metricText(Button button) {
        String label = button.getText().toString(); int split = label.indexOf(' ');
        if (split < 0) return;
        android.text.SpannableString styled = new android.text.SpannableString(label);
        button.setAutoSizeTextTypeWithDefaults(TextView.AUTO_SIZE_TEXT_TYPE_NONE);
        button.setTextSize(16);
        styled.setSpan(new android.text.style.RelativeSizeSpan(.75f),split,label.length(),0);
        styled.setSpan(new android.text.style.TypefaceSpan(android.graphics.Typeface.create(getResources().getFont(R.font.nunito),500,false)),split,label.length(),0);
        button.setText(styled);
    }
    private Button quietButton(String label, String tag, Runnable action) {
        Button button = new WearStyle.QuietButton(this); button.setText(label); button.setTag(tag); button.setAllCaps(false);
        button.setContentDescription(label); button.setIncludeFontPadding(false); button.setGravity(Gravity.CENTER);
        button.setMinWidth(0); button.setMinimumWidth(0); button.setMinHeight(0); button.setMinimumHeight(0);
        button.setMaxLines(1); button.setAutoSizeTextTypeUniformWithConfiguration(8,11,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        WearStyle.quiet(button); button.setOnClickListener(view -> action.run()); return button;
    }
    private void arrangeWorkout() {
        View header = content.findViewWithTag("workout-header"), metrics = content.findViewWithTag("workout-metrics");
        WearStyle.EdgeButton primary = (WearStyle.EdgeButton)(showingRest ? pause : complete);
        primary.workoutLayout = true; primary.setTranslationX(0);
        ((android.view.ViewGroup)rest.getParent()).removeView(rest);
        ((android.view.ViewGroup)heartReading.getParent()).removeView(heartReading);
        ((android.view.ViewGroup)phaseLabel.getParent()).removeView(phaseLabel);
        ((android.view.ViewGroup)connectionIndicator.getParent()).removeView(connectionIndicator);
        rest.setTag("workout-counter"); rest.setTranslationY(0);
        Button menu = quietButton(getString(R.string.options),"options-menu",() -> { options=true; optionsPage=""; render(); });
        WearStyle.menuAbove(menu);
        content.setPadding(0,0,0,0);
        FrameLayout panel = new FrameLayout(this) {
            @Override protected void onMeasure(int widthSpec,int heightSpec) {
                int w = View.MeasureSpec.getSize(widthSpec), h = View.MeasureSpec.getSize(heightSpec);
                // ScrollView first measures weighted children without a height constraint.
                float scale=(h>0 ? Math.min(w,h) : w)/(float)dp(225), unit=dp(225)*scale/225f;
                int touch=Math.round(48*unit), primaryTop=Math.round(175*unit), metricsTop=Math.round(126*unit);
                int sideTop=metricsTop-touch, menuTop=sideTop-touch;
                int sideWidth=touch, sideInset=Math.round(5*unit);
                position(header,0,Math.round(2.4f*unit),w,Math.round(52*unit));
                TextView title=header.findViewWithTag("workout-title"); title.setTextSize(18.5f*scale); WearStyle.typography(title,750,false);
                position(phaseLabel,Math.round(54*unit),Math.round(47*unit),w-Math.round(108*unit),Math.round(20*unit));
                phaseLabel.setTextSize((WearOutbox.read(WearActivity.this)!=null || WearStandalone.pending(WearActivity.this)>0 || WearStandalone.conflicted(WearActivity.this) ? 10 : 12)*scale);
                int timerLeft=sideInset+sideWidth, timerWidth=w-2*timerLeft;
                position(rest,timerLeft,Math.round(77.5f*unit),timerWidth,Math.round(56*unit));
                rest.setAutoSizeTextTypeUniformWithConfiguration(20,Math.max(21,Math.round(40*scale)),1,android.util.TypedValue.COMPLEX_UNIT_SP);
                position(heartReading,Math.round(w/2f-6*unit),Math.round(34*unit),Math.round(12*unit),Math.round(12*unit));
                position(connectionIndicator,Math.round(35*unit),Math.round(49*unit),dp(6),dp(6));
                float menuCenter=187*unit;
                position(menu,Math.min(w-touch,Math.round(menuCenter-touch/2f)),menuTop,touch,touch);
                ((WearStyle.QuietButton)menu).contentOffsetY=32*unit-menuTop;
                menu.setAutoSizeTextTypeWithDefaults(TextView.AUTO_SIZE_TEXT_TYPE_NONE); menu.setTextSize(8*scale);
                position(metrics,Math.round(31*unit),metricsTop,w-Math.round(62*unit),touch);
                for (Button chip : new Button[] {repsChip,loadChip}) {
                    chip.setTextSize(16*scale); chip.setPadding(dp(3),0,dp(3),0);
                    ((WearStyle.MetricButton)chip).layoutScale=scale;
                    LinearLayout.LayoutParams params=(LinearLayout.LayoutParams)chip.getLayoutParams();
                    params.leftMargin=Math.round(unit); params.rightMargin=Math.round(unit); params.height=touch; chip.setLayoutParams(params);
                }
                if (showingRest) {
                    position(skip,sideInset,sideTop,sideWidth,touch);
                    position(plus,w-sideInset-sideWidth,sideTop,sideWidth,touch);
                    for (Button button : new Button[] {skip,plus}) {
                        button.setAutoSizeTextTypeWithDefaults(TextView.AUTO_SIZE_TEXT_TYPE_NONE); button.setTextSize(11*scale);
                        ((WearStyle.QuietButton)button).contentOffsetY=105.5f*unit-(sideTop+touch/2f);
                    }
                }
                primary.layoutScale=scale;
                primary.setAutoSizeTextTypeUniformWithConfiguration(12,Math.max(13,Math.round(16*scale)),1,android.util.TypedValue.COMPLEX_UNIT_SP);
                android.graphics.drawable.Drawable icon=primary.getCompoundDrawablesRelative()[0];
                if (icon != null) { int size=Math.round(20*unit); icon.setBounds(0,0,size,size); }
                int primaryWidth=Math.round(153.5f*unit);
                position(primary,Math.round(w/2f-.5f*unit-primaryWidth/2f),primaryTop,primaryWidth,touch);
                super.onMeasure(widthSpec,heightSpec);
            }
            private void position(View view,int left,int top,int width,int height) {
                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width,Math.max(0,height)); params.leftMargin=left; params.topMargin=top; view.setLayoutParams(params);
            }
        };
        panel.setTag("workout-panel"); panel.setClipChildren(false); panel.setClipToPadding(false);
        for (View view : new View[] {header,metrics,primary,phaseLabel,rest,heartReading,connectionIndicator,menu,skip,plus}) {
            if (view != null) { content.removeView(view); panel.addView(view); }
        }
        content.removeAllViews(); content.addView(panel,new LinearLayout.LayoutParams(-1,0,1));
    }
    private void renderOptions() {
        pageHeader(getString("heart".equals(optionsPage) ? R.string.heart_settings : "alerts".equals(optionsPage) ? R.string.alert_settings : R.string.options), () -> {
            if (optionsPage.isEmpty()) options = false; else optionsPage = "";
            render();
        });
        if (optionsPage.isEmpty()) {
            Button back=content.findViewWithTag("back"); back.setText(getString(R.string.back)); WearStyle.labelAbove(back,"back");
        }
        if ("heart".equals(optionsPage)) {
            heartReading = text("", 14);
            enableHeart = option(WearHeartService.running ? R.string.heart_disable : R.string.heart_enable, "♥", "toggle-heart", this::toggleHeart);
            JSONObject current = state.optJSONObject("current");
            JSONObject mark = state.optJSONObject("heartCapture");
            if (!standaloneMode() && state.optBoolean("active") && current != null && current.optBoolean("canComplete") && (mark == null || !"effort".equals(mark.optString("phase")))) {
                manualComplete = option(R.string.complete_without_heart, "✓", "complete-no-heart", () -> send("complete"));
            }
            JSONObject capture = state.optJSONObject("heartCapture");
            if (capture != null && "effort".equals(capture.optString("phase"))) cancelHeart = option(R.string.heart_cancel_set, "×", "cancel-heart", () -> send("heart-cancel"));
        } else if ("alerts".equals(optionsPage)) {
            if (WearTimer.canSchedule(this)) text("✓ " + getString(R.string.precise_alerts), 14);
            else option(R.string.precise_alerts, "◷", "alarm-permission", () -> { try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { } });
            if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) text("✓ " + getString(R.string.rest_notifications), 14);
            else option(R.string.rest_notifications, "🔔", "notification-permission", () -> requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1));
        } else {
            JSONObject exercise = effort();
            if (standaloneMode() && exercise != null) {
                option(exercise.optBoolean("paused") ? R.string.resume_effort : R.string.pause_effort, exercise.optBoolean("paused") ? "▶" : "Ⅱ", "effort-pause", () -> {
                    JSONObject live = effort(); if (live != null) localAction(live.optBoolean("paused") ? "resume-effort" : "pause-effort");
                }).setEnabled(standaloneEnabled());
            }
            option(R.string.heart_settings, "♥", "heart-settings", () -> { optionsPage = "heart"; render(); });
            if (WearStandalone.pending(this)>0 || WearStandalone.conflicted(this)) option(R.string.offline_review,"◷","standalone-review",() -> {
                new AlertDialog.Builder(this).setTitle(WearStandalone.conflicted(this)?R.string.offline_conflict:R.string.offline_saved)
                    .setMessage(getString(R.string.standalone_explanation))
                    .setPositiveButton(android.R.string.ok,null)
                    .setNeutralButton(R.string.offline_discard,(dialog,which)->new AlertDialog.Builder(this).setMessage(R.string.standalone_discard)
                        .setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(d,w)->{
                            if (WearStandalone.discard(this)) { WearStandalone.receive(this,WearStateService.remote(this)); WearStateService.refresh(this); state=WearStateService.cached(this); render(); sync(); }
                        }).show()).show();
            });
            if(WearOutbox.read(this)!=null) option(R.string.offline_review,"◷","offline-review",() -> {
                JSONObject queued=WearOutbox.read(this);
                JSONObject base=queued==null?null:queued.optJSONObject("baseline");
                String detail=base==null?"":base.optString("name")+" · "+base.optString("setLabel");
                if(queued!=null) detail+="\n"+("edit-set".equals(queued.optString("action")) ? displayNumber(queued.optDouble("value",0))+" "+("w".equals(queued.optString("field"))?queued.optString("unit"):getString(R.string.reps_short)) : getString(R.string.complete));
                new AlertDialog.Builder(this).setTitle(WearOutbox.conflicted(this)?R.string.offline_conflict:R.string.offline_saved)
                    .setMessage(getString(R.string.offline_explanation)+"\n"+detail)
                    .setPositiveButton(android.R.string.ok,null)
                    .setNeutralButton(R.string.offline_discard,(dialog,which)->new AlertDialog.Builder(this).setMessage(R.string.offline_discard)
                        .setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(d,w)->{WearOutbox.clear(this);render();sync();}).show()).show();
            });
            option(R.string.alert_settings, "◷", "alerts-settings", () -> { optionsPage = "alerts"; render(); });
            reconnect = option(R.string.refresh, "↻", "reconnect", this::sync);
            footerSpace();
        }
    }
    private void updateControls() {
        updateWorkoutScreen();
        if (ambient) return;
        boolean enabled = controlsAvailable() && state.optBoolean("active") && WearOutbox.read(this)==null;
        if(connectionIndicator != null) {
            int status = connectionStatus();
            connectionIndicator.setVisibility(status == R.string.disconnected || status == R.string.phone_unresponsive ? View.VISIBLE : View.INVISIBLE);
            connectionIndicator.setContentDescription(getString(status));
        }
        if (reconnect != null) {
            int status = connectionStatus();
            reconnect.setVisibility(View.VISIBLE);
        }
        JSONObject captureForAction=state.optJSONObject("heartCapture");
        if (complete != null) complete.setEnabled(enabled || (localEditing() && captureForAction!=null && "effort".equals(captureForAction.optString("phase"))));
        if (startSet != null) {
            action(startSet, R.string.heart_start_set, "▶", true);
            startSet.setText(showingRest ? "" : getString(R.string.heart_start_short));
            if (!showingRest) startSet.setPadding(dp(4),0,dp(4),0);
            startSet.setEnabled(enabled && (standaloneMode() || !WearHeartService.running || freshHeart()));
        }
        JSONObject current = state.optJSONObject("current");
        if (manualComplete != null) manualComplete.setEnabled((enabled || localEditing()) && current != null && current.optBoolean("canComplete"));
        boolean editable = (enabled || localEditing()) && current != null && current.optBoolean("canEdit");
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
        JSONObject timer = state.optJSONObject("timer");
        boolean paused = timer != null && timer.optBoolean("paused");
        if (pause == rest && pause != null) { palette(pause, paused ? WearStyle.PRIMARY : WearStyle.REST, WearStyle.ON_PRIMARY); WearStyle.typography(pause, 400, true); WearStyle.icon(pause, pending.isEmpty() ? (paused ? "play" : "pause") : null); pause.setContentDescription(getString(!pending.isEmpty() ? R.string.waiting : paused ? R.string.resume : R.string.pause)); }
        else action(pause, paused ? R.string.resume : R.string.pause, paused ? "▶" : "Ⅱ", true);
        if (plus != null) { plus.setText("+15 s"); }
        if (skip != null) { skip.setText(getString(R.string.skip_short)); skip.setContentDescription(getString(R.string.skip)); }
        if (showingRest && startSet != null) {
            plus.setText("+15 s"); WearStyle.icon(plus, null);
            skip.setText("");
        }
        action(confirmEdit, R.string.confirm_edit, "✓", true);
        if (cancelHeart != null) { cancelHeart.setText(getString(R.string.heart_cancel_set)); WearStyle.icon(cancelHeart, "close"); palette(cancelHeart, Color.rgb(74, 42, 36), WearStyle.INK); }
    }
    private void toggleHeart() {
        if (WearHeartService.running) {
            heartPreference().edit().remove("context").apply();
            JSONObject capture = state.optJSONObject("heartCapture");
            if (!standaloneMode() && enabled() && capture != null && "effort".equals(capture.optString("phase"))) send("heart-cancel");
            startService(new Intent(this, WearHeartService.class).setAction("stop")); render(); return;
        }
        if (!controlsAvailable()) return;
        if (WearHeartResume.allowed(heartPreference().getString("context",""),state.optString("contextToken"),state.optBoolean("active"),checkSelfPermission(Manifest.permission.BODY_SENSORS)==PackageManager.PERMISSION_GRANTED,controlsAvailable())) { startHeart(); return; }
        new AlertDialog.Builder(this).setTitle(R.string.heart_title).setMessage(R.string.heart_consent)
            .setNegativeButton(android.R.string.cancel, null).setPositiveButton(R.string.heart_enable, (dialog, which) -> {
                if (checkSelfPermission(Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[] { Manifest.permission.BODY_SENSORS }, 42);
                else startHeart();
            }).show();
    }
    private android.content.SharedPreferences heartPreference() { return getSharedPreferences("heart-session",MODE_PRIVATE); }
    private void restoreHeartSession() {
        if (!state.optBoolean("active")) { heartPreference().edit().remove("context").apply(); return; }
        String current=state.optString("contextToken");
        if (!foreground || ambient || WearHeartService.running || current.equals(heartRestoreAttempt)) return;
        if (!WearHeartResume.allowed(heartPreference().getString("context",""),current,true,checkSelfPermission(Manifest.permission.BODY_SENSORS)==PackageManager.PERMISSION_GRANTED,controlsAvailable())) return;
        heartRestoreAttempt=current; startHeart();
    }
    private void startHeart() {
        if (!foreground || !state.optBoolean("active") || !controlsAvailable()) return;
        heartPreference().edit().putString("context",state.optString("contextToken")).apply();
        try { startForegroundService(new Intent(this, WearHeartService.class).setAction("start").putExtra("contextToken",state.optString("contextToken"))); } catch (Exception e) { WearHeartService.status = R.string.heart_unavailable; }
        render();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == 42) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) { if (controlsAvailable()) startHeart(); else { sync(); render(); } }
            else { WearHeartService.status = R.string.heart_unavailable; render(); }
        }
    }
    private void stopHeartPulse() {
        if (heartPulse != null) { heartPulse.cancel(); heartPulse = null; }
        if (heartReading != null) heartReading.setAlpha(1f);
    }
    private void updateHeart() {
        if (heartReading == null || ambient) return;
        boolean fresh = foreground && WearEditor.heartFresh(WearHeartService.running, WearHeartService.latestBpm, WearHeartService.latestElapsed, SystemClock.elapsedRealtime());
        if (heartBpm != null) {
            heartBpm.setText(fresh ? Long.toString(Math.round(WearHeartService.latestBpm)) : "—");
            heartBpm.setContentDescription(fresh ? Math.round(WearHeartService.latestBpm) + " bpm" : getString(WearHeartService.status));
        }
        int status = WearHeartStore.get(this).storageFailed || !WearHeartStore.get(this).canStart() ? R.string.heart_queue_full : (fresh ? R.string.heart_receiving : WearHeartService.status);
        heartReading.setContentDescription(getString(status));
        if (options) heartReading.setText(fresh ? Math.round(WearHeartService.latestBpm) + " bpm" : getString(status));
        else {
            heartReading.setTextColor(fresh ? Color.rgb(255, 59, 79) : Color.GRAY);
            if (fresh && heartPulse == null) { heartPulse = android.animation.ObjectAnimator.ofFloat(heartReading, "alpha", 1f, 0.35f, 1f); heartPulse.setDuration(1200); heartPulse.setRepeatCount(android.animation.ValueAnimator.INFINITE); heartPulse.start(); }
            if (!fresh) stopHeartPulse();
        }
        if (enableHeart != null) { action(enableHeart, WearHeartService.running ? R.string.heart_disable : R.string.heart_enable, "♥", !WearHeartService.running); enableHeart.setEnabled(WearHeartService.running || controlsAvailable()); }
        boolean start = effort() == null;
        action(complete, start ? R.string.heart_start_set : R.string.complete, start ? "▶" : "✓", start);
        if (complete != null && start && pending.isEmpty()) complete.setText(getString(R.string.heart_start_short));
        if (complete != null && startSet != null && !showingRest) {
            complete.setText(getString(R.string.complete_short)); complete.setPadding(dp(4),0,dp(4),0);
        }
        if (!standaloneMode() && complete != null && start && WearHeartService.running && !fresh) {
            complete.setText(getString(R.string.heart_wait_short));
            complete.setContentDescription(getString(WearHeartService.status));
            complete.setEnabled(false);
        }
    }
    private void updateTimer() {
        if (rest == null || ambient) return;
        JSONObject timer = state.optJSONObject("timer"), capture = effort();
        if (phaseLabel != null) {
            boolean effort = capture != null;
            boolean resting = timer != null && !timer.optBoolean("ready") && (timer.optBoolean("paused") ? timer.optLong("leftMs") > 0 : timer.optLong("endsAt") > System.currentTimeMillis());
            int label = effort ? R.string.phase_effort : resting ? (timer.optBoolean("paused") ? R.string.phase_paused : R.string.phase_rest) : R.string.phase_ready;
            JSONObject current=state.optJSONObject("current"); String setLabel=current==null?"":current.optString("setLabel");
            boolean unsynced=WearOutbox.read(this)!=null || WearStandalone.pending(this)>0 || WearStandalone.conflicted(this);
            phaseLabel.setText(unsynced ? getString(WearOutbox.conflicted(this)||WearStandalone.conflicted(this)?R.string.offline_conflict:R.string.offline_saved) : setLabel);
            phaseLabel.setContentDescription(getString(label) + " · " + setLabel);
        }
        if (!options && capture != null) {
            WearHeartCapture local = WearHeartStore.get(this).current();
            long elapsed = local != null && local.token.equals(capture.optString("token")) ? SystemClock.elapsedRealtime() - local.tapElapsed : Math.max(0, System.currentTimeMillis() - capture.optLong("startedAt", System.currentTimeMillis()));
            if (standaloneMode()) elapsed=capture.optLong("elapsedMs")+(capture.optBoolean("paused")?0:Math.max(0,System.currentTimeMillis()-capture.optLong("resumedAt",System.currentTimeMillis())));
            long seconds = Math.max(0, elapsed / 1000); rest.setText(String.format(java.util.Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60)); return;
        }
        if (!options && timer == null) { rest.setText("00:00"); return; }
        if (timer == null) { rest.setText(enabled() ? "" : getString(R.string.disconnected)); return; }
        long left = timer.optBoolean("paused") ? timer.optLong("leftMs") : WearTimer.prefs(this).getLong("endsAt", 0) - System.currentTimeMillis();
        long seconds = Math.max(0, (left + 999) / 1000);
        String label = timer.optBoolean("ready") || seconds == 0 ? getString(R.string.ready) : String.format(java.util.Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60);
        if (rest == pause && !pending.isEmpty()) label = getString(R.string.sending_short);
        if (options && !standaloneMode() && !enabled() && pending.isEmpty()) label += "\n" + getString(R.string.last_timer);
        if (options && !timer.optBoolean("paused") && !timer.optBoolean("ready") && !WearTimer.prefs(this).getBoolean("armed", false) && seconds > 0) label += "\n" + getString(R.string.alarm_unavailable);
        rest.setText(label);
    }
}
