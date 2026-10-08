import { describe, expect, it } from 'vitest'
import { createOfflineStorage } from './offline-store.js'
import { fakeFilesystem, fakeIndexedDB, fakeStorage, fixtureEnvelope } from './test-fixtures.js'
const key = fixtureEnvelope().ownerKey
const backends = [
  ['IndexedDB', () => createOfflineStorage({ indexedDB: fakeIndexedDB(), broadcast: null })],
  ['Filesystem', () => createOfflineStorage({ mobile: true, ...fakeFilesystem() })],
  ['test storage', () => fakeStorage()],
]
describe.each(backends)('%s contract', (_, create) => {
  it('keeps all fields atomically and owns revisions independently of reducer values', async () => {
    const storage = create(), envelope = fixtureEnvelope({ localRevision: 50, pendingOperations: [{ ownerKey: key, opId: 'one' }], pendingJobs: [{ ownerKey: key, jobId: 'job' }], remoteMetadataByPath: { path: { record: { payload: { data: 1 } }, ackRevision: 3 } }, adoptionDecision: 'keep', recoveryCopies: [{ state: { workouts: [{ id: 'recovery' }] } }], lastConfirmedControl: { generation: 1 } })
    const saved = await storage.commit(key, () => envelope)
    expect(saved.localRevision).toBe(1)
    envelope.state.unit = 'lb'; saved.pendingOperations.length = 0
    const reloaded = await storage.read(key)
    expect(reloaded.state.unit).toBe('kg')
    expect(reloaded.pendingOperations.map(o => o.opId)).toEqual(['one'])
    expect(reloaded.pendingJobs[0].jobId).toBe('job')
    expect(reloaded.remoteMetadataByPath.path.ackRevision).toBe(3)
    expect(reloaded.adoptionDecision).toBe('keep')
    expect(reloaded.recoveryCopies[0].state.workouts[0].id).toBe('recovery')
    expect(reloaded.lastConfirmedControl.generation).toBe(1)
  })
  it('rejects asynchronous/missing reducers and foreign queued owners without changing saved state', async () => {
    const storage = create()
    await storage.commit(key, () => fixtureEnvelope())
    await expect(storage.commit(key, null)).rejects.toMatchObject({ code: 'invalid-reducer' })
    await expect(storage.commit(key, async current => current)).rejects.toMatchObject({ code: 'invalid-reducer' })
    await expect(storage.commit(key, current => ({ ...current, pendingOperations: [{ ownerKey: 'wrong', opId: 'bad' }] }))).rejects.toMatchObject({ code: 'owner-mismatch' })
    expect((await storage.read(key)).localRevision).toBe(1)
  })
  it('rejects data JSON would silently alter and surfaces reducer failures', async () => {
    const storage = create()
    for (const value of [undefined, Infinity, new Date()]) await expect(storage.commit(key, () => fixtureEnvelope({ state: { lost: value } }))).rejects.toMatchObject({ code: 'invalid-envelope' })
    await expect(storage.commit(key, () => { throw Object.assign(new Error('domain-failed'), { code: 'domain-failed' }) })).rejects.toMatchObject({ code: 'domain-failed' })
    expect(await storage.read(key)).toBeNull()
  })
  it('flush waits for writes already issued and subscriber failures never invalidate them', async () => {
    const storage = create(), revisions = []
    storage.subscribe(key, () => { throw new Error('observer') })
    const unsubscribe = storage.subscribe(key, revision => revisions.push(revision))
    const write = storage.commit(key, () => fixtureEnvelope())
    await storage.flush(key); await write
    expect((await storage.read(key)).localRevision).toBe(1)
    unsubscribe()
    await storage.commit(key, current => current)
    expect(revisions).toEqual([1])
  })
})

it('storage fixture rejects future-schema reads and logs only serialized confirmed revisions', async () => {
  const future = fakeStorage({ [key]: fixtureEnvelope({ schemaVersion: 2 }) })
  await expect(future.read(key)).rejects.toMatchObject({ code: 'unsupported-schema' })
  const storage = fakeStorage()
  storage.failNextCommit(Object.assign(new Error('full'), { code: 'storage-full' }))
  await expect(storage.commit(key, () => fixtureEnvelope())).rejects.toMatchObject({ code: 'storage-full' })
  await Promise.all([storage.commit(key, () => fixtureEnvelope()), storage.commit(key, current => current)])
  expect(storage.confirmedRevisions).toEqual([{ ownerKey: key, localRevision: 1 }, { ownerKey: key, localRevision: 2 }])
})
