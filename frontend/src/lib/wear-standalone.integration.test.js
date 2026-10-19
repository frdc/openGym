// @vitest-environment happy-dom
// Real owner store, persistence and UI timer; only the native transport/alarm boundary is fake.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ fixture: null, command: null }))
const plugin = vi.hoisted(() => ({
  publish: vi.fn().mockResolvedValue(), reply: vi.fn().mockResolvedValue(), clear: vi.fn().mockResolvedValue(),
  getHeartBindings: vi.fn().mockResolvedValue({ bindings: {} }), saveHeartBindings: vi.fn().mockResolvedValue(),
  addListener: vi.fn(),
}))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  runtime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: runtime.fixture.useStore }
})
vi.mock('./mobile.js', async original => ({ ...await original(), MOBILE: true, isAndroid: async () => true }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }))
vi.mock('./rest-alert.js', () => ({ armRestAlert: vi.fn().mockResolvedValue(true), holdRestAlert: vi.fn(), disarmRestAlert: vi.fn(), bindNativeRest: vi.fn() }))
vi.mock('./sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
import { useStore, createWorkoutStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindWearBridge } from './wear-bridge.js'
import { fakeStorage } from './cloud/test-fixtures.js'

let stop
const latest = () => plugin.publish.mock.calls.at(-1)?.[0]?.state
const event = (seq, action, at, step = 0) => ({ seq, id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, action, at, step })
const packet = (state, events) => ({ v: 1, action: 'standalone-sync', requestId: events.at(-1).id, contextToken: state.contextToken, streamId: 'real-store-stream', baseline: state.standalone.baseline, events })
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
beforeEach(async () => {
  vi.clearAllMocks()
  plugin.addListener.mockImplementation(async (name, handler) => { if (name === 'command') runtime.command = handler; return { remove: vi.fn() } })
  runtime.fixture.begin()
  await runtime.fixture.prepare({ restSec: 90, active: { id: 'integration', start: Date.now(), cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ r: 10, w: 60, done: false }, { r: 10, w: 60, done: false }] }] } })
  useUI.setState({ timer: null, work: null, sheets: [] })
  stop = bindWearBridge()
  await vi.waitFor(() => expect(latest()?.standalone).toBeTruthy())
})
afterEach(async () => { stop?.(); useUI.getState().stopRest(); await runtime.fixture.close() })

it('persists first start and completion through the real UI, then replays without restarting rest', async () => {
  const initial = latest(), at = Date.now() - 15000
  const started = event(1, 'start', at - 1000)
  await runtime.command({ nodeId: 'watch', command: packet(initial, [started]) })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 1 })
  expect(useUI.getState().timer).toBeNull()
  const completed = event(2, 'complete', at)
  const completion = packet(initial, [completed])
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ done: true, at })
  const deadline = at + 90000
  expect(useUI.getState().timer).toMatchObject({ timerToken: completed.id, endsAt: deadline, forIdx: 0, forSet: 0 })
  expect(useUI.getState().timer.left).toBeGreaterThan(70)
  expect(useUI.getState().timer.left).toBeLessThanOrEqual(75)
  stop(); stop = bindWearBridge(); await settle()
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(useUI.getState().timer.endsAt).toBe(deadline)
  expect(useStore.getState().S.active._wearStandalone.events).toHaveLength(2)
  // Recreate the phone store from its committed archive, with a fresh bridge and UI timer.
  await runtime.fixture.flush()
  const archive = await runtime.fixture.saved()
  stop(); useUI.getState().stopRest()
  const reopened = createWorkoutStore({ projectId: 'demo-opengym', config: {}, client: null, remote: null,
    storage: fakeStorage({ [archive.ownerKey]: archive }), authFactory: () => ({ ready: Promise.resolve(null), stop() {} }),
    legacyReader: { read: async () => [] }, lifecycle: false })
  await runtime.fixture.attach(reopened); await reopened.getState().boot()
  stop = bindWearBridge(); await settle()
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(useStore.getState().S.active._wearStandalone.events).toHaveLength(2)
  expect(useUI.getState().timer?.endsAt).toBe(deadline)
})

it('publishes a phone rest and accepts its offline pause into the real persisted workout', async () => {
  useUI.getState().startRest(90, 0, { forSet: 0 })
  const phoneToken = useUI.getState().timer.timerToken
  await vi.waitFor(() => expect(latest()?.standalone?.runtime?.timer?.timerToken).toBe(phoneToken))
  const snapshot = latest()
  await runtime.command({ nodeId: 'watch', command: packet(snapshot, [event(1, 'pause', Date.now())]) })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 1 })
  expect(useUI.getState().timer).toMatchObject({ timerToken: phoneToken, paused: true })
  expect(useStore.getState().S.active._wearStandalone.runtime.timer.paused).toBe(true)
  useUI.getState().resumeRest()
  await vi.waitFor(() => expect(latest().standalone.runtime.timer.paused).toBe(false))
  useUI.getState().stopRest()
  await vi.waitFor(() => expect(latest().standalone.runtime.timer).toBeNull())
})
