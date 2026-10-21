package com.fredc.opengym;

import android.content.Intent;
import android.content.ComponentName;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.view.WindowManager;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearMotionLifecycleTest {
    private LocalSocket connect() throws Exception {
        LocalSocket socket = new LocalSocket();
        socket.connect(new LocalSocketAddress("opengym-motion-v1", LocalSocketAddress.Namespace.ABSTRACT));
        socket.setSoTimeout(2500);
        return socket;
    }

    private BufferedReader lines(LocalSocket socket) throws Exception {
        return new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
    }

    private Object field(WearMotionActivity activity, String name) throws Exception {
        var field = WearMotionActivity.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(activity);
    }

    @Test public void pauseClosesSocketsAndResumeBeginsFreshSessionBeforeAnySamples() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        WearMotionActivity activity = (WearMotionActivity) instrumentation.startActivitySync(new Intent(context, WearMotionActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try (LocalSocket first = connect()) {
            BufferedReader input = lines(first);
            JSONObject hello = new JSONObject(input.readLine());
            assertEquals("hello", hello.getString("type"));
            assertEquals(25, hello.getInt("rateHz"));
            JSONObject sample = new JSONObject(input.readLine());
            assertEquals("sample", sample.getString("type"));
            assertEquals(hello.getString("session"), sample.getString("session"));
            JSONObject next = new JSONObject(input.readLine());
            assertTrue(next.getDouble("tMs") - sample.getDouble("tMs") >= 39);
            assertTrue(next.getLong("seq") > sample.getLong("seq"));
            instrumentation.runOnMainSync(() -> {
                assertTrue((activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0);
                instrumentation.callActivityOnPause(activity);
            });
            assertNull(field(activity, "protocol"));
            assertNull(field(activity, "transport"));
            assertNull(field(activity, "orientationSensor"));
            for (int remaining = 64; input.readLine() != null; remaining--) assertTrue("Pause must end queued samples", remaining > 0);
            instrumentation.runOnMainSync(() -> instrumentation.callActivityOnResume(activity));
            try (LocalSocket resumed = connect()) {
                JSONObject newHello = new JSONObject(lines(resumed).readLine());
                assertEquals("hello", newHello.getString("type"));
                assertNotEquals(hello.getString("session"), newHello.getString("session"));
            }
            instrumentation.runOnMainSync(() -> activity.getWindow().getDecorView().findViewWithTag("motion-stop").performClick());
            instrumentation.waitForIdleSync();
            assertTrue(activity.isFinishing());
            assertNull(field(activity, "protocol"));
        } finally {
            instrumentation.runOnMainSync(activity::finish);
            instrumentation.waitForIdleSync();
        }
    }

    @Test public void adbStopActionAndTimeoutReleaseCaptureWithoutStoppingTheApplication() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        for (boolean timeout : new boolean[]{false, true}) {
            WearMotionActivity activity = (WearMotionActivity) instrumentation.startActivitySync(new Intent(context, WearMotionActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            try {
                assertNotNull(field(activity, "protocol"));
                Runnable expire = (Runnable) field(activity, "sessionTimeout");
                instrumentation.runOnMainSync(() -> {
                    if (timeout) expire.run();
                    else instrumentation.callActivityOnNewIntent(activity, new Intent(WearMotionActivity.ACTION_STOP));
                });
                instrumentation.waitForIdleSync();
                assertTrue(activity.isFinishing());
                assertNull(field(activity, "protocol"));
                assertNull(field(activity, "transport"));
                assertEquals(30 * 60 * 1000L, WearMotionProtocol.SESSION_LIMIT_MS);
            } finally {
                instrumentation.runOnMainSync(activity::finish);
                instrumentation.waitForIdleSync();
            }
        }
    }

    @Test public void stopWhenAlreadyClosedDoesNotStartCaptureAndMotionUsesItsOwnTask() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        var info = context.getPackageManager().getActivityInfo(new ComponentName(context, WearMotionActivity.class), 0);
        assertEquals(context.getPackageName() + ".motion", info.taskAffinity);
        WearMotionActivity activity = (WearMotionActivity) instrumentation.startActivitySync(new Intent(context, WearMotionActivity.class)
            .setAction(WearMotionActivity.ACTION_STOP).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            instrumentation.waitForIdleSync();
            assertTrue(activity.isFinishing());
            assertNull(field(activity, "protocol"));
            assertNull(field(activity, "transport"));
            assertNull(field(activity, "orientationSensor"));
        } finally {
            instrumentation.runOnMainSync(activity::finish);
            instrumentation.waitForIdleSync();
        }
    }
}
