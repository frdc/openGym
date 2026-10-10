package ch.duartesantos.opengym;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;

/** Sensor timestamps are milliseconds since boot, never callback delivery time. */
final class WearHeartCapture {
    String token, packetId = "", endReason = "", contextToken = "", phone = "";
    final long startedAt, tapElapsed;
    long effortEndMs = -1, recoveryEndMs = -1;
    boolean partial;
    boolean awaitingFlush;
    final List<double[]> points = new ArrayList<>();
    WearHeartCapture(String token, long startedAt, long tapElapsed) {
        this.token = token; this.startedAt = startedAt; this.tapElapsed = tapElapsed;
    }
    boolean add(long sensorElapsed, double bpm) {
        long ms = sensorElapsed - tapElapsed;
        if (ms < 0 || (recoveryEndMs >= 0 && ms > recoveryEndMs) || !Double.isFinite(bpm) || bpm < 25 || bpm > 250) return false;
        if (points.stream().anyMatch(p -> p[0] == ms)) return false;
        // Private raw readings retain exact phase summaries and real milestone candidates.
        if (points.size() >= 10000) { partial = true; return false; }
        points.add(new double[] {ms, bpm}); points.sort(Comparator.comparingDouble(p -> p[0])); packetId = ""; return true;
    }
    void complete(long elapsed) {
        if (effortEndMs < 0) { effortEndMs = Math.max(0, elapsed - tapElapsed); packetId = ""; }
    }
    void close(long elapsed, String reason) {
        if (recoveryEndMs >= 0) return;
        long ms = Math.max(0, elapsed - tapElapsed);
        recoveryEndMs = Math.max(ms, effortEndMs); endReason = reason; packetId = "";
        points.removeIf(p -> p[0] > recoveryEndMs);
    }
    boolean canRetire(String id, String status) { return recoveryEndMs >= 0 && !packetId.isEmpty() && packetId.equals(id) && "ok".equals(status); }
    double[] summary(boolean recovery) {
        double sum = 0, peak = 0; int count = 0;
        for (double[] p : points) {
            boolean isRecovery = effortEndMs >= 0 && p[0] > effortEndMs;
            if (isRecovery != recovery) continue;
            count++; sum += p[1]; peak = Math.max(peak, p[1]);
        }
        return count == 0 ? null : new double[] {count, sum / count, peak};
    }
    double[] milestone(int seconds) {
        if (effortEndMs < 0) return null;
        double target = effortEndMs + seconds * 1000L;
        if (recoveryEndMs >= 0 && target > recoveryEndMs) return null;
        double[] closest = null; double distance = 5001;
        for (double[] p : points) {
            if (seconds > 0 && p[0] < effortEndMs) continue;
            double d = Math.abs(p[0] - target);
            if (d <= 5000 && d < distance) { distance = d; closest = p; }
        }
        return closest;
    }
    List<double[]> plot() {
        if (points.size() <= 300) return new ArrayList<>(points);
        TreeSet<Integer> keep = new TreeSet<>(); keep.add(0); keep.add(points.size() - 1);
        int boundary = 0;
        for (int i = 0; i < points.size(); i++) if (points.get(i)[0] <= effortEndMs) boundary = i;
        keep.add(boundary); keep.add(Math.min(points.size() - 1, boundary + 1));
        for (boolean recovery : new boolean[] {false, true}) {
            int min = -1, max = -1, first = -1, last = -1;
            for (int i = 0; i < points.size(); i++) {
                boolean phase = effortEndMs >= 0 && points.get(i)[0] > effortEndMs;
                if (phase != recovery) continue;
                if (first < 0) first = i; last = i;
                if (min < 0 || points.get(i)[1] < points.get(min)[1]) min = i;
                if (max < 0 || points.get(i)[1] > points.get(max)[1]) max = i;
            }
            if (first >= 0) { keep.add(first); keep.add(last); keep.add(min); keep.add(max); }
        }
        for (int seconds : new int[] {0, 30, 60, 120}) { double[] p = milestone(seconds); if (p != null) keep.add(points.indexOf(p)); }
        // Bucket minima/maxima retain short spikes instead of taking every nth sample.
        for (int bucket = 0; bucket < 140; bucket++) {
            int start = bucket * points.size() / 140, end = (bucket + 1) * points.size() / 140;
            int min = start, max = start;
            for (int i = start + 1; i < end; i++) { if (points.get(i)[1] < points.get(min)[1]) min = i; if (points.get(i)[1] > points.get(max)[1]) max = i; }
            keep.add(min); keep.add(max);
        }
        List<double[]> reduced = new ArrayList<>(); for (int i : keep) reduced.add(points.get(i)); return reduced;
    }
}
