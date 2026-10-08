import { afterEach, describe, it, expect, vi } from 'vitest'
import { createSyncBridge } from './sync-bridge.js'
import * as codec from './codec.js'
import { fakeStorage, fakeRemote, fixtureState } from './test-fixtures.js'
import { makeEnvelope, makeOwner } from './model.js'
import { stampChange } from '../sync-merge.js'

const owner = makeOwner('demo-opengym', 'a')
const control = { schemaVersion: 1, generation: 1, dataRevision: 0, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
const profile = (state = fixtureState(), revision = 0, generation = 1) => ({ control: { ...control, generation, dataRevision: revision }, documents: codec.encodeState(state, { generation, unitVersion: 1 }).documents })
const edit = (previous, values, time = 100) => { const next = { ...structuredClone(previous), ...values }; next._ts = stampChange(previous, next, time); return next }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const bridges = []
let sequence = 0
const setup = (storage = fakeStorage(), remote = fakeRemote(profile()), extra = {}) => {
  const states = [], statuses = []
  const bridge = createSyncBridge({ storage, remote, codec, newId: () => `op-${++sequence}`, onState: (state, envelope) => states.push({ state, envelope }), onStatus: value => statuses.push(value), ...extra })
  bridges.push(bridge)
  return { bridge, storage, remote, states, statuses }
}
const bind = bridge => bridge.bindAuth({ owner, user: { uid: owner.uid }, authEpoch: 1 })
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
afterEach(async () => { for (const bridge of bridges.splice(0)) await bridge.unbindAuth?.().catch(() => {}); vi.useRealTimers() })

describe('durable synchronization coordinator', () => {
  it('hydrates offline, saves state and granular intent together, reloads and uploads', async () => {
    const { bridge, storage, remote, statuses } = setup()
    await bridge.hydrate(owner)
    const before = fixtureState(), next = edit(before, { targetW: 85, active: { id: 'running' } })
    await bridge.recordChange({ previous: before, next })
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state.active.id).toBe('running')
    expect(saved.pendingOperations[0]).toMatchObject({ generation: null, paths: ['settings/targetW'] })
    expect(statuses.at(-1).local).toBe('saved')
    const reload = setup(storage, remote).bridge
    await reload.hydrate(owner); await bind(reload); await reload.syncNow()
    expect((await storage.read(owner.ownerKey)).pendingOperations).toEqual([])
    expect((await remote.readProfileFromServer(owner)).documents['settings/targetW'].payload.value).toBe(85)
  })

  it('retains failed local intent through an independent second edit and successful reload', async () => {
    const { bridge, storage, statuses, states } = setup()
    await bridge.hydrate(owner)
    const before = fixtureState(), first = edit(before, { targetW: 81 }), second = edit(first, { restSec: 77 }, 200)
    storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' }))
    await expect(bridge.recordChange({ previous: before, next: first })).rejects.toMatchObject({ code: 'storage-full' })
    expect(statuses.at(-1)).toMatchObject({ local: 'error', localError: { code: 'storage-full' } })
    expect(states.at(-1).state.targetW).toBe(81)
    await bridge.recordChange({ previous: first, next: second })
    const reload = setup(storage).bridge; await reload.hydrate(owner)
    expect((await storage.read(owner.ownerKey)).state).toMatchObject({ targetW: 81, restSec: 77 })
    expect((await storage.read(owner.ownerKey)).pendingOperations).toHaveLength(2)
  })

  it('applies a delayed ACK to latest storage retaining newer edit and peer watch metadata', async () => {
    const { bridge, storage, remote } = setup()
    await bind(bridge); await bridge.syncNow()
    const gate = deferred(), started = deferred(), commit = remote.commitOperation
    remote.commitOperation = async (...args) => { const ack = await commit(...args); started.resolve(); await gate.promise; return ack }
    const before = (await storage.read(owner.ownerKey)).state, first = edit(before, { targetW: 80 })
    await bridge.recordChange({ previous: before, next: first, scheduleRemote: false })
    const sending = bridge.syncNow(); await started.promise
    const second = edit(first, { restSec: 71 }, 200)
    await bridge.recordChange({ previous: first, next: second, scheduleRemote: false })
    const [oldOp, newOp] = (await storage.read(owner.ownerKey)).pendingOperations.map(x => x.opId)
    const snapshots = [], save = storage.commit
    storage.commit = async (...args) => { const result = await save(...args); snapshots.push(result); return result }
    remote.replaceProfile(profile(edit(first, { targetW: 90 }, 300), 5))
    await settle()
    expect((await storage.read(owner.ownerKey)).remoteMetadataByPath['settings/targetW'].ackRevision).toBe(5)
    gate.resolve(); await sending
    const final = await storage.read(owner.ownerKey)
    expect(snapshots.some(x => !x.pendingOperations.some(op => op.opId === oldOp) && x.pendingOperations.map(op => op.opId).join() === newOp)).toBe(true)
    expect(final.state).toMatchObject({ targetW: 90, restSec: 71 })
    expect(final.lastConfirmedControl.dataRevision).toBeGreaterThanOrEqual(5)
    expect(final.remoteMetadataByPath['settings/targetW'].ackRevision).toBeGreaterThanOrEqual(5)
  })

  it('ignores old account responses, old auth epochs and callbacks after unbind', async () => {
    const { bridge, storage, remote, states } = setup()
    await bind(bridge); await bridge.syncNow()
    remote.delayCallbacks()
    remote.replaceProfile(profile(edit(fixtureState(), { targetW: 90 }), 1))
    const b = makeOwner('demo-opengym', 'b')
    await bridge.bindAuth({ owner: b, user: { uid: 'b' }, authEpoch: 2 })
    const length = states.length
    remote.deliverCallbacks(); await settle()
    await expect(bind(bridge)).rejects.toMatchObject({ code: 'stale-auth-epoch' })
    expect(states.slice(length).every(x => x.envelope.ownerKey === b.ownerKey)).toBe(true)
    await bridge.unbindAuth(); const stopped = states.length
    remote.deliverCallbacks(); await settle(); expect(states).toHaveLength(stopped)
    expect((await storage.read(b.ownerKey))?.state.targetW).not.toBe(90)
  })

  it('requires persisted guest choice after reload and keep retains the exact recoverable copy', async () => {
    const guest = makeOwner(owner.projectId), guestState = edit(fixtureState(), { targetW: 92 })
    const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, guestState) })
    const { bridge, remote } = setup(storage)
    await bind(bridge); await bridge.syncNow()
    expect((await storage.read(owner.ownerKey)).adoptionDecision.status).toBe('pending')
    const next = edit((await storage.read(owner.ownerKey)).state, { restSec: 90 }, 200)
    await bridge.recordChange({ previous: (await storage.read(owner.ownerKey)).state, next })
    expect(remote.transactions).toHaveLength(0)
    const reload = setup(storage, remote).bridge
    await bind(reload); await reload.syncNow(); expect(remote.transactions).toHaveLength(0)
    await reload.resolveAdoption('keep'); await reload.syncNow()
    expect((await storage.read(owner.ownerKey)).recoveryCopies.some(x => x.state.targetW === 92)).toBe(true)
    expect((await remote.readProfileFromServer(owner)).documents['settings/targetW'].payload.value).not.toBe(92)
  })

  it('merges two bridges sharing storage without losing operations or the running workout', async () => {
    const storage = fakeStorage(), a = setup(storage).bridge, b = setup(storage).bridge
    await a.hydrate(owner); await b.hydrate(owner)
    const before = fixtureState()
    await Promise.all([a.recordChange({ previous: before, next: edit(before, { targetW: 80, active: { id: 'run' } }) }), b.recordChange({ previous: before, next: edit(before, { restSec: 77 }, 200) })])
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state).toMatchObject({ targetW: 80, restSec: 77, active: { id: 'run' } })
    expect(saved.pendingOperations).toHaveLength(2)
  })

  it('does not erase local data on a server/cache failure or reassign old generation operations', async () => {
    const old = makeEnvelope(owner, edit(fixtureState(), { targetW: 84 }))
    old.lastConfirmedControl = control
    old.pendingOperations = [codec.prepareOperation(fixtureState(), old.state, { ownerKey: owner.ownerKey, opId: 'old', kind: 'edit', generation: 1, unitVersion: 1 })]
    const remote = fakeRemote(profile(fixtureState(), 2, 2)), { bridge, storage } = setup(fakeStorage({ [owner.ownerKey]: old }), remote)
    remote.failNext(Object.assign(new Error('cache'), { code: 'server-required' }))
    await bind(bridge); await settle()
    expect((await storage.read(owner.ownerKey)).state.targetW).toBe(84)
    await bridge.syncNow()
    const saved = await storage.read(owner.ownerKey)
    expect(saved.recoveryCopies.some(x => x.pendingOperations?.[0]?.opId === 'old')).toBe(true)
    expect(remote.transactions).toHaveLength(0)
  })

  it('retries transient failures at 1/2/4/8/16/30 seconds capped and restarts on foreground/online', async () => {
    vi.useFakeTimers()
    const { bridge, remote, statuses } = setup()
    let reads = 0
    remote.readProfileFromServer = async () => { reads++; throw Object.assign(new Error('offline'), { code: 'unavailable' }) }
    await bind(bridge); await settle()
    expect(reads).toBe(1)
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = reads
      await vi.advanceTimersByTimeAsync(delay - 1); expect(reads).toBe(before)
      await vi.advanceTimersByTimeAsync(1); expect(reads).toBe(before + 1)
    }
    const before = reads
    await bridge.onForeground(); expect(reads).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(1000); expect(reads).toBe(before + 2)
    await bridge.onOnline(); expect(reads).toBe(before + 3)
    expect(statuses.at(-1)).toMatchObject({ localReady: true, cloud: 'waiting', cloudError: { code: 'unavailable' } })
  })

  it('keeps permission failures blocked without a timer and permits explicit retry', async () => {
    vi.useFakeTimers()
    const { bridge, remote, storage, statuses } = setup()
    await bind(bridge); await bridge.syncNow()
    const before = (await storage.read(owner.ownerKey)).state
    await bridge.recordChange({ previous: before, next: edit(before, { targetW: 83 }), scheduleRemote: false })
    remote.failNext(Object.assign(new Error('permission'), { code: 'permission-denied' }))
    await bridge.syncNow()
    expect(statuses.at(-1)).toMatchObject({ local: 'saved', cloud: 'blocked', cloudError: { code: 'permission-denied' } })
    expect(bridge.getUnsynced()).toEqual({ count: 1, blocked: 1 })
    await vi.advanceTimersByTimeAsync(60000); expect(remote.transactions).toHaveLength(0)
    await bridge.syncNow()
    expect((await storage.read(owner.ownerKey)).pendingOperations).toEqual([])
  })

  it('replays an upload after local ACK storage failure without duplicate remote revision', async () => {
    const { bridge, storage, remote, statuses } = setup()
    remote.watchControl = () => () => {}
    await bind(bridge); await bridge.syncNow()
    const before = (await storage.read(owner.ownerKey)).state
    await bridge.recordChange({ previous: before, next: edit(before, { targetW: 87 }), scheduleRemote: false })
    const commit = remote.commitOperation
    let once = true
    remote.commitOperation = async (...args) => {
      const ack = await commit(...args)
      if (once) { once = false; storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' })) }
      return ack
    }
    await bridge.syncNow()
    expect(statuses.at(-1).local).toBe('error')
    expect(statuses.at(-1).cloudError).toBeNull()
    expect((await storage.read(owner.ownerKey)).pendingOperations).toHaveLength(1)
    await bridge.syncNow()
    expect((await storage.read(owner.ownerKey)).pendingOperations).toEqual([])
    expect((await remote.readProfileFromServer(owner)).control.dataRevision).toBe(1)
    expect(statuses.at(-1)).toMatchObject({ local: 'saved', cloud: 'synced' })
  })

  it('rejects a completed upload from the old auth epoch without touching either owner queue', async () => {
    const { bridge, remote, storage, states } = setup()
    await bind(bridge); await bridge.syncNow()
    const before = (await storage.read(owner.ownerKey)).state
    await bridge.recordChange({ previous: before, next: edit(before, { targetW: 82 }), scheduleRemote: false })
    const gate = deferred(), started = deferred(), commit = remote.commitOperation
    remote.commitOperation = async (...args) => { const ack = await commit(...args); started.resolve(); await gate.promise; return ack }
    const sending = bridge.syncNow(); await started.promise
    const b = makeOwner(owner.projectId, 'b')
    await bridge.bindAuth({ owner: b, user: { uid: 'b' }, authEpoch: 2 })
    const count = states.length
    gate.resolve(); await sending; await settle()
    expect((await storage.read(owner.ownerKey)).pendingOperations).toHaveLength(1)
    expect(states.slice(count).every(x => x.envelope.ownerKey === b.ownerKey)).toBe(true)
  })

  it('adds guest data only after explicit choice, preserving the source and account ownership', async () => {
    const guest = makeOwner(owner.projectId), source = edit(fixtureState(), { targetW: 93 })
    const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, source) })
    const { bridge, remote } = setup(storage)
    await bind(bridge); await bridge.syncNow()
    expect(remote.transactions).toHaveLength(0)
    await bridge.resolveAdoption('add')
    expect((await remote.readProfileFromServer(owner)).documents['settings/targetW'].payload.value).toBe(93)
    expect((await storage.read(guest.ownerKey)).state).toEqual(source)
    expect((await storage.read(owner.ownerKey)).adoptionDecision.status).toBe('add')
  })

  it('keeps local media and active edits durable without emitting domain operations', async () => {
    const before = fixtureState({ customEx: [{ id: 'custom', n: 'Custom', media: { hash: 'one' } }] })
    const storage = fakeStorage({ [owner.ownerKey]: makeEnvelope(owner, before) }), { bridge } = setup(storage)
    await bridge.hydrate(owner)
    const next = edit(before, { active: { id: 'run' }, customEx: [{ ...before.customEx[0], media: { hash: 'two' } }] })
    await bridge.recordChange({ previous: before, next })
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state.active.id).toBe('run')
    expect(saved.state.customEx[0].media.hash).toBe('two')
    expect(saved.pendingOperations).toEqual([])
  })

  it('exposes oversized record identity and retains the full recoverable record', async () => {
    const { bridge, storage, statuses } = setup()
    await bind(bridge); await bridge.syncNow()
    const before = (await storage.read(owner.ownerKey)).state
    const next = edit(before, { customEx: [{ id: 'large', n: 'x'.repeat(930000) }] })
    await bridge.recordChange({ previous: before, next, scheduleRemote: false }); await bridge.syncNow()
    expect(statuses.at(-1).cloudError).toMatchObject({ code: 'document-too-large', path: 'customExercises/bGFyZ2U' })
    expect((await storage.read(owner.ownerKey)).state.customEx[0].n).toHaveLength(930000)
    expect(bridge.getUnsynced()).toEqual({ count: 1, blocked: 1 })
  })

  it('reconciles duplicate ACKs from two bridges after newer watch data and local intent', async () => {
    const storage = fakeStorage(), remote = fakeRemote(profile())
    const a = setup(storage, remote).bridge, b = setup(storage, remote).bridge
    await bind(a); await a.syncNow(); await bind(b); await b.syncNow()
    const before = (await storage.read(owner.ownerKey)).state, first = edit(before, { targetW: 80 })
    await a.recordChange({ previous: before, next: first, scheduleRemote: false })
    const gate = deferred(), started = deferred(), original = remote.commitOperation
    let calls = 0
    remote.commitOperation = async (...args) => {
      const ack = await original(...args)
      if (++calls <= 2) { if (calls === 2) started.resolve(); await gate.promise }
      return ack
    }
    const sendingA = a.syncNow(), sendingB = b.syncNow()
    await started.promise
    await a.recordChange({ previous: first, next: edit(first, { restSec: 72 }, 200), scheduleRemote: false })
    remote.replaceProfile(profile(edit(first, { targetW: 94 }, 300), 5))
    await settle(); gate.resolve(); await Promise.all([sendingA, sendingB])
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state).toMatchObject({ targetW: 94, restSec: 72 })
    expect(saved.pendingOperations).toEqual([])
    expect(saved.lastConfirmedControl.dataRevision).toBe(6)
    expect(saved.remoteMetadataByPath['settings/targetW'].record.payload.value).toBe(94)
  })

  it('retains expired-token pending intent and manually resumes after authentication recovers', async () => {
    const { bridge, remote, storage, statuses } = setup()
    await bind(bridge); await bridge.syncNow()
    const before = (await storage.read(owner.ownerKey)).state
    await bridge.recordChange({ previous: before, next: edit(before, { targetW: 86 }), scheduleRemote: false })
    remote.failNext(Object.assign(new Error('token'), { code: 'auth/user-token-expired' }))
    await bridge.syncNow()
    expect(statuses.at(-1)).toMatchObject({ cloud: 'auth-required', local: 'saved' })
    expect((await storage.read(owner.ownerKey)).pendingOperations).toHaveLength(1)
    await bridge.syncNow(); expect((await storage.read(owner.ownerKey)).pendingOperations).toEqual([])
  })

  it('rejects an empty cache profile and keeps its null generation operation untouched', async () => {
    const { bridge, storage, remote, statuses } = setup()
    await bridge.hydrate(owner)
    await bridge.recordChange({ previous: fixtureState(), next: edit(fixtureState(), { targetW: 99 }) })
    remote.readProfileFromServer = async () => ({ ...profile(fixtureState()), fromCache: true })
    await bind(bridge); await bridge.syncNow()
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state.targetW).toBe(99)
    expect(saved.pendingOperations[0].generation).toBeNull()
    expect(saved.lastConfirmedControl).toBeNull()
    expect(statuses.at(-1).cloud).toBe('waiting')
  })

  it('captures caller owner and user values before the first asynchronous boundary', async () => {
    const { bridge, states } = setup(), suppliedOwner = { ...owner }, suppliedUser = { uid: owner.uid }
    const binding = bridge.bindAuth({ owner: suppliedOwner, user: suppliedUser, authEpoch: 1 })
    Object.assign(suppliedOwner, makeOwner(owner.projectId, 'b')); suppliedUser.uid = 'b'
    await binding; await bridge.syncNow()
    expect(states.every(x => x.envelope.ownerKey === owner.ownerKey)).toBe(true)
  })

  it('flush alone retries an unsaved memory draft and never marks it saved before commit', async () => {
    const { bridge, storage, statuses } = setup()
    await bridge.hydrate(owner)
    storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' }))
    await expect(bridge.recordChange({ previous: fixtureState(), next: edit(fixtureState(), { targetW: 95 }) })).rejects.toMatchObject({ code: 'storage-full' })
    expect(await storage.read(owner.ownerKey)).toBeNull()
    expect(statuses.at(-1).local).toBe('error')
    await bridge.flushLocal()
    expect((await storage.read(owner.ownerKey)).state.targetW).toBe(95)
    expect(statuses.at(-1).local).toBe('saved')
  })

  it('cancels a previously scheduled network retry when a permanent failure replaces it', async () => {
    vi.useFakeTimers()
    const { bridge, remote } = setup()
    let reads = 0, code = 'unavailable'
    remote.readProfileFromServer = async () => { reads++; throw Object.assign(new Error(code), { code }) }
    await bind(bridge); await settle(); expect(reads).toBe(1)
    code = 'permission-denied'
    await bridge.recordChange({ previous: fixtureState(), next: edit(fixtureState(), { targetW: 89 }) })
    await settle(); expect(reads).toBe(2)
    await vi.advanceTimersByTimeAsync(60000); expect(reads).toBe(2)
  })

  it('rebases unknown generation only, retaining a prior unit version for explicit reconciliation', async () => {
    const remoteProfile = profile(); remoteProfile.control.unitVersion = 2
    const { bridge, storage } = setup(fakeStorage(), fakeRemote(remoteProfile))
    await bridge.hydrate(owner)
    await bridge.recordChange({ previous: fixtureState(), next: edit(fixtureState(), { targetW: 89 }) })
    await bind(bridge); await bridge.syncNow()
    const saved = await storage.read(owner.ownerKey)
    expect(saved.pendingOperations).toHaveLength(1)
    expect(saved.pendingOperations[0]).toMatchObject({ generation: 1, unitVersion: 1 })
    expect(saved.state.targetW).toBe(89)
  })

  it('reinstalls a terminated watch on manual recovery and receives subsequent peer changes', async () => {
    const { bridge, remote, storage } = setup()
    const watch = remote.watchControl
    let terminate
    remote.watchControl = (capturedOwner, changed, failed) => {
      const stop = watch(capturedOwner, changed, failed)
      terminate = () => { stop(); failed(Object.assign(new Error('denied'), { code: 'permission-denied' })) }
      return stop
    }
    await bind(bridge); await bridge.syncNow()
    terminate(); await bridge.syncNow()
    remote.replaceProfile(profile(edit(fixtureState(), { targetW: 98 }), 1))
    await settle()
    expect((await storage.read(owner.ownerKey)).state.targetW).toBe(98)
  })

  it('blocks edits until hydration completes and exposes local state while the server is still pending', async () => {
    const saved = makeEnvelope(owner, edit(fixtureState(), { targetW: 97 }))
    const { bridge, storage, remote, states, statuses } = setup(fakeStorage({ [owner.ownerKey]: saved }))
    const localGate = deferred(), cloudGate = deferred()
    storage.open = () => localGate.promise
    remote.readProfileFromServer = () => cloudGate.promise
    const binding = bind(bridge)
    await expect(bridge.recordChange({ previous: fixtureState(), next: fixtureState() })).rejects.toMatchObject({ code: 'local-not-ready' })
    expect(states).toHaveLength(0)
    localGate.resolve(); await binding
    expect(states.at(-1).state.targetW).toBe(97)
    expect(statuses.at(-1).localReady).toBe(true)
    await bridge.unbindAuth()
    cloudGate.resolve(profile()); await settle()
  })

  it.each([false, true])('preserves failed pre-initialization intent when server proof arrives before retry (reset=%s)', async reset => {
    const { bridge, storage, remote } = setup()
    const gate = deferred(), started = deferred(), read = remote.readProfileFromServer
    let first = true
    remote.readProfileFromServer = async captured => {
      if (first) { first = false; started.resolve(); await gate.promise }
      return read(captured)
    }
    await bind(bridge); await started.promise
    storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' }))
    await expect(bridge.recordChange({ previous: fixtureState(), next: edit(fixtureState(), { targetW: 96 }) })).rejects.toMatchObject({ code: 'storage-full' })
    gate.resolve(); await settle()
    expect((await storage.read(owner.ownerKey)).lastConfirmedControl.generation).toBe(1)
    if (reset) { remote.replaceProfile(profile(fixtureState(), 2, 2)); await settle() }
    await bridge.flushLocal(); await bridge.syncNow()
    const saved = await storage.read(owner.ownerKey), server = await read(owner)
    if (reset) {
      expect(saved.recoveryCopies.some(x => x.state.targetW === 96 && x.pendingOperations?.[0]?.generation === 1)).toBe(true)
      expect(server.documents['settings/targetW'].payload.value).not.toBe(96)
    } else {
      expect(saved.state.targetW).toBe(96)
      expect(server.documents['settings/targetW'].payload.value).toBe(96)
    }
  })
})
