package com.fredc.opengym;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WearMotionProtocolTest {
    private WearMotionProtocol session(String orientation, boolean accel, boolean gyro, boolean linear) {
        return new WearMotionProtocol("Watch \"one\"\n", orientation, accel, gyro, linear);
    }

    @Test public void helloDeclaresOnlyRegisteredSensorsAndEachSessionHasItsOwnUuid() throws Exception {
        var first = session("rotation_vector", true, false, true);
        JSONObject hello = new JSONObject(first.hello());
        assertEquals(1, hello.getInt("v"));
        assertEquals("hello", hello.getString("type"));
        assertEquals("Watch \"one\"\n", hello.getString("model"));
        assertEquals("rotation_vector", hello.getString("orientation"));
        assertEquals(25, hello.getInt("rateHz"));
        assertEquals(hello.getString("session"), UUID.fromString(hello.getString("session")).toString());
        assertNotEquals(hello.getString("session"), new JSONObject(session("rotation_vector", true, false, true).hello()).getString("session"));
        JSONObject sensors = hello.getJSONObject("sensors");
        assertTrue(sensors.getBoolean("orientation"));
        assertTrue(sensors.getBoolean("accel"));
        assertFalse(sensors.getBoolean("gyro"));
        assertTrue(sensors.getBoolean("linear"));
        assertEquals(1, first.hello().chars().filter(c -> c == '\n').count());
    }

    @Test public void samplesNeverInventReadingsBeforeSensorEventsArrive() throws Exception {
        var session = session("game_rotation_vector", true, true, true);
        JSONObject sample = new JSONObject(session.sample(2_000_000_000L));
        assertEquals("sample", sample.getString("type"));
        assertEquals(new JSONObject(session.hello()).getString("session"), sample.getString("session"));
        for (String name : new String[]{"q", "accel", "gyro", "linear", "orientationAgeMs"}) assertTrue(name, sample.isNull(name));
        assertEquals(0, sample.getInt("accuracy"));
        assertEquals(2000, sample.getDouble("tMs"), 0.0001);
    }

    @Test public void rotationVectorIsNormalizedXyzwWithMeasuredAgeAndAccuracy() throws Exception {
        var session = session("game_rotation_vector", true, false, false);
        session.rotation(new float[]{0, 0, 2, 2, -1}, 1_000_000_000L, 3);
        JSONObject sample = new JSONObject(session.sample(1_125_000_000L));
        JSONArray q = sample.getJSONArray("q");
        assertEquals(4, q.length());
        assertEquals(0, q.getDouble(0), 0);
        assertEquals(0, q.getDouble(1), 0);
        assertEquals(Math.sqrt(0.5), q.getDouble(2), 0.000001);
        assertEquals(Math.sqrt(0.5), q.getDouble(3), 0.000001);
        assertEquals(125, sample.getDouble("orientationAgeMs"), 0);
        assertEquals(3, sample.getInt("accuracy"));
    }

    @Test public void threeElementRotationVectorReconstructsScalarAndKeepsOldReadingAge() throws Exception {
        var session = session("rotation_vector", false, false, false);
        session.rotation(new float[]{0, 0.6f, 0}, 2_000_000L, 2);
        JSONObject sample = new JSONObject(session.sample(2_002_000_000L));
        assertEquals(0.8, sample.getJSONArray("q").getDouble(3), 0.000001);
        assertEquals(2000, sample.getDouble("orientationAgeMs"), 0);
    }

    @Test public void invalidOrientationClearsPreviousReadingInsteadOfReplayingIt() throws Exception {
        var session = session("game_rotation_vector", false, false, false);
        for (float[] invalid : new float[][]{null, {}, {1, 2}, {0, 0, 0, 0}, {Float.NaN, 0, 0, 1}, {0, Float.POSITIVE_INFINITY, 0, 1}}) {
            session.rotation(new float[]{0, 0, 0, 1}, 1_000_000L, 3);
            session.rotation(invalid, 2_000_000L, 3);
            JSONObject sample = new JSONObject(session.sample(40_000_000L));
            assertTrue(sample.isNull("q"));
            assertTrue(sample.isNull("orientationAgeMs"));
            assertEquals(0, sample.getInt("accuracy"));
        }
    }

    @Test public void vectorsAreCopiedFiniteAndExactlyThreeElementsWithUnavailableChannelsNull() throws Exception {
        var session = session("unavailable", true, false, true);
        float[] accel = {1, 2, 9.81f, 99};
        session.accel(accel, 0);
        accel[0] = 88;
        session.gyro(new float[]{4, 5, 6}, 0);
        session.linear(new float[]{0, -1, 2}, 0);
        session.rotation(new float[]{0, 0, 0, 1}, 0, 3);
        JSONObject sample = new JSONObject(session.sample(0));
        assertEquals(3, sample.getJSONArray("accel").length());
        assertEquals(1, sample.getJSONArray("accel").getDouble(0), 0);
        assertEquals(-1, sample.getJSONArray("linear").getDouble(1), 0);
        assertTrue(sample.isNull("gyro"));
        assertTrue(sample.isNull("q"));
        assertFalse(new JSONObject(session.hello()).getJSONObject("sensors").getBoolean("orientation"));
        for (float[] invalid : new float[][]{null, {1}, {0, Float.NaN, 0}, {Float.NEGATIVE_INFINITY, 0, 0}}) {
            session.accel(invalid, 0);
            assertTrue(new JSONObject(session.sample(40_000_000L)).isNull("accel"));
        }
    }

    @Test public void sequenceIncreasesAndWireLinesStayWithinLimitEvenWithLongModelNames() throws Exception {
        var session = new WearMotionProtocol("😀".repeat(9000), "rotation_vector", true, true, true);
        session.rotation(new float[]{1, 2, 3, 4}, 0, -1);
        JSONObject first = new JSONObject(session.sample(1_000_000L));
        String nextLine = session.sample(41_000_000L);
        JSONObject next = new JSONObject(nextLine);
        assertEquals(first.getLong("seq") + 1, next.getLong("seq"));
        assertEquals(0, next.getInt("accuracy"));
        assertEquals(128, new JSONObject(session.hello()).getString("model").length());
        assertTrue(session.hello().getBytes(StandardCharsets.UTF_8).length <= 8192);
        assertTrue(nextLine.getBytes(StandardCharsets.UTF_8).length <= 8192);
        assertTrue(nextLine.endsWith("\n"));
    }

    @Test public void channelsExpireIndependentlyWhileOtherSensorsKeepUpdating() throws Exception {
        var session = session("rotation_vector", true, true, true);
        session.rotation(new float[]{0, 0, 0, 1}, 0, 3);
        session.accel(new float[]{1, 2, 3}, 0);
        session.gyro(new float[]{4, 5, 6}, 0);
        session.linear(new float[]{7, 8, 9}, 0);
        JSONObject boundary = new JSONObject(session.sample(1_000_000_000L));
        for (String name : new String[]{"accel", "gyro", "linear"}) assertFalse(name, boundary.isNull(name));

        session.gyro(new float[]{10, 11, 12}, 1_040_000_000L);
        JSONObject afterAccelAndLinearStop = new JSONObject(session.sample(1_040_000_000L));
        assertTrue(afterAccelAndLinearStop.isNull("accel"));
        assertTrue(afterAccelAndLinearStop.isNull("linear"));
        assertEquals(10, afterAccelAndLinearStop.getJSONArray("gyro").getDouble(0), 0);
        assertEquals(1040, afterAccelAndLinearStop.getDouble("tMs"), 0);
        assertEquals(1040, afterAccelAndLinearStop.getDouble("orientationAgeMs"), 0);
        assertFalse(afterAccelAndLinearStop.isNull("q"));

        session.accel(new float[]{13, 14, 15}, 2_080_000_000L);
        session.linear(new float[]{16, 17, 18}, 2_080_000_000L);
        JSONObject afterGyroStops = new JSONObject(session.sample(2_080_000_000L));
        assertTrue(afterGyroStops.isNull("gyro"));
        assertEquals(13, afterGyroStops.getJSONArray("accel").getDouble(0), 0);
        assertEquals(16, afterGyroStops.getJSONArray("linear").getDouble(0), 0);
    }

    @Test public void peerPolicyAllowsOnlyAdbAndThisApplication() {
        assertTrue(WearMotionProtocol.allowedPeer(0, 10345));
        assertTrue(WearMotionProtocol.allowedPeer(2000, 10345));
        assertTrue(WearMotionProtocol.allowedPeer(10345, 10345));
        assertFalse(WearMotionProtocol.allowedPeer(10346, 10345));
        assertFalse(WearMotionProtocol.allowedPeer(-1, 10345));
    }
}
