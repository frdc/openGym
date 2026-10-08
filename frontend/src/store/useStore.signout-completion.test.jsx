// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkoutStore } from './useStore.js'
import { fakeStorage } from '../lib/cloud/test-fixtures.js'
const stores = []
afterEach(async () => { for (const store of stores.splice(0)) await store.getState().dispose() })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function setup(action) {
  let auth
  const request = deferred(), sdkSignOut = vi.fn(() => { request.resolve(); return action ? action(auth) : Promise.resolve() })
  const store = createWorkoutStore({ projectId: 'demo-opengym', config: {}, client: null, storage: fakeStorage(), legacyReader: { read: async () => [] }, lifecycle: false,
    authFactory: ({ onUser }) => { auth = onUser; return { ready: Promise.resolve(null), stop() {}, signOut: sdkSignOut } } })
  stores.push(store); await store.getState().boot()
  let listeners = 0
  const subscribe = store.subscribe
  store.subscribe = fn => { listeners++; const stop = subscribe(fn); let live = true; return () => { if (live) { live = false; listeners--; stop() } } }
  return { store, auth: uid => auth(uid ? { uid } : null), sdkSignOut, request, listeners: () => listeners }
}
it('owed refusal sends no SDK request and installs no completion waiter', async () => {
  const h = await setup(); await h.auth('a')
  h.store.getState().update(s => { s.restSec = 123 }, false); await h.store.getState().flushLocal()
  expect(await h.store.getState().signOut()).toMatchObject({ owed: true })
  expect(h.sdkSignOut).not.toHaveBeenCalled(); expect(h.listeners()).toBe(0)
})
it('already Guest is an immediate no-op without an SDK request or waiter', async () => {
  const h = await setup()
  expect(await h.store.getState().signOut()).toMatchObject({ owed: false })
  expect(h.sdkSignOut).not.toHaveBeenCalled(); expect(h.listeners()).toBe(0)
})
it('ordinary unconfigured Guest needs no Auth session to finish a sign-out no-op', async () => {
  const store = createWorkoutStore({ projectId:'demo-opengym', config:{}, client:null, storage:fakeStorage(), legacyReader:{read:async()=>[]}, lifecycle:false })
  stores.push(store); await store.getState().boot()
  expect(await store.getState().signOut()).toMatchObject({owed:false})
})
it('SDK completion alone does not imply null Auth; the later observer completes and unsubscribes', async () => {
  const h = await setup(); await h.auth('a')
  let finished = false
  const signing = h.store.getState().signOut().then(value => { finished = true; return value })
  await h.request.promise; await Promise.resolve()
  expect(finished).toBe(false); expect(h.listeners()).toBe(1)
  expect(h.store.getState().user.uid).toBe('a')
  await h.auth(null)
  expect(await signing).toMatchObject({owed:false}); expect(h.listeners()).toBe(0)
})
it('SDK rejection unsubscribes and retains the confirmed account', async () => {
  const h = await setup(() => Promise.reject(Object.assign(new Error('request rejected'), {code:'auth/network-request-failed'}))); await h.auth('a')
  await expect(h.store.getState().signOut()).rejects.toMatchObject({code:'auth/network-request-failed'})
  expect(h.store.getState().user.uid).toBe('a'); expect(h.listeners()).toBe(0)
})
it('disposal rejects and unsubscribes even before the SDK request settles or hydration publishes', async () => {
  const sdk = deferred(), h = await setup(() => sdk.promise); await h.auth('a')
  const signing = h.store.getState().signOut().catch(error => error)
  await h.request.promise
  expect(h.listeners()).toBe(1)
  await h.store.getState().dispose()
  expect((await signing).code).toBe('stale-context'); expect(h.listeners()).toBe(0)
  sdk.resolve()
})
it('later B rejects and removes the waiter while an earlier SDK request is still pending', async () => {
  const sdk = deferred(), h = await setup(() => sdk.promise); await h.auth('a')
  const signing = h.store.getState().signOut().catch(error => error)
  await h.request.promise; await h.auth('b')
  expect((await signing).code).toBe('stale-context'); expect(h.listeners()).toBe(0)
  expect(h.store.getState().user.uid).toBe('b'); sdk.resolve()
})
