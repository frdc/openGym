// @vitest-environment happy-dom
// Native replacements for the supported cold-start contracts in mobile-remote.
// Case mapping: docs/NATIVE_REGRESSION_MAPPING.md. Filesystem is a test double;
// store, codec, two-slot storage, owner transitions and sync bridge are real.
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { fakeFilesystem, fakeRemote } from '../lib/cloud/test-fixtures.js'
import { createFsStorage } from '../lib/cloud/offline-fs.js'
import { makeEnvelope } from '../lib/cloud/model.js'
import { decodeState } from '../lib/cloud/codec.js'

vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ abandonWork() {}, stopRest() {}, stopWork() {} }) } }))
const ids = s => s.workouts.map(w => w.id).sort()
const opIds = e => e.pendingOperations.map(op => op.opId)
const error = code => Object.assign(new Error(code), { code })
function server(initial = {}) {
  const ports = new Map()
  const port = uid => {
    if (!ports.has(uid)) ports.set(uid, fakeRemote(profile(state(initial[uid])), { ownerKey: owner(uid).ownerKey }))
    return ports.get(uid)
  }
  return { port, remote: new Proxy({}, { get: (_, method) => (o, ...args) => port(o.uid)[method](o, ...args) }),
    async state(uid) { const p = await port(uid).readProfileFromServer(owner(uid)); return decodeState(p.documents, { generation: p.control.generation }) } }
}
function checkpoint(fs) {
  // Capture BEFORE disposal, which deliberately flushes live memory.
  const next = fakeFilesystem()
  for (const [path, bytes] of fs.files) next.files.set(path, bytes)
  localStorage.clear()
  return next
}
const open = (fs, cloud, options = {}) => runtime({ storage: createFsStorage(fs), remote: cloud.remote, ...options })
async function ready(fs, cloud, uid = 'A', options) { const h = await open(fs, cloud, options); await h.auth(uid); await h.sync(); return h }
async function edit(h, producer) { h.store.getState().update(producer, false); await h.store.getState().flushLocal(); return h.saved() }
function granular(port) { for (const tx of port.transactions) { expect(tx.kind).toBe('operation'); expect(tx.paths.length).toBeGreaterThan(0); expect(tx.paths.every(p => /^(workouts|settings|plans|routines|exerciseState)\//.test(p))).toBe(true) } }

it('N1 restores native auth-failed debt after eviction and joins newer peer work before ACK', async () => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  const saved = await edit(h, s => { s.workouts.push(workout('local')) })
  cloud.port('A').failNext(error('unauthenticated')); await h.sync()
  expect(h.store.getState()).toMatchObject({ user: { uid: 'A' }, sync: { local: 'saved', cloud: 'auth-required' } })
  expect(opIds(await h.saved())).toEqual(opIds(saved))
  const cold = checkpoint(fs); await h.store.getState().dispose()
  cloud.port('A').replaceProfile(profile(state({ workouts: [workout('peer')] }), 10))
  const port = cloud.port('A'), commit = port.commitOperation, entered = deferred(), release = deferred()
  port.commitOperation = async (...args) => { const ack = await commit(...args); entered.resolve(); await release.promise; return ack }
  const reloaded = await open(cold, cloud)
  try {
    await reloaded.auth('A'); await entered.promise
    expect(opIds(await reloaded.saved())).toEqual(opIds(saved))
    expect(reloaded.store.getState().unsyncedChanges().owed).toBe(true)
  } finally { release.resolve(); port.commitOperation = commit }
  await reloaded.sync()
  expect(ids(reloaded.store.getState().S)).toEqual(['local', 'peer'])
  expect(ids(await cloud.state('A'))).toEqual(['local', 'peer'])
  expect((await reloaded.saved()).pendingOperations).toEqual([]); granular(port)
})

it('N2 explicitly adds unknown native week, routine edits and settings once across restart', async () => {
  const fs = fakeFilesystem(), routine = (id, reps, stamp) => ({ id, name: id, ex: [{ id: '0025', sets: 2, reps }], _ts: stamp })
  const source = { sourceId: 'native:opengym-state.json', ownerMetadata: { owner: 'legacy-a' }, state: state({ _ts: 2000, restSec: 60, workouts: [workout('week')], routines: [routine('push', 15, 2000), routine('new-plan', 8, 2000)] }) }
  const bytes = JSON.stringify(source); fs.files.set('opengym-state.json', bytes)
  const legacyReader = { read: async () => [structuredClone(source)] }
  const cloud = server({ A: { _ts: 1000, restSec: 90, workouts: [workout('account')], routines: [routine('push', 10, 1000)] } })
  const h = await ready(fs, cloud, 'A', { legacyReader }), id = h.store.getState().listRecovery()[0].recoveryId
  expect(ids(h.store.getState().S)).toEqual(['account']); expect(cloud.port('A').transactions).toEqual([])
  await edit(h, s => { s.workouts.push(workout('held-account')) })
  await h.store.getState().resolveRecovery(id, 'add'); await h.sync()
  expect(ids(h.store.getState().S)).toEqual(['account', 'held-account', 'week'])
  expect(h.store.getState().S.routines.find(r => r.id === 'push').ex[0].reps).toBe(15)
  expect(h.store.getState().S.routines.map(r => r.id).sort()).toEqual(['new-plan', 'push'])
  expect(h.store.getState().S.restSec).toBe(60)
  expect(fs.files.get('opengym-state.json')).toBe(bytes)
  const count = cloud.port('A').transactions.length, cold = checkpoint(fs)
  await h.store.getState().dispose()
  const reloaded = await ready(cold, cloud, 'A', { legacyReader })
  await reloaded.store.getState().resolveRecovery(id, 'add'); await reloaded.sync()
  expect(ids(reloaded.store.getState().S)).toEqual(['account', 'held-account', 'week'])
  expect(cloud.port('A').transactions).toHaveLength(count)
  expect(cold.files.get('opengym-state.json')).toBe(bytes)
})

it('N3 forced confirmed logout survives immediate native restart with private A debt', async () => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  const saved = await edit(h, s => { s.workouts.push(workout('owed')) })
  const port = cloud.port('A'), read = port.readProfileFromServer
  port.readProfileFromServer = async () => { throw error('unauthenticated') }
  try {
    expect(await h.store.getState().signOut()).toMatchObject({ owed: true })
    expect(await h.store.getState().signOut({ force: true })).toMatchObject({ owed: true, stashed: true })
  } finally { port.readProfileFromServer = read }
  const cold = checkpoint(fs); await h.store.getState().dispose()
  const reloaded = await open(cold, cloud)
  expect(reloaded.store.getState().isGuest()).toBe(true); expect(ids(reloaded.store.getState().S)).toEqual([])
  expect(reloaded.store.getState().listRecovery()).toEqual([])
  expect(() => reloaded.store.getState().recoveryState(owner('A').ownerKey)).toThrow('recovery-owner-mismatch')
  expect(opIds(await reloaded.storage.read(owner('A').ownerKey))).toEqual(opIds(saved))
  await reloaded.auth('B'); await reloaded.sync()
  expect(ids(reloaded.store.getState().S)).toEqual([]); expect(cloud.port('B').transactions).toEqual([])
  port.replaceProfile(profile(state({ workouts: [workout('peer')] }), 20))
  await reloaded.auth('A'); await reloaded.sync()
  expect(ids(reloaded.store.getState().S)).toEqual(['owed', 'peer']); expect(reloaded.store.getState().unsyncedChanges().owed).toBe(false)
})

it('N4 ordinary synced native reload keeps draft token and creates zero domain debt', async () => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  await edit(h, s => { s.workouts.push(workout('saved')); s.active = { id: 'draft', entries: [] } }); await h.sync()
  const saved = await h.saved(), token = h.store.getState().activeSessionToken, count = cloud.port('A').transactions.length
  expect(saved.pendingOperations).toEqual([])
  const cold = checkpoint(fs); await h.store.getState().dispose()
  const reloaded = await ready(cold, cloud)
  expect(ids(reloaded.store.getState().S)).toEqual(['saved']); expect(reloaded.store.getState().S.active.id).toBe('draft')
  expect(reloaded.store.getState().activeSessionToken).toBe(token)
  expect((await reloaded.saved()).pendingOperations).toEqual([])
  expect(reloaded.store.getState().unsyncedChanges()).toMatchObject({ count: 0, owed: false })
  expect(cloud.port('A').transactions).toHaveLength(count)
})

it.each(['torn', 'ENOSPC', 'readback', 'all-writes'])('N5 native %s interruption preserves confirmed debt and merges peer history', async mode => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud), key = owner('A').ownerKey
  await edit(h, s => { s.workouts.push(workout('local')) })
  // Ensure BOTH slots already contain the confirmed local workout and its debt.
  const baseline = await h.storage.commit(key, e => e), events = [], off = h.storage.subscribe(key, r => events.push(r))
  const write = fs.mod.Filesystem.writeFile
  let broken = true
  if (mode === 'torn') {
    const slots = [...fs.files].filter(([, bytes]) => JSON.parse(bytes).envelope.ownerKey === key).sort((a, b) => JSON.parse(b[1]).envelope.localRevision - JSON.parse(a[1]).envelope.localRevision)
    fs.files.set(slots[0][0], '{torn')
  } else {
    if (mode === 'ENOSPC') fs.failNextWrite(error('ENOSPC'))
    if (mode === 'readback') fs.transformNextWrite(() => '{torn')
    if (mode === 'all-writes') fs.mod.Filesystem.writeFile = args => broken ? Promise.reject(error('ENOSPC')) : write(args)
    cloud.port('A').delayCallbacks()
    cloud.port('A').replaceProfile(profile(state({ workouts: [workout('peer')] }), 20))
    await h.sync()
    expect(h.store.getState().sync.local).toBe('error'); expect(events).toEqual([])
  }
  const cold = checkpoint(fs); off(); broken = false; fs.mod.Filesystem.writeFile = write
  const confirmed = await createFsStorage(cold).read(key)
  expect(ids(confirmed.state)).toEqual(['local']); expect(opIds(confirmed)).toEqual(opIds(baseline))
  await h.store.getState().dispose()
  cloud.port('A').replaceProfile(profile(state({ workouts: [workout('peer')] }), 20))
  const reloaded = await ready(cold, cloud)
  expect(ids(reloaded.store.getState().S)).toEqual(['local', 'peer']); expect(ids(await cloud.state('A'))).toEqual(['local', 'peer'])
  expect((await reloaded.saved()).pendingOperations).toEqual([]); granular(cloud.port('A'))
})

it.each([false, true])('N6 native A to B immediate restart isolates owners (departure ENOSPC=%s)', async fails => {
  const fs = fakeFilesystem(), cloud = server({ B: { workouts: [workout('B-only')] } }), h = await ready(fs, cloud)
  await edit(h, s => { s.workouts.push(workout('A-only')) })
  const baseline = await h.saved(), write = fs.mod.Filesystem.writeFile, entered = deferred(), release = deferred(), publications = []
  let broken = fails
  const off = h.store.subscribe(s => { if (s.localReady) publications.push(s.ownerKey) })
  try {
    if (fails) {
      fs.mod.Filesystem.writeFile = async args => { entered.resolve(); await release.promise; if (broken) throw error('ENOSPC'); return write(args) }
      h.store.getState().update(s => { s.targetW = 123 }, false); await entered.promise
    }
    const switching = h.auth('B')
    if (fails) { expect(h.store.getState().localReady).toBe(false); expect(h.store.getState().ownerKey).toBeNull(); release.resolve() }
    await switching
    if (fails) { expect(h.store.getState().localReady).toBe(false); expect(publications).not.toContain(owner('B').ownerKey) }
    const cold = checkpoint(fs)
    expect((await createFsStorage(cold).read(owner('A').ownerKey)).state.targetW).toBe(baseline.state.targetW)
    // A fresh process has only confirmed bytes, never the departed unsaved heap.
    const reloaded = await ready(cold, cloud, 'B')
    expect(ids(reloaded.store.getState().S)).toEqual(['B-only']); expect(cloud.port('B').transactions).toEqual([])
    broken = false; await h.store.getState().retryLocal()
    expect(h.store.getState().ownerKey).toBe(owner('B').ownerKey)
    if (fails) expect((await h.storage.read(owner('A').ownerKey)).state.targetW).toBe(123)
  } finally { release.resolve(); broken = false; fs.mod.Filesystem.writeFile = write; off() }
})

it.each(['guest', 'unknown'])('N7 explicit Keep of %s persists across native restart without uploading declined data', async kind => {
  const fs = fakeFilesystem(), cloud = server({ A: { restSec: 64, workouts: [workout('account')] } })
  const source = { sourceId: 'native:old', state: state({ restSec: 31, workouts: [workout('declined')] }) }
  const options = kind === 'unknown' ? { legacyReader: { read: async () => [source] } } : {}
  if (kind === 'guest') await createFsStorage(fs).commit(owner().ownerKey, () => makeEnvelope(owner(), source.state))
  const h = await ready(fs, cloud, 'A', options)
  const id = kind === 'unknown' ? h.store.getState().listRecovery()[0].recoveryId : h.store.getState().adoptionDecision.recoveryId
  if (kind === 'unknown') await h.store.getState().resolveRecovery(id, 'keep')
  else await h.store.getState().resolveAdoption('keep')
  const saved = await h.saved()
  expect(kind === 'unknown' ? saved.recoveryCopies.find(c => c.recoveryId === id).decision : saved.adoptionDecision.status).toBe('keep')
  const cold = checkpoint(fs); await h.store.getState().dispose()
  const reloaded = await ready(cold, cloud, 'A', options)
  expect(ids(reloaded.store.getState().S)).toEqual(['account']); expect(reloaded.store.getState().S.restSec).toBe(64)
  expect(ids(reloaded.store.getState().recoveryState(id))).toEqual(['declined'])
  expect(ids(await cloud.state('A'))).toEqual(['account']); expect(cloud.port('A').transactions).toEqual([])
})

it('N8 newer control with lower peer clock stays durable through immediate native restart', async () => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  await edit(h, s => { s.workouts.push(workout('known')); s.restSec = 35 }); await h.sync()
  cloud.port('A').replaceProfile(profile(state({ _ts: 1, workouts: [{ ...workout('peer'), _ts: 1 }] }), 50)); await h.sync()
  const saved = await h.saved(), count = cloud.port('A').transactions.length
  expect(saved.lastConfirmedControl.dataRevision).toBe(50); expect(ids(saved.state)).toEqual(['known', 'peer'])
  const cold = checkpoint(fs); await h.store.getState().dispose()
  const reloaded = await ready(cold, cloud)
  expect(ids(reloaded.store.getState().S)).toEqual(['known', 'peer']); expect((await reloaded.saved()).lastConfirmedControl.dataRevision).toBe(50)
  expect(reloaded.store.getState().unsyncedChanges().owed).toBe(false); expect(cloud.port('A').transactions).toHaveLength(count)
})

it('N9 invalid-document port rejection preserves native account archive and debt instead of defaults', async () => {
  // firestore-port.test.js owns raw canonical validation. This composes its ERROR
  // contract into the real store; fakeRemote itself does not validate raw records.
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  const saved = await edit(h, s => { s.workouts.push(workout('safe')); s.restSec = 39 })
  cloud.port('A').failNext(Object.assign(error('invalid-document'), { path: 'settings/unit' })); await h.sync()
  expect(h.store.getState()).toMatchObject({ user: { uid: 'A' }, sync: { cloud: 'blocked', cloudError: { code: 'invalid-document' } } })
  expect(ids(h.store.getState().S)).toEqual(['safe']); expect(h.store.getState().S.restSec).toBe(39)
  expect(opIds(await h.saved())).toEqual(opIds(saved)); expect(h.store.getState().unsyncedChanges().owed).toBe(true)
  expect(cloud.port('A').transactions).toEqual([])
  expect((await createFsStorage(checkpoint(fs)).read(owner('A').ownerKey)).state).toEqual(saved.state)
})

it('N10 deferred server ACK leaves local edits durable and cannot install into B; independent A recovers', async () => {
  const fs = fakeFilesystem(), cloud = server(), h = await ready(fs, cloud)
  await edit(h, s => { s.workouts.push(workout('first')) })
  const port = cloud.port('A'), commit = port.commitOperation, entered = deferred(), release = deferred()
  port.commitOperation = async (...args) => { const ack = await commit(...args); entered.resolve(); await release.promise; return ack }
  const syncing = h.sync()
  try {
    await entered.promise
    const saved = await edit(h, s => { s.workouts.push(workout('second')) })
    expect(saved.pendingOperations).toHaveLength(2); expect(h.store.getState().sync.local).toBe('saved')
    const cold = checkpoint(fs)
    await h.auth('B'); expect(ids(h.store.getState().S)).toEqual([])
    release.resolve(); await syncing
    expect(h.store.getState().ownerKey).toBe(owner('B').ownerKey); expect(ids(h.store.getState().S)).toEqual([])
    expect(cloud.port('B').transactions).toEqual([])
    port.commitOperation = commit
    const reloaded = await ready(cold, cloud)
    expect(ids(reloaded.store.getState().S)).toEqual(['first', 'second']); expect(ids(await cloud.state('A'))).toEqual(['first', 'second'])
    expect((await reloaded.saved()).pendingOperations).toEqual([])
  } finally { release.resolve(); port.commitOperation = commit; await syncing }
})
