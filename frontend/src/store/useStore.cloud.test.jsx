// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as stores from './useStore.js'
import { runtime as cloudRuntime } from './cloud-test-runtime.js'
import { fakeStorage, fakeFilesystem, fixtureState } from '../lib/cloud/test-fixtures.js'
import { createFsStorage } from '../lib/cloud/offline-fs.js'
import { makeOwner, makeEnvelope } from '../lib/cloud/model.js'
import { createSyncBridge } from '../lib/cloud/sync-bridge.js'
const projectId = 'demo-opengym', guest = makeOwner(projectId), storesToStop = []
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(options = {}) {
  expect(typeof stores.createWorkoutStore).toBe('function')
  let listener
  const authFactory = ({ onUser }) => { listener = onUser; return { ready: Promise.resolve(null), stop() {}, signOut: async () => listener(null) } }
  const storage = options.storage || fakeStorage()
  const store = stores.createWorkoutStore({ client: null, config: {}, projectId, storage, authFactory, legacyReader: { read: async () => [] }, lifecycle: false, ...options })
  storesToStop.push(store)
  return { store, storage, auth: user => listener(user) }
}
afterEach(async () => { for (const s of storesToStop.splice(0)) await s.getState().dispose(); vi.restoreAllMocks() })
it('runs producer once synchronously and queues all changed finish documents', async () => {
  const { store, storage } = setup(); await store.getState().boot()
  const producer = vi.fn(s => { s.workouts.push({ id: 'w1', d: '2026-10-07', start: 1, entries: [] }); s.queue = ['next'] })
  store.getState().update(producer, false, { kind: 'finish' })
  expect(producer).toHaveBeenCalledTimes(1); expect(store.getState().S.workouts[0].id).toBe('w1')
  await store.getState().flushLocal()
  const operation = (await storage.read(guest.ownerKey)).pendingOperations.at(-1)
  expect(operation.kind).toBe('finish'); expect(operation.paths).toEqual(expect.arrayContaining(['workouts/dzE', 'plans/main']))
  expect(operation.paths).not.toContain('settings/unit')
})
it('keeps active local with stable incarnation outside shared state and rotates reopened draft', async () => {
  const { store, storage } = setup(); await store.getState().boot()
  const activeDraft = { id: 'session', entries: [] }
  store.getState().update(s => { s.active = activeDraft }); await store.getState().flushLocal()
  const e = await storage.read(guest.ownerKey), token = store.getState().activeSessionToken
  expect(e.state.active).toEqual(activeDraft); expect(e.pendingOperations).toEqual([])
  expect(token).toEqual(expect.any(String)); expect(e.localMetadata.activeSessionToken).toBe(token)
  expect(e.state.activeSessionToken).toBeUndefined()
  const again = setup({ storage }).store; await again.getState().boot(); expect(again.getState().activeSessionToken).toBe(token)
  again.getState().update(s => { s.active = null }); again.getState().update(s => { s.active = activeDraft })
  expect(again.getState().activeSessionToken).not.toBe(token)
})
it('rejects edits before readiness and executes domain failure synchronously without intent', async () => {
  const { store, storage } = setup(), producer = vi.fn()
  expect(() => store.getState().update(producer)).toThrow('local-not-ready'); expect(producer).not.toHaveBeenCalled()
  await store.getState().boot()
  expect(() => store.getState().update(() => { throw new Error('domain-failed') })).toThrow('domain-failed')
  await store.getState().flushLocal(); expect((await storage.read(guest.ownerKey)).pendingOperations).toEqual([])
})
it('rejects raw UID authority and separates confirmed A from B', async () => {
  const { store, storage, auth } = setup(); await store.getState().boot()
  expect(() => store.getState().setUser({ uid: 'a' })).toThrow('auth-confirmation-required')
  await auth({ uid: 'a' }); store.getState().update(s => { s.workouts.push({ id: 'from-A', d: '2026-10-07', entries: [] }) }); await store.getState().flushLocal()
  await auth({ uid: 'b' }); expect(store.getState().ownerKey).toBe(makeOwner(projectId, 'b').ownerKey)
  expect(store.getState().S.workouts).not.toContainEqual(expect.objectContaining({ id: 'from-A' }))
  expect((await storage.read(makeOwner(projectId, 'a').ownerKey)).state.workouts[0].id).toBe('from-A')
})
it('hides failed departure A immediately and retries A locally before B hydration', async () => {
  const storage = fakeStorage(), original = storage.commit, { store, auth } = setup({ storage })
  await store.getState().boot(); await auth({ uid: 'a' }); let fail = true
  storage.commit = (...args) => fail ? Promise.reject(Object.assign(new Error('full'), { code: 'storage-full' })) : original(...args)
  store.getState().update(s => { s.targetW = 123 }); await Promise.resolve()
  const switched = auth({ uid: 'b' }); expect(store.getState().localReady).toBe(false); expect(store.getState().S.targetW).not.toBe(123)
  await switched; expect(store.getState().sync.local).toBe('error'); expect(store.getState().localReady).toBe(false)
  fail = false; await store.getState().retryLocal()
  expect(store.getState().ownerKey).toBe(makeOwner(projectId, 'b').ownerKey); expect(store.getState().S.targetW).not.toBe(123)
  expect((await storage.read(makeOwner(projectId, 'a').ownerKey)).state.targetW).toBe(123)
})
it('releases local readiness independently of Auth and makes duplicate boot idempotent', async () => {
  const gate = deferred(), { store } = setup({ authFactory: () => ({ ready: gate.promise, stop() {} }) })
  await Promise.all([store.getState().boot(), store.getState().boot()])
  expect(store.getState().localReady).toBe(true); expect(store.getState().authReady).toBe(false)
  store.getState().update(s => { s.restSec = 37 }); gate.resolve(null); await Promise.resolve()
  await store.getState().boot(); expect(store.getState().S.restSec).toBe(37)
})
it('preserves Android file and session token after WebView eviction', async () => {
  const filesystem = fakeFilesystem(), { store } = setup({ storage: createFsStorage(filesystem) }); await store.getState().boot()
  store.getState().update(s => { s.active = { id: 'native', entries: [] }; s.targetW = 76 }); await store.getState().flushLocal()
  const token = store.getState().activeSessionToken; localStorage.clear()
  const reload = setup({ storage: createFsStorage(filesystem) }).store; await reload.getState().boot()
  expect(reload.getState().S).toMatchObject({ active: { id: 'native' }, targetW: 76 }); expect(reload.getState().activeSessionToken).toBe(token)
})
it('migrates admitted data before defaults and queues seed idempotently', async () => {
  const legacyReader = { read: async () => [{ sourceId: 'trusted', state: fixtureState({ targetW: 87 }), ownerKey: guest.ownerKey, identityProvider: 'guest' }] }
  const { store, storage } = setup({ legacyReader }); await store.getState().boot(); const saved = await storage.read(guest.ownerKey)
  expect(saved.state.targetW).toBe(87); expect(saved.pendingOperations).toHaveLength(1)
  const reload = setup({ storage, legacyReader }).store; await reload.getState().boot()
  expect((await storage.read(guest.ownerKey)).pendingOperations.map(x => x.opId)).toEqual(saved.pendingOperations.map(x => x.opId))
})
it('retains unknown Node recovery without adopting or uploading', async () => {
  const legacyReader = { read: async () => [{ sourceId: 'node', state: fixtureState({ targetW: 99 }), ownerMetadata: { owner: 'a' } }] }
  const { store, storage } = setup({ legacyReader }); await store.getState().boot(); const e = await storage.read(guest.ownerKey)
  expect(e.state.targetW).not.toBe(99); expect(e.recoveryCopies[0].state.targetW).toBe(99); expect(e.pendingOperations).toEqual([])
})
it('bridge publishes a hydrated token and preserves it on stale empty-tab edits', async () => {
  const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, fixtureState({ active: { id: 'reopen' } })) }), states = []
  const bridge = createSyncBridge({ storage, onState: (s, e) => states.push(e) }); await bridge.hydrate(guest)
  const token = states.at(-1).localMetadata?.activeSessionToken; expect(token).toEqual(expect.any(String))
  await bridge.recordChange({ previous: fixtureState(), next: fixtureState({ restSec: 38 }), activeSessionToken: null })
  expect((await storage.read(guest.ownerKey)).localMetadata.activeSessionToken).toBe(token); await bridge.unbindAuth()
})
it('captured local retry rejects unknown owner contexts', async () => {
  const bridge = createSyncBridge({ storage: fakeStorage() }); expect(typeof bridge.flushOwner).toBe('function')
  await expect(bridge.flushOwner(makeOwner(projectId, 'unknown').ownerKey)).rejects.toThrow('unknown-owner-context')
})

it('rotates an explicitly replaced identical active draft and persists its new token', async () => {
 const { store, storage } = setup(); await store.getState().boot()
 store.getState().update(s => { s.active = { id: 'same', entries: [] } }, false); await store.getState().flushLocal()
 const token = store.getState().activeSessionToken, replacement = structuredClone(store.getState().S)
 store.getState().replaceState(replacement); await store.getState().flushLocal()
 expect(store.getState().activeSessionToken).not.toBe(token)
 expect((await storage.read(guest.ownerKey)).localMetadata.activeSessionToken).toBe(store.getState().activeSessionToken)
})
it('initializes an adopted active incarnation and preserves an existing account active draft', async () => {
 for (const hasAccountDraft of [false,true]) {
  const account = makeOwner(projectId, 'a'), storage = fakeStorage({
   [guest.ownerKey]: makeEnvelope(guest, fixtureState({ active: { id: 'guest-active' } })),
   [account.ownerKey]: makeEnvelope(account, fixtureState({ active: hasAccountDraft ? { id: 'account-active' } : null })),
  })
  const { store, auth } = setup({ storage }); await store.getState().boot(); await auth({ uid: 'a' })
  const token = store.getState().activeSessionToken
  await store.getState().resolveAdoption('add')
  expect(store.getState().S.active.id).toBe(hasAccountDraft ? 'account-active' : 'guest-active')
  expect(store.getState().activeSessionToken).toEqual(expect.any(String))
  if (hasAccountDraft) expect(store.getState().activeSessionToken).toBe(token)
 }
})
it('cancels a delayed A hydration callback after B is confirmed', async () => {
 const storage = fakeStorage(), read = storage.read, gate = deferred()
 const { store, auth } = setup({ storage }); await store.getState().boot()
 storage.read = async key => { if (key === makeOwner(projectId,'a').ownerKey) await gate.promise; return read(key) }
 const a = auth({ uid: 'a' }); await auth({ uid: 'b' }); gate.resolve(); await a
 expect(store.getState().ownerKey).toBe(makeOwner(projectId,'b').ownerKey); expect(store.getState().localReady).toBe(true)
})
it('publishes local readiness only with its owner and persisted active incarnation', async () => {
 const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, fixtureState({ active: { id: 'ready' } })) })
 const { store } = setup({ storage }), snapshots = []
 store.subscribe(s => { if (s.localReady) snapshots.push([s.ownerKey,s.S.active.id,s.activeSessionToken]) })
 await store.getState().boot(); expect(snapshots.length).toBeGreaterThan(0)
 for (const [key,id,token] of snapshots) { expect(key).toBe(guest.ownerKey); expect(id).toBe('ready'); expect(token).toEqual(expect.any(String)) }
})
it('registers lifecycle once, coalesces foreground hints and removes callbacks on disposal', async () => {
 const { store } = setup({ lifecycle: true }); await store.getState().boot(); await store.getState().boot()
 const flush = vi.spyOn(store.getState(), 'flushLocal')
 window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(1)
 await store.getState().dispose(); window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(1)
})
it.each([NaN, Infinity, -Infinity])('rejects nonfinite producer weight %s before admission without changing prior state', async weight => {
 const { store, storage } = setup(); await store.getState().boot()
 store.getState().update(s => { s.active = { id: 'valid', entries: [{ id: '0025', sets: [{ w: 40 }] }] } }, false); await store.getState().flushLocal()
 const before = structuredClone(store.getState().S), count = (await storage.read(guest.ownerKey)).pendingOperations.length
 expect(() => store.getState().update(s => { s.active.entries[0].sets[0].w = weight })).toThrow('invalid-local-data:active.entries.0.sets.0.w')
 expect(store.getState().S).toEqual(before); expect((await storage.read(guest.ownerKey)).pendingOperations).toHaveLength(count)
})
it.each(['array-undefined','array-hole','cycle','date'])('rejects unsupported JSON draft %s without admission', type => {
 return (async () => {
  const { store } = setup(); await store.getState().boot(); const before = structuredClone(store.getState().S)
  expect(() => store.getState().update(s => {
   if (type === 'array-undefined') s.queue = [undefined]
   if (type === 'array-hole') s.queue = Array(1)
   if (type === 'cycle') s.active = s
   if (type === 'date') s.active = new Date()
  })).toThrow('invalid-local-data:')
  expect(store.getState().S).toEqual(before)
 })()
})
it('requests optional browser persistence once without blocking hydration on its answer', async () => {
 const gate = deferred(), persist = vi.fn(() => gate.promise)
 vi.stubGlobal('navigator', { language: 'en', storage: { persist } })
 try { const { store } = setup(); await store.getState().boot(); await store.getState().boot(); expect(store.getState().localReady).toBe(true); expect(persist).toHaveBeenCalledOnce() }
 finally { gate.resolve(false); vi.unstubAllGlobals() }
})
it('heals an incoming custom exercise without restamping and persists it on the next edit', async () => {
 const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, fixtureState({ customEx: [{ id: 'custom', name: 'Legacy', _ts: 7 }] })) })
 const { store } = setup({ storage }); await store.getState().boot()
 expect(store.getState().S.customEx[0]).toMatchObject({ custom: true, eq: '', _ts: 7 })
 store.getState().update(s => { s.restSec = 38 }, false); await store.getState().flushLocal()
 expect((await storage.read(guest.ownerKey)).state.customEx[0]).toMatchObject({ custom: true, eq: '', _ts: 7 })
})
it('rejects an unclassified state field before installation instead of claiming a successful flush', async () => {
 const { store, storage } = setup(); await store.getState().boot(); const before = structuredClone(store.getState().S)
 expect(() => store.getState().update(s => { s.unclassifiedSetting = 12 })).toThrow('unclassified-field:unclassifiedSetting')
 expect(store.getState().S).toEqual(before); await store.getState().flushLocal(); expect((await storage.read(guest.ownerKey)).pendingOperations).toEqual([])
})

it.each([false, true])('keeps C hidden through overlapping A→B→C departures (write fails=%s)', async fails => {
 const h = await cloudRuntime({ cloud: true }), aKey = makeOwner(projectId, 'a').ownerKey, cKey = makeOwner(projectId, 'c').ownerKey
 await h.auth('a'); await h.sync()
 const commit = h.storage.commit, started = deferred(), gate = deferred(), producer = vi.fn(s => { s.targetW = 123 })
 let fail = fails
 h.storage.commit = async (key, reducer) => {
  if (key === aKey) { started.resolve(); await gate.promise; if (fail) throw Object.assign(new Error('full'), { code: 'storage-full' }) }
  return commit(key, reducer)
 }
 h.store.getState().update(producer, false); await started.promise
 const b = h.auth('b')
 expect(h.store.getState().localReady).toBe(false)
 const published = [], stop = h.store.subscribe(s => { if (s.localReady) published.push({ key: s.ownerKey, weight: s.S.targetW }) })
 const c = h.auth('c')
 try {
  // Drain every immediately runnable C hydration step while the A write stays held.
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(h.store.getState()).toMatchObject({ localReady: false, ownerKey: null })
  expect(published).toEqual([])
  gate.resolve(); await Promise.all([b, c])
  if (fails) {
   expect(h.store.getState()).toMatchObject({ localReady: false, sync: { local: 'error', localError: { code: 'storage-full' } } })
   expect((await h.storage.read(aKey)).state.targetW).not.toBe(123)
   fail = false; await h.store.getState().retryLocal()
  }
  expect(h.store.getState()).toMatchObject({ localReady: true, ownerKey: cKey, user: { uid: 'c' } })
  expect((await h.storage.read(aKey)).state.targetW).toBe(123)
  expect(published.length).toBeGreaterThan(0)
  expect(published.every(s => s.key === cKey && s.weight !== 123)).toBe(true)
  expect(producer).toHaveBeenCalledOnce()
  expect(h.remoteFor('a').transactions).toEqual([])
  expect(h.remoteFor('b').transactions).toEqual([])
  expect((await h.remoteState('a')).targetW).not.toBe(123)
 } finally { fail = false; gate.resolve(); await Promise.all([b, c]); stop() }
})
it('rapid same-owner Auth refresh waits for departing A and only publishes the latest C identity', async () => {
 const h = await cloudRuntime({ cloud: true }), aKey = makeOwner(projectId, 'a').ownerKey
 await h.auth('a'); await h.sync()
 const commit = h.storage.commit, started = deferred(), gate = deferred()
 h.storage.commit = async (key, reducer) => { if (key === aKey) { started.resolve(); await gate.promise }; return commit(key, reducer) }
 h.store.getState().update(s => { s.targetW = 123 }, false); await started.promise
 const b = h.auth('b')
 expect(h.store.getState().localReady).toBe(false)
 const names = [], stop = h.store.subscribe(s => { if (s.localReady) names.push(s.user?.displayName) })
 const c = h.auth({ uid: 'c', displayName: 'old' }), refresh = h.auth({ uid: 'c', displayName: 'latest' })
 try {
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(h.store.getState().localReady).toBe(false)
  gate.resolve(); await Promise.all([b, c, refresh])
  expect(h.store.getState().user).toMatchObject({ uid: 'c', displayName: 'latest' })
  expect(names.length).toBeGreaterThan(0); expect(names.every(name => name === 'latest')).toBe(true)
  const token = h.store.getState().activeSessionToken
  await h.auth({ uid: 'c', displayName: 'ready refresh' })
  expect(h.store.getState().activeSessionToken).toBe(token)
  expect((await h.storage.read(aKey)).state.targetW).toBe(123)
  expect(h.remoteFor('a').transactions).toEqual([])
 } finally { gate.resolve(); await Promise.all([b, c, refresh]); stop() }
})
