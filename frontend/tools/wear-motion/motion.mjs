// Android rotation vectors use [x, y, z, w]. No position is inferred here.
export const STALE_MS = 1000;
export const MAX_RECORDING_MS = 30 * 60 * 1000;
export const MAX_RECORDING_SAMPLES = 30 * 60 * 25;
export const BASE_ORIENTATION = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

const finiteVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

export function isEmulator(device) {
  return /^emulator-/i.test(device?.serial || '') || /sdk/i.test(device?.model || '');
}

export function normalizeQuaternion(value) {
  if (!finiteVector(value, 4)) return null;
  const norm = Math.hypot(...value);
  return norm > 1e-9 && Number.isFinite(norm) ? value.map(component => component / norm) : null;
}

export function multiplyQuaternion(a, b) {
  const [x, y, z, w] = a;
  const [X, Y, Z, W] = b;
  return [w * X + x * W + y * Z - z * Y, w * Y - x * Z + y * W + z * X, w * Z + x * Y - y * X + z * W, w * W - x * X - y * Y - z * Z];
}

export function rotateVector(quaternion, vector) {
  const q = normalizeQuaternion(quaternion);
  if (!q || !finiteVector(vector, 3)) return null;
  const [x, y, z, w] = q;
  return multiplyQuaternion(multiplyQuaternion(q, [...vector, 0]), [-x, -y, -z, w]).slice(0, 3);
}

export function displayOrientation(quaternion, reference) {
  const q = normalizeQuaternion(quaternion);
  const r = normalizeQuaternion(reference);
  if (!q || !r) return null;
  return normalizeQuaternion(multiplyQuaternion(BASE_ORIENTATION, multiplyQuaternion([-r[0], -r[1], -r[2], r[3]], q)));
}

export function isFresh(sample, now, orientation = false) {
  if (!sample || !Number.isFinite(now) || !Number.isFinite(sample.receivedAt)) return false;
  const age = now - sample.receivedAt;
  if (age < 0 || age > STALE_MS) return false;
  return !orientation || (normalizeQuaternion(sample.q) !== null && Number.isFinite(sample.orientationAgeMs) && sample.orientationAgeMs >= 0 && age + sample.orientationAgeMs <= STALE_MS);
}

export function createMotionState() {
  return { hello: null, latest: null, reference: null, display: null, calibratedAt: null };
}

export function acceptHello(state, hello) {
  if (!hello || typeof hello.session !== 'string' || !hello.session) return state;
  if (state.hello?.session === hello.session) return { ...state, hello };
  return { ...createMotionState(), hello };
}

export function acceptSample(state, sample, now = Date.now()) {
  const invalid = { state, accepted: false };
  if (!state.hello || !sample || sample.session !== state.hello.session) return invalid;
  if (!Number.isSafeInteger(sample.seq) || sample.seq < 0 || !Number.isFinite(sample.tMs) || sample.tMs < 0 || !Number.isFinite(sample.receivedAt) || sample.receivedAt < 0) return invalid;
  if (state.latest && (sample.seq <= state.latest.seq || sample.tMs <= state.latest.tMs)) return invalid;
  if (sample.q !== null && !normalizeQuaternion(sample.q)) return invalid;
  if (!['accel', 'gyro', 'linear'].every(key => sample[key] === null || finiteVector(sample[key], 3))) return invalid;
  if (sample.orientationAgeMs !== null && (!Number.isFinite(sample.orientationAgeMs) || sample.orientationAgeMs < 0)) return invalid;
  const display = state.reference && isFresh(sample, now, true) ? displayOrientation(sample.q, state.reference) : state.display;
  return { state: { ...state, latest: sample, display }, accepted: true };
}

export function calibrate(state, now) {
  if (!isFresh(state.latest, now, true)) return null;
  const reference = normalizeQuaternion(state.latest.q);
  return { ...state, reference, display: displayOrientation(state.latest.q, reference), calibratedAt: now };
}

function event(recording, value) {
  // Calibration clicks and state changes are bounded separately from sensor data.
  if (recording.events.length < 4096) recording.events.push(value);
  else recording.omittedEvents++;
}

export function createRecording(now, hello, reference = null) {
  const recording = {
    format: 'opengym-wear-motion', version: 1, startedAt: now, stoppedAt: null,
    active: true, stopReason: null, maxDurationMs: MAX_RECORDING_MS, maxSamples: MAX_RECORDING_SAMPLES,
    units: { accel: 'm/s²', linear: 'm/s²', gyro: 'rad/s', tMs: 'watch monotonic milliseconds', receivedAt: 'PC Unix milliseconds' },
    coordinateSystem: { quaternion: '[x,y,z,w], watch axes to sensor frame', scene: '+X right, +Y up, -Z forward', display: 'B * inverse(qRef) * q; B = -90 degrees about X', forearm: 'local +Y; illustrative length and fixed elbow; no absolute position' },
    hello: hello ? structuredClone(hello) : null, samples: [], events: [], omittedEvents: 0,
  };
  if (reference) recordCalibration(recording, reference, hello?.session, now);
  return recording;
}

export function stopRecording(recording, now, reason = 'user') {
  if (!recording?.active) return;
  recording.active = false;
  recording.stoppedAt = now;
  recording.stopReason = reason;
  event(recording, { type: 'stop', at: now, reason });
}

export function tickRecording(recording, now) {
  if (recording?.active && now - recording.startedAt >= MAX_RECORDING_MS) stopRecording(recording, now, 'limit');
}

export function recordEvent(recording, type, now, details = {}) {
  if (recording?.active) event(recording, { ...details, type, at: now });
}

export function recordCalibration(recording, reference, session, now) {
  if (recording?.active) event(recording, { type: 'calibration', at: now, session, qRef: [...reference] });
}

export function recordSample(recording, sample, now) {
  if (!recording?.active) return;
  tickRecording(recording, now);
  if (!recording.active) return;
  const previous = recording.samples.at(-1);
  if (previous && previous.session !== sample.session) event(recording, { type: 'session', at: now, session: sample.session });
  else if (previous && (sample.seq > previous.seq + 1 || sample.tMs - previous.tMs > 120)) event(recording, { type: 'gap', at: now, afterSeq: previous.seq, beforeSeq: sample.seq, missing: Math.max(0, sample.seq - previous.seq - 1), elapsedMs: sample.tMs - previous.tMs });
  recording.samples.push(structuredClone(sample));
  if (recording.samples.length >= MAX_RECORDING_SAMPLES) stopRecording(recording, now, 'limit');
}
