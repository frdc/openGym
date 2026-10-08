import { afterEach } from 'vitest'
import { createWorkoutStore } from './useStore.js'
import { fakeStorage, fakeRemote, fixtureState } from '../lib/cloud/test-fixtures.js'
import { makeOwner, makeEnvelope } from '../lib/cloud/model.js'
import { encodeState, decodeState } from '../lib/cloud/codec.js'
export const projectId = 'demo-opengym'
export const owner = uid => makeOwner(projectId, uid ?? null)
export const state = fixtureState
export const workout = (id, weight = 40, day = '2026-09-01') => ({ id, d: day, start: 1000, end: 2000, entries: [{ id: '0025', sets: [{ w: weight, r: 5, done: true }], target: { mode: 'reps' } }], prs: ['0025'] })
export const profile = (s = state(), revision = 0) => ({ control: { schemaVersion: 1, generation: 1, dataRevision: revision, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }, documents: encodeState(JSON.parse(JSON.stringify(s)), { generation: 1, unitVersion: 1 }).documents })
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const runtimes = []
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.getState().dispose() })
export async function runtime({ initial, storage = fakeStorage(initial ? { [owner().ownerKey]: makeEnvelope(owner(), state(initial)) } : {}), cloud = false, profiles = {}, ...options } = {}) {
  let onUser
  const ports = new Map()
  const remoteFor = uid => {
    const key = owner(uid).ownerKey
    if (!ports.has(key)) ports.set(key, fakeRemote(profile(state(profiles[uid])), { ownerKey: key }))
    return ports.get(key)
  }
  const remote = cloud ? new Proxy({}, { get: (_, method) => (o, ...args) => remoteFor(o.uid)[method](o, ...args) }) : null
  const authFactory = input => { onUser = input.onUser; return { ready: Promise.resolve(null), stop() {}, signOut: () => onUser(null) } }
  const store = createWorkoutStore({ client: null, config: {}, projectId, storage, remote, authFactory, legacyReader: { read: async () => [] }, lifecycle: false, ...options })
  runtimes.push(store); await store.getState().boot()
  return { store, storage, remoteFor, auth: user => onUser(typeof user === 'string' ? { uid: user } : user),
    saved: () => storage.read(store.getState().ownerKey),
    remoteState: async uid => { const p = await remoteFor(uid).readProfileFromServer(owner(uid)); return decodeState(p.documents, { generation: p.control.generation }) },
    sync: () => store.getState().syncNow() }
}
