package ch.duartesantos.opengym;

import org.junit.Test;
import static org.junit.Assert.*;

public class WearHeartCaptureTest {
    @Test public void sensorTimeUsesMonotonicTapNotDeliveryTime() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        assertFalse(c.add(4999, 80));
        assertTrue(c.add(6000, 90));
        assertEquals(1000, c.points.get(0)[0], 0);
        assertFalse(c.add(7000, Double.NaN));
    }
    @Test public void effortAndRecoveryBoundaryRejectsLateSamplesBeyondClosure() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        c.complete(7000); c.close(9000, "next-set");
        assertTrue(c.add(8000, 100));
        assertFalse(c.add(9001, 100));
        assertEquals(2000, c.effortEndMs);
        assertEquals(4000, c.recoveryEndMs);
    }
    @Test public void finalAcknowledgmentDoesNotAcceptOlderIncrementalReceipt() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        c.packetId = "incremental";
        c.close(9000, "disabled"); c.packetId = "final";
        assertFalse(c.canRetire("incremental", "ok"));
        assertFalse(c.canRetire("final", "rejected"));
        assertTrue(c.canRetire("final", "ok"));
    }
    @Test public void collectionContinuesBeyondGraphLimitAndKeepsAllSampleSummary() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        for (int i = 0; i < 600; i++) assertTrue(c.add(5000 + i, i == 450 ? 190 : 100));
        c.complete(5600);
        assertEquals(600, c.summary(false)[0], 0);
        assertEquals(190, c.summary(false)[2], 0);
        assertTrue(c.plot().size() <= 300);
        assertEquals(0, c.plot().get(0)[0], 0);
        assertEquals(599, c.plot().get(c.plot().size() - 1)[0], 0);
        assertTrue(c.plot().stream().anyMatch(p -> p[1] == 190));
    }
    @Test public void lateBatchIsClassifiedBySensorTimeAndMilestonesNeverInventValues() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        c.complete(15000);
        c.add(14900, 150); c.add(45100, 110); c.add(70000, 100);
        assertEquals(1, c.summary(false)[0], 0);
        assertEquals(2, c.summary(true)[0], 0);
        assertEquals(40100, c.milestone(30)[0], 0);
        assertNull(c.milestone(120));
    }
    @Test public void reducerPreservesEachPhasePeakWhenBucketCrossesBoundary() {
        WearHeartCapture c = new WearHeartCapture("t", 100000, 5000);
        for (int i = 0; i < 1000; i++) c.add(5000 + i, i == 501 ? 160 : i == 502 ? 180 : 100);
        c.complete(5501);
        assertTrue(c.plot().stream().anyMatch(p -> p[0] == 501 && p[1] == 160));
        assertTrue(c.plot().stream().anyMatch(p -> p[0] == 502 && p[1] == 180));
        assertTrue(c.plot().size() <= 300);
    }
}
