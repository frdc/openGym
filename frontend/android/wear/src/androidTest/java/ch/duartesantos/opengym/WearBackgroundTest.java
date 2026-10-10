package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.VibrationAttributes;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearBackgroundTest {
    static final int TEST_ID = 440;
    private boolean present(NotificationManager manager) { return java.util.Arrays.stream(manager.getActiveNotifications()).anyMatch(n -> n.getId() == TEST_ID); }
    private void awaitPresence(NotificationManager manager, boolean expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 2000;
        while (present(manager) != expected && SystemClock.elapsedRealtime() < deadline) Thread.sleep(50);
        assertEquals(expected, present(manager));
    }
    @Test public void backgroundAlarmHasAlarmUsageAndCanActuallyVibrate() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(VibrationAttributes.USAGE_ALARM, WearHaptics.attributes().getUsage());
        WearHaptics.alarm(context);
        Thread.sleep(800);
    }
    @Test public void workoutNotificationIsOngoingAndItsUpdatesAreSilent() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        try {
            JSONObject state = new JSONObject(); state.put("active", true); state.put("current", new JSONObject().put("name", "OpenGym test").put("setLabel", "1/3"));
            WearOngoing.update(context, state, TEST_ID);
            awaitPresence(manager, true);
            var notification = java.util.Arrays.stream(manager.getActiveNotifications()).filter(n -> n.getId() == TEST_ID).findFirst().orElseThrow().getNotification();
            assertTrue((notification.flags & Notification.FLAG_ONGOING_EVENT) != 0);
            assertTrue((notification.flags & Notification.FLAG_ONLY_ALERT_ONCE) != 0);
            assertFalse(manager.getNotificationChannel(notification.getChannelId()).shouldVibrate());
            assertNull(manager.getNotificationChannel(notification.getChannelId()).getSound());
            state.put("active", false); WearOngoing.update(context, state, TEST_ID);
            awaitPresence(manager, false);
        } finally { manager.cancel(TEST_ID); }
    }
}
