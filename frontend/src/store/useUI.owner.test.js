// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useStore, createWorkoutStore } from './useStore.js'
import { useUI, restoreWork, restoreRest, WORK_KEY, REST_KEY } from './useUI.js'
const holder = vi.hoisted(() => ({ fixture: null, native: null }))
vi.mock('./useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('./ui-test-runtime.js')
  holder.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: holder.fixture.useStore }
})
vi.mock('../lib/rest-alert.js', () => ({ armRestAlert: vi.fn(async () => true), bindNativeRest: cb => { holder.native = cb }, disarmRestAlert: vi.fn(), holdRestAlert: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
const active = () => ({ id: 'reused', entries: [{ id: 'plank', sets: [{ sec: 45 }] }] })
const owner = { idx: 0, i: 0, id: 'plank' }
const scope = () => { const s = useStore.getState(); return { ownerKey: s.ownerKey, localReady: s.localReady, activeSessionToken: s.activeSessionToken } }
beforeEach(async () => { localStorage.clear(); await holder.fixture.prepare({ active: active() }); vi.useFakeTimers() })
afterEach(async () => { useUI.getState().stopWork(); useUI.getState().stopRest(); vi.useRealTimers(); await holder.fixture.close() })
it.each(['finishWorkEarly', 'abandonWork'])('rejects %s after replacement of an identical historical draft', action => {
  const done = vi.fn()
  useUI.getState().startWork(45, 'Plank', done, owner)
  vi.advanceTimersByTime(10000)
  useStore.getState().replaceState({ ...useStore.getState().S, active: active() })
  useUI.getState()[action]()
  expect(done).not.toHaveBeenCalled()
  expect(useStore.getState().S.active.entries[0].sets[0]).toEqual({ sec: 45 })
  expect(useUI.getState().work).toBeNull()
})
it('persists authoritative context and rejects same-row scoped work from another draft', () => {
  useUI.getState().startWork(45, 'Plank', null, owner)
  const saved = JSON.parse(localStorage.getItem(WORK_KEY))
  expect(saved.context).toEqual(scope())
  useUI.getState().stopWork()
  useStore.getState().replaceState({ ...useStore.getState().S, active: active() })
  localStorage.setItem(WORK_KEY, JSON.stringify(saved))
  expect(restoreWork()).toBe(false)
  vi.advanceTimersByTime(50000)
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBeUndefined()
})
it('retains unscoped legacy timers without attributing them to the current draft', () => {
  const saved = JSON.stringify({ endsAt: Date.now() + 10000, total: 45, owner })
  localStorage.setItem(WORK_KEY, saved)
  localStorage.setItem(REST_KEY, saved)
  expect(restoreWork()).toBe(false)
  expect(restoreRest()).toBe(false)
  expect(localStorage.getItem(WORK_KEY)).toBe(saved)
  expect(localStorage.getItem(REST_KEY)).toBe(saved)
})
it('does not synthesize a rest from late native events or mutate a replacement timer', () => {
  holder.native({ type: 'pause', leftMs: 5000, totalMs: 90000, paused: true })
  expect(useUI.getState().timer).toBeNull()
  useUI.getState().startRest(90, 0)
  const old = useUI.getState().timer
  useStore.getState().replaceState({ ...useStore.getState().S, active: active() })
  useUI.getState().startRest(60, 0)
  const next = useUI.getState().timer
  holder.native({ type: 'skip', timerToken: old.timerToken })
  expect(useUI.getState().timer).toBe(next)
})

it('retains the original timer if archiving displaced data hits storage quota', () => {
  useUI.getState().startWork(45, 'Plank', null, owner)
  const raw = localStorage.getItem(WORK_KEY), original = localStorage.setItem.bind(localStorage)
  const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => { if (key === 'gym_timer_recovery') throw new Error('quota'); original(key, value) })
  try {
    useStore.getState().replaceState({ ...useStore.getState().S, active: active() })
    expect(useUI.getState().work).toBeNull()
    expect(localStorage.getItem(WORK_KEY)).toBe(raw)
    useUI.getState().startWork(20, 'New', null, owner)
    expect(localStorage.getItem(WORK_KEY)).toBe(raw)
  } finally { spy.mockRestore() }
})
it('does not show a delayed browser notification after its owner changes', async () => {
  let resolve
  const showNotification = vi.fn()
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: () => new Promise(r => { resolve = r }) } })
  globalThis.Notification = Object.assign(vi.fn(), { permission: 'granted' })
  window.Notification = globalThis.Notification
  try {
    useUI.getState().startRest(1); vi.advanceTimersByTime(1000)
    useStore.getState().replaceState({ ...useStore.getState().S, active: active() })
    resolve({ showNotification }); await Promise.resolve(); await Promise.resolve()
    expect(showNotification).not.toHaveBeenCalled()
  } finally { delete globalThis.Notification; delete navigator.serviceWorker; Object.defineProperty(document, 'hidden', { configurable: true, value: false }) }
})

it('waits for real hydration and restores the persisted authoritative session token after reload', async () => {
  useUI.getState().startWork(45, 'Plank', null, owner)
  const raw = localStorage.getItem(WORK_KEY), before = scope()
  await holder.fixture.flush(); const envelope = await holder.fixture.saved()
  const { fakeStorage } = await import('../lib/cloud/test-fixtures.js')
  const storage = fakeStorage({ [before.ownerKey]: envelope }), read = storage.read
  let release; const gate = new Promise(resolve => { release = resolve })
  storage.read = async (...args) => { await gate; return read(...args) }
  const reloaded = createWorkoutStore({ projectId: 'demo-opengym', client: null, config: {}, storage, remote: null, lifecycle: false, legacyReader: { read: async () => [] }, authFactory: () => ({ ready: Promise.resolve(null), stop() {} }) })
  await holder.fixture.attach(reloaded)
  localStorage.setItem(WORK_KEY, raw)
  const boot = reloaded.getState().boot()
  expect(restoreWork()).toBe(false); expect(localStorage.getItem(WORK_KEY)).toBe(raw)
  release(); await boot
  expect(scope()).toEqual(before)
  expect(useUI.getState().work.context).toEqual(before)
  expect(useUI.getState().work.owner).toEqual(owner)
})
