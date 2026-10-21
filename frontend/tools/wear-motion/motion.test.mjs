import test from 'node:test';
import assert from 'node:assert/strict';
import * as motion from './motion.mjs';

const H = Math.SQRT1_2;
const hello = (session = 'session-a') => ({ v: 1, type: 'hello', session, model: 'Watch', orientation: 'game_rotation_vector', sensors: { orientation: true, accel: true, gyro: true, linear: false }, rateHz: 25 });
const sample = (overrides = {}) => ({ v: 1, type: 'sample', session: 'session-a', seq: 1, tMs: 40, receivedAt: 1000, q: [0, 0, 0, 1], accel: [0, 0, 9.81], gyro: [0, 0, 0], linear: null, accuracy: 3, orientationAgeMs: 0, ...overrides });
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10, `${actual} != ${expected}`));
};
const ready = () => motion.acceptSample(motion.acceptHello(motion.createMotionState(), hello()), sample()).state;

test('emulated devices are explicit without labeling physical watches as emulators', () => {
  assert.equal(motion.isEmulator({ serial: 'emulator-5554', model: 'Wear OS' }), true);
  assert.equal(motion.isEmulator({ serial: 'local', model: 'sdk_gwear_x86_64' }), true);
  assert.equal(motion.isEmulator({ model: 'Android SDK built for x86' }), true);
  assert.equal(motion.isEmulator({ serial: 'R7ABC', model: 'Galaxy Watch7' }), false);
  assert.equal(motion.isEmulator(null), false);
});

test('known quarter turns map basis vectors with Android xyzw convention', () => {
  close(motion.rotateVector([0, 0, H, H], [1, 0, 0]), [0, 1, 0]);
  close(motion.rotateVector([H, 0, 0, H], [0, 1, 0]), [0, 0, 1]);
  close(motion.rotateVector([0, H, 0, H], [0, 0, 1]), [1, 0, 0]);
});

test('normalization rejects malformed and degenerate quaternions', () => {
  for (const value of [null, [], [0, 0, 0, 0], [0, 0, 1], [Infinity, 0, 0, 1], ['0', 0, 0, 1], [NaN, 0, 0, 1]]) assert.equal(motion.normalizeQuaternion(value), null);
  close(motion.normalizeQuaternion([0, 0, 0, 2]), [0, 0, 0, 1]);
});

test('calibration sends local forearm Y forward and watch face Z up', () => {
  const q = motion.displayOrientation([0, 0, H, H], [0, 0, H, H]);
  close(motion.rotateVector(q, [0, 1, 0]), [0, 0, -1]);
  close(motion.rotateVector(q, [0, 0, 1]), [0, 1, 0]);
});

test('relative rotation composes reference inverse before base rotation', () => {
  // qRef = +90° Z, q = qRef × +90° X. The local +Y arm becomes scene +Y.
  const q = motion.displayOrientation([0.5, 0.5, 0.5, 0.5], [0, 0, H, H]);
  close(motion.rotateVector(q, [0, 1, 0]), [0, 1, 0]);
  close(motion.rotateVector(q, [0, 0, 1]), [0, 0, 1]);
});

test('opposite quaternion signs describe the same physical pose', () => {
  close(motion.rotateVector(motion.displayOrientation([0, 0, -H, -H], [0, 0, H, H]), [0, 1, 0]), [0, 0, -1]);
});

test('calibration requires fresh received data and fresh orientation sensor', () => {
  assert.equal(motion.calibrate(ready(), 2001), null);
  const staleOrientation = motion.acceptSample(motion.acceptHello(motion.createMotionState(), hello()), sample({ orientationAgeMs: 1001 })).state;
  assert.equal(motion.calibrate(staleOrientation, 1000), null);
  assert.equal(motion.isFresh(sample({ receivedAt: NaN }), 1000), false);
  assert.equal(motion.isFresh(sample({ receivedAt: 2000 }), 1000), false);
  const calibrated = motion.calibrate(ready(), 1200);
  close(calibrated.reference, [0, 0, 0, 1]);
  close(motion.rotateVector(calibrated.display, [0, 1, 0]), [0, 0, -1]);
});

test('only samples after hello from the active session are accepted', () => {
  assert.equal(motion.acceptSample(motion.createMotionState(), sample()).accepted, false);
  assert.equal(motion.acceptSample(ready(), sample({ session: 'other', seq: 2 })).accepted, false);
});

test('new sessions clear calibration, previous timestamps and pose', () => {
  const calibrated = motion.calibrate(ready(), 1000);
  const next = motion.acceptHello(calibrated, hello('session-b'));
  assert.equal(next.reference, null);
  assert.equal(next.latest, null);
  assert.equal(next.display, null);
  assert.equal(motion.acceptSample(next, sample({ session: 'session-b', seq: 0, tMs: 0 })).accepted, true);
  assert.equal(motion.acceptHello(calibrated, hello()).reference, calibrated.reference);
});

test('duplicates, backwards timestamps and non-finite samples are rejected', () => {
  for (const value of [sample(), sample({ seq: 2, tMs: 39 }), sample({ seq: 2, tMs: NaN }), sample({ seq: 2, tMs: 80, accel: [0, Infinity, 0] }), sample({ seq: 2, tMs: 80, q: [0, 0, 0, 0] })]) assert.equal(motion.acceptSample(ready(), value).accepted, false);
});

test('missing sensors stay null while valid acceleration remains available', () => {
  const { state, accepted } = motion.acceptSample(motion.acceptHello(motion.createMotionState(), hello()), sample({ q: null, gyro: null, linear: null, orientationAgeMs: null }));
  assert.equal(accepted, true);
  assert.equal(state.latest.gyro, null);
  assert.equal(state.latest.q, null);
  assert.equal(state.display, null);
  assert.equal(motion.calibrate(state, 1000), null);
  assert.deepEqual(state.latest.accel, [0, 0, 9.81]);
});

test('old orientation freezes the last measured display pose', () => {
  const calibrated = motion.calibrate(ready(), 1000);
  const next = motion.acceptSample(calibrated, sample({ seq: 2, tMs: 80, receivedAt: 1040, q: [H, 0, 0, H], orientationAgeMs: 1001 })).state;
  assert.equal(next.display, calibrated.display);
});

test('late delivery freezes the calibrated pose even with a recent sensor quaternion', () => {
  const calibrated = motion.calibrate(ready(), 1000);
  const next = motion.acceptSample(calibrated, sample({ seq: 2, tMs: 80, receivedAt: 1040, q: [H, 0, 0, H] }), 2041).state;
  assert.equal(next.display, calibrated.display);
});

test('a fresh quarter turn after calibration raises the forearm', () => {
  const calibrated = motion.calibrate(ready(), 1000);
  const next = motion.acceptSample(calibrated, sample({ seq: 2, tMs: 80, receivedAt: 1040, q: [H, 0, 0, H] }), 1040).state;
  close(motion.rotateVector(next.display, [0, 1, 0]), [0, 1, 0]);
});

test('recording keeps raw missing channels, calibration and sequence gaps', () => {
  const recording = motion.createRecording(1000, hello(), [0, 0, 0, 1]);
  motion.recordSample(recording, sample(), 1000);
  motion.recordSample(recording, sample({ seq: 4, tMs: 160, receivedAt: 1120 }), 1120);
  motion.recordCalibration(recording, [0, 0, H, H], 'session-a', 1120);
  motion.stopRecording(recording, 1200, 'disconnected');
  assert.equal(recording.samples.length, 2);
  assert.equal(recording.samples[0].linear, null);
  assert.ok(recording.events.some(event => event.type === 'gap' && event.missing === 2));
  assert.equal(recording.events.filter(event => event.type === 'calibration').length, 2);
  assert.equal(recording.stopReason, 'disconnected');
  motion.recordSample(recording, sample({ seq: 5, tMs: 200 }), 1200);
  assert.equal(recording.samples.length, 2);
});

test('recording stops at duration limit even without incoming samples', () => {
  const recording = motion.createRecording(1000, hello());
  motion.tickRecording(recording, 1000 + 30 * 60 * 1000);
  assert.equal(recording.active, false);
  assert.equal(recording.stopReason, 'limit');
});

test('recording caps samples to 30 minutes at 25Hz and retains export', () => {
  const recording = motion.createRecording(1000, hello());
  for (let seq = 0; seq < 45001; seq++) motion.recordSample(recording, sample({ seq, tMs: seq * 40 }), 1000);
  assert.equal(recording.samples.length, 45000);
  assert.equal(recording.active, false);
  assert.equal(recording.stopReason, 'limit');
});
