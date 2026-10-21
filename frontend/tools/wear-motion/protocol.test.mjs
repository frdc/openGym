import test from 'node:test'
import assert from 'node:assert/strict'
import { MotionDecoder } from './protocol.mjs'

const hello = { v: 1, type: 'hello', session: 'session-1', model: 'SM-L705F', orientation: 'game_rotation_vector', sensors: { orientation: true, accel: true, gyro: true, linear: false }, rateHz: 25 }
const sample = { v: 1, type: 'sample', session: 'session-1', seq: 1, tMs: 100, q: [0, 0, 0, 1], accel: [0, 0, 9.8], gyro: [0, 0, 0], linear: null, accuracy: 3, orientationAgeMs: 1 }
const line = value => JSON.stringify(value) + '\n'

test('decodes fragmented lines and retains absent optional channels as null', () => {
  const decoder = new MotionDecoder()
  assert.deepEqual(decoder.push(line(hello).slice(0, 30)), [])
  assert.deepEqual(decoder.push(line(hello).slice(30) + line(sample)), [hello, sample])
})
test('requires a hello and rejects samples from another session or out of order', () => {
  assert.throws(() => new MotionDecoder().push(line(sample)), /hello/)
  for (const bad of [{ ...sample, session: 'another' }, sample, { ...sample, seq: 2, tMs: 90 }]) {
    const decoder = new MotionDecoder(); decoder.push(line(hello) + line(sample))
    assert.throws(() => decoder.push(line(bad)), /session|order/)
  }
})
test('rejects malformed/oversized input and invalid sensor vectors', () => {
  assert.throws(() => new MotionDecoder().push('x'.repeat(8193)), /large/)
  assert.throws(() => new MotionDecoder().push('{oops}\n'), /JSON/)
  for (const bad of [{ ...sample, q: [0, 0, 0, 0] }, { ...sample, gyro: [1, 2] }, { ...sample, accel: [1, '2', 3] }, { ...sample, orientationAgeMs: -1 }]) {
    const decoder = new MotionDecoder(); decoder.push(line(hello))
    assert.throws(() => decoder.push(line(bad)), /Invalid/)
  }
})
test('missing orientation remains null rather than synthesizing a pose', () => {
  const decoder = new MotionDecoder()
  const missing = { ...sample, q: null, orientationAgeMs: null }
  assert.deepEqual(decoder.push(line(hello) + line(missing))[1], missing)
})

test('accepts the native model limit and rejects larger names', () => {
  const accepted = { ...hello, model: 'm'.repeat(128) }
  assert.deepEqual(new MotionDecoder().push(line(accepted)), [accepted])
  assert.throws(() => new MotionDecoder().push(line({ ...hello, model: 'm'.repeat(129) })), /Invalid/)
})
