import { describe, expect, it, vi } from 'vitest'
import { createIdbStorage } from './offline-idb.js'
import { fakeIndexedDB, fixtureEnvelope } from './test-fixtures.js'
const key = fixtureEnvelope().ownerKey
const add = id => current => ({ ...(current || fixtureEnvelope()), state: { ...(current || fixtureEnvelope()).state, workouts: [...(current?.state.workouts || []), { id }] }, pendingOperations: [...(current?.pendingOperations || []), { opId: 'op-' + id, ownerKey: key }] })
describe('atomic IndexedDB storage', () => {
  it('reloads state and queue after concurrent connections commit from the latest revision', async () => {
    const indexedDB = fakeIndexedDB()
    const a = createIdbStorage({ indexedDB, broadcast: null }), b = createIdbStorage({ indexedDB, broadcast: null })
    await Promise.all([a.commit(key, add('a')), b.commit(key, add('b'))])
    const saved = await createIdbStorage({ indexedDB, broadcast: null }).read(key)
    expect(saved.localRevision).toBe(2)
    expect(saved.state.workouts.map(w => w.id)).toEqual(['a', 'b'])
    expect(saved.pendingOperations.map(o => o.opId)).toEqual(['op-a', 'op-b'])
  })
  it('never announces or retains an aborted revision and reports quota to commit and flush', async () => {
    const indexedDB = fakeIndexedDB(), s = createIdbStorage({ indexedDB, broadcast: null }), listener = vi.fn()
    s.subscribe(key, listener)
    await s.commit(key, add('a')); listener.mockClear()
    indexedDB.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }))
    await expect(s.commit(key, add('b'))).rejects.toMatchObject({ code: 'storage-full' })
    await expect(s.flush(key)).rejects.toMatchObject({ code: 'storage-full' })
    expect(listener).not.toHaveBeenCalled()
    expect((await s.read(key)).state.workouts.map(w => w.id)).toEqual(['a'])
    await s.commit(key, add('c')); await s.flush(key)
  })
  it('rejects future schemas and owner substitution without changing the saved envelope', async () => {
    const indexedDB = fakeIndexedDB(), s = createIdbStorage({ indexedDB, broadcast: null })
    indexedDB.rows.set(key, fixtureEnvelope({ schemaVersion: 2 }))
    await expect(s.commit(key, add('a'))).rejects.toMatchObject({ code: 'unsupported-schema' })
    expect(indexedDB.rows.get(key).schemaVersion).toBe(2)
    indexedDB.rows.clear()
    await expect(s.commit(key, () => fixtureEnvelope({ ownerKey: 'other' }))).rejects.toMatchObject({ code: 'owner-mismatch' })
    await expect(s.commit(key, async () => fixtureEnvelope())).rejects.toMatchObject({ code: 'invalid-reducer' })
    expect(await s.read(key)).toBeNull()
  })
  it('publishes durable revisions only and re-reads messages rather than trusting their contents', async () => {
    const indexedDB = fakeIndexedDB(), listeners = new Set()
    const broadcast = { addEventListener(_, fn) { listeners.add(fn) }, postMessage(data) { for (const fn of listeners) fn({ data }) } }
    const a = createIdbStorage({ indexedDB, broadcast }), b = createIdbStorage({ indexedDB, broadcast }), changes = []
    await b.open(); b.subscribe(key, revision => changes.push(revision))
    await a.commit(key, add('a'))
    await new Promise(r => setTimeout(r, 35))
    expect(changes).toContain(1)
    broadcast.postMessage({ ownerKey: key, localRevision: 99 })
    await new Promise(r => setTimeout(r, 35))
    expect(changes).not.toContain(99)
  })
})
