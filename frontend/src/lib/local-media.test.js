import { describe, it, expect, afterEach, vi } from 'vitest'
import { getMediaStore, _setMediaStore, createMediaStore, memoryBackend } from './media-store.js'
import * as local from './local-media.js'
import { runtime, deferred, owner } from '../store/cloud-test-runtime.js'
import { createFsStorage } from './cloud/offline-fs.js'
import { fakeFilesystem } from './cloud/test-fixtures.js'
const h = 'a'.repeat(64)
const ref = { kind: 'image', hash: h, mime: 'image/jpeg', size: 3, width: 1, height: 1, at: 1 }
afterEach(() => _setMediaStore(null))
describe('account local media', () => {
  it('isolates local association, byte reads and URLs across owners', async () => {
    const a = getMediaStore(owner('A').ownerKey), b = getMediaStore(owner('B').ownerKey)
    await a.put(h, new Blob(['abc']), { mime: 'image/jpeg' })
    expect(await b.has(h)).toBe(false)
    expect(await b.get(h)).toBeNull()
    expect(await b.url(h)).toBeNull()
    expect(await b.list()).toEqual([])
    expect((await a.get(h)).pending).toBe(false)
  })
  it('never resolves a late capture after A to B to A or before hydration', async () => {
    const rt = await runtime(); await rt.auth('A')
    expect(typeof local.captureMediaContext).toBe('function')
    const captured = local.captureMediaContext(rt.store)
    await rt.auth('B'); await rt.auth('A')
    expect(captured.current()).toBe(false)
    rt.store.setState({ localReady: false })
    expect(local.captureMediaContext(rt.store)).toBeNull()
  })
  it('keeps a local-only photo through refresh and reload with no operation or cloud debt', async () => {
    const rt = await runtime({ cloud: true, profiles: { A: { workouts: [{ id: 'w', d: '2026-09-01', start: 1, end: 2, entries: [] }] } } })
    await rt.auth('A'); await rt.sync()
    rt.store.getState().update(s => { s.workouts[0].media = [ref] })
    await rt.store.getState().flushLocal()
    expect(rt.store.getState().unsyncedChanges().count).toBe(0)
    expect((await rt.saved()).pendingOperations).toEqual([])
    await rt.sync(); expect(rt.store.getState().S.workouts[0].media).toEqual([ref])
    const reload = await runtime({ storage: rt.storage }); await reload.auth('A')
    expect(reload.store.getState().S.workouts[0].media).toEqual([ref])
  })
  it('defers physical deletion through owner transitions and new draft references during inspection', async () => {
    const rt = await runtime(), wait = deferred()
    const media = createMediaStore(memoryBackend(), { now: () => 0 })
    _setMediaStore(media, rt.store.getState().ownerKey)
    await media.put(h, new Blob(['abc']), { mime: 'image/jpeg' })
    rt.storage.readRecoveryEnvelopes = async () => { await wait.promise; return [] }
    expect(typeof local.localMediaGc).toBe('function')
    const pending = local.localMediaGc(rt.store.getState().ownerKey, { appStore: rt.store })
    rt.store.getState().update(s => { s.workouts = [{ id: 'w', d: '2026-09-01', start: 1, end: 2, entries: [], media: [ref] }] })
    await rt.auth('B'); wait.resolve(); await pending
    expect(await media.has(h)).toBe(true)
  })
})


describe('retention snapshot and explicit recovery', () => {
  it('retains confirmed, current, native previous and source-attributed recovery references', async () => {
    const rt = await runtime({ initial: { workouts: [{ id: 'w', d: '2026-09-01', entries: [], media: [ref] }] } })
    const saved = await rt.saved(), sourceKey = owner('source').ownerKey
    const previous = { ...saved, state: { ...saved.state, customEx: [{ id: 'c', media: { ...ref, hash: 'b'.repeat(64) } }] }, recoveryCopies: [{ state: { workouts: [{ media: [{ ...ref, hash: 'c'.repeat(64) }] }] }, ownerKey: sourceKey }] }
    rt.storage.readRecoveryEnvelopes = async key => { expect(key).toBe(saved.ownerKey); return [previous] }
    const snapshot = await rt.store.getState().mediaRetentionSnapshot()
    expect(snapshot.sources.some(source => source.ownerKey === sourceKey && source.state.workouts[0].media[0].hash === 'c'.repeat(64))).toBe(true)
    expect(snapshot.sources.some(source => source.state.customEx?.[0]?.media.hash === 'b'.repeat(64))).toBe(true)
    rt.storage.readRecoveryEnvelopes = async () => { throw new Error('unreadable sibling') }
    await expect(rt.store.getState().mediaRetentionSnapshot()).rejects.toThrow('unreadable sibling')
  })
  it('copies only explicitly selected legacy references, keeps originals, and permits retry after local IO failure', async () => {
    const source = { sourceId: 'browser:gym_state_v1', state: { customEx: [{ id: 'c', n: 'Carry', bp: 'back', media: ref }], workouts: [] } }
    const rt = await runtime({ legacyReader: { read: async () => [source] } }); await rt.auth('A')
    const legacy = createMediaStore({ ...memoryBackend(), persistent: true }), target = createMediaStore({ ...memoryBackend(), persistent: true })
    _setMediaStore(legacy); _setMediaStore(target, rt.store.getState().ownerKey)
    await legacy.put(h, new Blob(['abc']), { mime: 'image/jpeg' })
    await legacy.put('b'.repeat(64), new Blob(['other']), { mime: 'image/jpeg' })
    expect(await target.has(h)).toBe(false)
    const id = rt.store.getState().listRecovery()[0].recoveryId
    const put = target.put; target.put = async () => { throw new Error('disk full') }
    await expect(rt.store.getState().resolveRecovery(id, 'add')).rejects.toThrow('disk full')
    expect(rt.store.getState().listRecovery()[0].decision).toBeUndefined()
    target.put = put
    await rt.store.getState().resolveRecovery(id, 'add')
    expect(await target.has(h)).toBe(true)
    expect(await target.has('b'.repeat(64))).toBe(false)
    expect(await legacy.has(h)).toBe(true)
    expect((await target.get(h)).pending).toBe(false)
  })
})

it('uses the selected native archive inspector and preserves its previous-slot photo', async () => {
  const native = fakeFilesystem(), storage = createFsStorage(native)
  const rt = await runtime({ storage })
  rt.store.getState().update(s => { s.workouts = [{ id: 'w', d: '2026-09-01', entries: [], media: [ref] }] }); await rt.store.getState().flushLocal()
  rt.store.getState().update(s => { delete s.workouts[0].media }); await rt.store.getState().flushLocal()
  const snapshot = await rt.store.getState().mediaRetentionSnapshot()
  expect(snapshot.sources.some(source => source.state.workouts[0]?.media?.[0]?.hash === h)).toBe(true)
  const path = [...native.files.keys()][0]
  native.files.set(path, '{corrupt')
  await expect(rt.store.getState().mediaRetentionSnapshot()).rejects.toThrow()
})

it('a foreign Firebase recovery source cannot grant byte access or an association', async () => {
  const source = { sourceId: 'native:opengym-state.json', ownerKey: owner('A').ownerKey, identityProvider: 'firebase', state: { workouts: [], customEx: [{ id: 'c', media: ref }] } }
  const rt = await runtime({ legacyReader: { read: async () => [source] } }); await rt.auth('B')
  const id = (await rt.saved()).recoveryCopies[0].recoveryId
  expect(rt.store.getState().listRecovery()).toEqual([])
  await expect(rt.store.getState().resolveRecovery(id, 'add')).rejects.toThrow('recovery-owner-mismatch')
  expect(await getMediaStore(owner('B').ownerKey).has(h)).toBe(false)
})

it('Keep does not open legacy media and missing files are counted without blocking training recovery', async () => {
  const source = { sourceId: 'browser:gym_state_v1', state: { workouts: [], customEx: [{ id: 'c', n: 'Carry', bp: 'back', media: ref }] } }
  const rt = await runtime({ legacyReader: { read: async () => [source] } }); await rt.auth('A')
  const legacy = createMediaStore({ ...memoryBackend(), persistent: true }), target = createMediaStore({ ...memoryBackend(), persistent: true })
  _setMediaStore(legacy); _setMediaStore(target, owner('A').ownerKey)
  const id = rt.store.getState().listRecovery()[0].recoveryId
  const read = legacy.get; legacy.get = async () => { throw new Error('IO') }
  await rt.store.getState().resolveRecovery(id, 'keep')
  await rt.auth('B')
  const targetB = createMediaStore({ ...memoryBackend(), persistent: true }); _setMediaStore(targetB, owner('B').ownerKey)
  const idB = rt.store.getState().listRecovery()[0].recoveryId
  await expect(rt.store.getState().resolveRecovery(idB, 'add')).rejects.toThrow('IO')
  legacy.get = read
  const result = await rt.store.getState().resolveRecovery(idB, 'add')
  expect(result.media).toEqual({ copied: 0, missing: 1 })
  expect(rt.store.getState().S.customEx[0].media).toEqual(ref)
})

it('recovery copy keeps partial A bytes but cannot admit into B after owner/epoch changes', async () => {
  const source = { sourceId: 'browser:gym_state_v1', state: { workouts: [], customEx: [{ id: 'c', n: 'Carry', bp: 'back', media: ref }] } }
  const rt = await runtime({ legacyReader: { read: async () => [source] } }); await rt.auth('A')
  const legacy = createMediaStore({ ...memoryBackend(), persistent: true }), target = createMediaStore({ ...memoryBackend(), persistent: true })
  _setMediaStore(legacy); _setMediaStore(target, owner('A').ownerKey)
  await legacy.put(h, new Blob(['abc']), { mime: 'image/jpeg' })
  const wait = deferred(), entered = deferred(), put = target.put
  target.put = async (...args) => { entered.resolve(); await wait.promise; return put(...args) }
  const pending = rt.store.getState().resolveRecovery(rt.store.getState().listRecovery()[0].recoveryId, 'add')
  const rejected = expect(pending).rejects.toThrow('stale-context')
  await entered.promise; await rt.auth('B'); await rt.auth('A'); wait.resolve(); await rejected
  expect(rt.store.getState().S.customEx).toEqual([])
  expect(await target.has(h)).toBe(true)
  expect(await legacy.has(h)).toBe(true)
  expect(await getMediaStore(owner('B').ownerKey).has(h)).toBe(false)
})

it('preserves old large originals, posters, held drafts and a peer put while GC awaits inspection', async () => {
  const rt = await runtime(), wait = deferred(), entered = deferred()
  const backend = memoryBackend(), media = createMediaStore(backend, { now: () => 0 }), peer = createMediaStore(backend)
  _setMediaStore(media, rt.store.getState().ownerKey)
  const hashes = ['a', 'b', 'c', 'd'].map(c => c.repeat(64))
  for (const hash of hashes) await media.put(hash, new Blob(['abc']), { mime: 'image/jpeg' })
  const release = media.hold([hashes[2]])
  rt.storage.readRecoveryEnvelopes = async () => { entered.resolve(); await wait.promise; return [] }
  const pending = local.localMediaGc(rt.store.getState().ownerKey, { appStore: rt.store })
  await entered.promise
  rt.store.getState().update(s => { s.workouts = [{ id: 'w', d: '2026-09-01', entries: [], media: [{ ...ref, size: 1024 * 1024 * 1024, poster: { hash: hashes[1], mime: 'image/jpeg', size: 3, width: 1, height: 1 } }] }] })
  await peer.put(hashes[3], new Blob(['abc']), { mime: 'image/jpeg' })
  wait.resolve(); await pending
  for (const hash of hashes) expect(await media.has(hash)).toBe(true)
  release()
})

it('explicit guest adoption copies all main/poster refs beyond the display cap, never legacy fallback', async () => {
  const refs = Array.from({ length: 8 }, (_, i) => ({ ...ref, hash: String(i + 1).padStart(64, '0'), poster: { hash: String(i + 21).padStart(64, '0'), mime: 'image/jpeg', size: 3, width: 1, height: 1 } }))
  const rt = await runtime({ cloud: true, initial: { workouts: [{ id: 'w', d: '2026-09-01', entries: [], media: refs }] } })
  const guest = createMediaStore({ ...memoryBackend(), persistent: true }), a = createMediaStore({ ...memoryBackend(), persistent: true })
  _setMediaStore(guest, owner().ownerKey); _setMediaStore(a, owner('A').ownerKey)
  for (const media of refs) for (const hash of [media.hash, media.poster.hash]) await guest.put(hash, new Blob(['abc']), { mime: 'image/jpeg' })
  await rt.auth('A')
  expect(await a.list()).toEqual([])
  expect(rt.store.getState().adoptionDecision.status).toBe('pending')
  const result = await rt.store.getState().resolveAdoption('add')
  expect(result.media).toEqual({ copied: 16, missing: 0 })
  expect(await a.list()).toHaveLength(16); expect(await guest.list()).toHaveLength(16)
  expect(rt.store.getState().S.workouts[0].media).toHaveLength(8)
})

it('unsubscribe cancels startup cleanup and waits for actual hydration', async () => {
  const rt = await runtime(), inspect = vi.spyOn(rt.store.getState(), 'mediaRetentionSnapshot')
  vi.useFakeTimers()
  try {
    rt.store.setState({ localReady: false })
    const stop = local.startLocalMedia({ appStore: rt.store })
    await vi.advanceTimersByTimeAsync(1001)
    expect(inspect).not.toHaveBeenCalled()
    rt.store.setState({ localReady: true }); stop()
    await vi.advanceTimersByTimeAsync(1001)
    expect(inspect).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
