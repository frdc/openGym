package com.fredc.opengym;

import android.app.NotificationManager;
import android.content.Intent;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class WearPhoneBackgroundTest {
    private String shell(String command) throws Exception {
        try (ParcelFileDescriptor fd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
             var stream = new FileInputStream(fd.getFileDescriptor())) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
    private String js(WebView web, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("JavaScript responds while phone screen is off", done.await(10, TimeUnit.SECONDS)); return value.get();
    }
    private boolean requestIsHeld() throws Exception {
        String dump = shell("dumpsys power");
        int start = dump.indexOf("Wake Locks: size=");
        int end = dump.indexOf("Suspend Blockers:", start);
        assertTrue("Power dump includes the active wake-lock section", start >= 0 && end > start);
        return dump.substring(start, end).contains("opengym:wear-request");
    }
    private void awaitJs(WebView web, String expression, String expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (expected.equals(js(web, expression))) return;
            SystemClock.sleep(100);
        }
        assertEquals(expected, js(web, expression));
    }
    @Test public void screenOffRequestHoldsCpuUntilNativeReplyFinishes() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        shell("input keyevent 224"); shell("wm dismiss-keyguard");
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            WebView web = activity.getBridge().getWebView();
            awaitJs(web, "!!window.Capacitor?.Plugins?.WearBridge", "true");
            js(web, "window.wearTestReady=false; Capacitor.Plugins.WearBridge.removeAllListeners().then(()=>Capacitor.Plugins.WearBridge.addListener('command', e => {window.wearTestReceived=e.command.requestId})).then(()=>window.wearTestReady=true)");
            awaitJs(web, "window.wearTestReady", "true");
            shell("input keyevent 223"); SystemClock.sleep(300);
            assertTrue(WearBridgePlugin.deliver("test-node", new JSONObject().put("v", 1).put("requestId", "screen-off"), null));
            assertTrue("Asynchronous command owns a bounded CPU wake lock", requestIsHeld());
            awaitJs(web, "window.wearTestReceived", "\"screen-off\"");
            js(web, "Capacitor.Plugins.WearBridge.reply({nodeId:'test-node',response:{v:1,requestId:'screen-off',status:'error'}}).catch(()=>{})");
            long deadline = SystemClock.elapsedRealtime() + 10000;
            while (requestIsHeld() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            assertFalse("Reply failure also releases CPU", requestIsHeld());
        } finally { shell("input keyevent 224"); shell("wm dismiss-keyguard"); instrumentation.runOnMainSync(activity::finish); }
    }
    @Test public void activeWorkoutKeepsProcessForegroundAndStopsWhenCleared() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        shell("input keyevent 224"); shell("wm dismiss-keyguard");
        // This is a native service fixture, independent of the empty workout published
        // during real app startup. Give only this test permission to start it in background.
        instrumentation.getUiAutomation().adoptShellPermissionIdentity("android.permission.START_FOREGROUND_SERVICES_FROM_BACKGROUND");
        try {
            instrumentation.runOnMainSync(() -> WearWorkoutService.update(context, true));
            var manager = context.getSystemService(NotificationManager.class);
            long deadline = SystemClock.elapsedRealtime() + 10000;
            while (!hasWorkout(manager) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            assertTrue("Active workout has an ongoing foreground notification", hasWorkout(manager));
            instrumentation.runOnMainSync(() -> {
                WearWorkoutService.update(context, false);
                WearWorkoutService.update(context, true);
            });
            SystemClock.sleep(500);
            assertTrue("Replacing a stopping service preserves the new workout", hasWorkout(manager));
            shell("input keyevent 223");
            assertTrue(shell("dumpsys activity services " + context.getPackageName()).contains("WearWorkoutService"));
            instrumentation.runOnMainSync(() -> WearWorkoutService.update(context, false));
            deadline = SystemClock.elapsedRealtime() + 10000;
            while (hasWorkout(manager) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            assertFalse("Finishing clears workout foreground protection", hasWorkout(manager));
        } finally {
            instrumentation.runOnMainSync(() -> WearWorkoutService.update(context, false));
            instrumentation.getUiAutomation().dropShellPermissionIdentity();
            shell("input keyevent 224"); shell("wm dismiss-keyguard");
        }
    }
    private boolean hasWorkout(NotificationManager manager) {
        for (var notification : manager.getActiveNotifications()) if ("wear-workout".equals(notification.getNotification().getChannelId())) return true;
        return false;
    }
}
