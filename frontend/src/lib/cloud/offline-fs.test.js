import { describe, expect, it, vi } from 'vitest'
import { createFsStorage } from './offline-fs.js'
import { fakeFilesystem, fixtureEnvelope } from './test-fixtures.js'
import { sha256Hex } from '../sha256.js'
const key = fixtureEnvelope().ownerKey
const save = n => current => ({ ...(current || fixtureEnvelope()), state: { ...fixtureEnvelope().state, workouts: [{ id: String(n) }] }, pendingOperations: [{ opId: 'op-' + n, ownerKey: key }] })
describe('native two slot storage', () => {
  it('confirms complete envelopes and restores the previous revision after a torn newer slot', async () => {
    const fs = fakeFilesystem(), s = createFsStorage(fs)
    for (let i = 1; i <= 8; i++) await s.commit(key, save(i))
    const slots = [...fs.files.entries()]
    const latest = slots.find(([, raw]) => JSON.parse(raw).envelope.localRevision === 8)[0]
    fs.files.set(latest, '{torn')
    const recovered = await createFsStorage(fs).read(key)
    expect(recovered.localRevision).toBe(7)
    expect(recovered.state.workouts).toEqual([{ id: '7' }])
    expect(recovered.pendingOperations.map(o => o.opId)).toEqual(['op-7'])
  })
  it('rejects write and readback failures without publishing saved status', async () => {
    const fs = fakeFilesystem(), s = createFsStorage(fs), changes = vi.fn()
    s.subscribe(key, changes); await s.commit(key, save(1)); changes.mockClear()
    fs.failNextWrite(Object.assign(new Error('no space'), { code: 'ENOSPC' }))
    await expect(s.commit(key, save(2))).rejects.toMatchObject({ code: 'storage-full' })
    await expect(s.flush(key)).rejects.toMatchObject({ code: 'storage-full' })
    fs.transformNextWrite(raw => { const slot = JSON.parse(raw); slot.envelope.pendingOperations = []; return JSON.stringify(slot) })
    await expect(s.commit(key, save(2))).rejects.toMatchObject({ code: 'storage-corrupt' })
    expect(changes).not.toHaveBeenCalled()
    expect((await createFsStorage(fs).read(key)).localRevision).toBe(1)
  })
  it('does not overwrite a future schema slot by falling back to an older supported one', async () => {
    const fs = fakeFilesystem(), s = createFsStorage(fs)
    await s.commit(key, save(1)); await s.commit(key, save(2))
    const [path, raw] = [...fs.files.entries()].find(([, data]) => JSON.parse(data).envelope.localRevision === 2)
    const slot = JSON.parse(raw); slot.envelope.schemaVersion = 2
    slot.checksum = await sha256Hex(new TextEncoder().encode(JSON.stringify(slot.envelope)))
    fs.files.set(path, JSON.stringify(slot))
    const before = [...fs.files.entries()]
    await expect(createFsStorage(fs).read(key)).rejects.toMatchObject({ code: 'unsupported-schema' })
    await expect(s.commit(key, save(3))).rejects.toMatchObject({ code: 'unsupported-schema' })
    expect([...fs.files.entries()]).toEqual(before)
  })
  it('uses safe distinct owner directories and serializes simultaneous instances', async () => {
    const fs = fakeFilesystem(), a = createFsStorage(fs), b = createFsStorage(fs)
    const add = id => current => ({ ...(current || fixtureEnvelope()), state: { ...fixtureEnvelope().state, workouts: [...(current?.state.workouts || []), { id }] } })
    await Promise.all([a.commit(key, add('a')), b.commit(key, add('b'))])
    expect((await a.read(key)).state.workouts).toEqual([{ id: 'a' }, { id: 'b' }])
    const other = JSON.stringify(['another-project', 'apps/opengym', null])
    await a.commit(other, () => fixtureEnvelope({ ownerKey: other }))
    const dirs = [...new Set([...fs.files.keys()].map(p => p.split('/').slice(0, -1).join('/')))]
    expect(dirs).toHaveLength(2)
    expect(dirs.every(p => /^opengym-offline\/[a-f0-9]{64}$/.test(p))).toBe(true)
  })
})

it('reports open failure rather than silently substituting memory storage', async () => {
  const s = createFsStorage({ loadFilesystem() { throw new Error('no plugin') } })
  await expect(s.open()).rejects.toMatchObject({ code: 'storage-unavailable' })
})

it('never treats unreadable slots as missing or confirms a valid but wrong readback', async () => {
  const fs = fakeFilesystem(), s = createFsStorage(fs)
  await s.commit(key, save(1))
  const original = [...fs.files.values()][0]
  fs.transformNextWrite(() => original)
  await expect(s.commit(key, save(2))).rejects.toMatchObject({ code: 'storage-corrupt' })
  fs.mod.Filesystem.readFile = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
  await expect(s.read(key)).rejects.toMatchObject({ code: 'EACCES' })
  await expect(s.commit(key, save(3))).rejects.toMatchObject({ code: 'EACCES' })
})

it('exposes both validated recovery envelopes for media retention and never hides future evidence', async () => {
  const fs = fakeFilesystem(), s = createFsStorage(fs)
  await s.commit(key, () => fixtureEnvelope({ state: { ...fixtureEnvelope().state, workouts: [{ id: 'old', media: [{ hash: 'retained-photo' }] }] } }))
  await s.commit(key, current => ({ ...current, state: { ...current.state, workouts: [] } }))
  const reopened = createFsStorage(fs)
  const recovery = await reopened.readRecoveryEnvelopes(key)
  expect(recovery.map(e => e.localRevision)).toEqual([2, 1])
  expect(recovery[1].state.workouts[0].media[0].hash).toBe('retained-photo')
  recovery[1].state.workouts.length = 0
  expect((await reopened.readRecoveryEnvelopes(key))[1].state.workouts).toHaveLength(1)
  const latest = [...fs.files.keys()].find(p => JSON.parse(fs.files.get(p)).envelope.localRevision === 2)
  fs.files.set(latest, '{torn')
  expect((await reopened.read(key)).localRevision).toBe(1)
  await expect(reopened.readRecoveryEnvelopes(key)).rejects.toMatchObject({ code: 'storage-corrupt' })
  fs.files.set(latest, JSON.stringify({ envelope: { schemaVersion: 2 } }))
  await expect(reopened.readRecoveryEnvelopes(key)).rejects.toMatchObject({ code: 'unsupported-schema' })
})

it('compares the entire readback even if a wrong queue has a valid checksum and revision', async () => {
  const fs = fakeFilesystem(), s = createFsStorage(fs)
  await s.commit(key, save(1))
  const wrong = { ...save(2)(null), localRevision: 2, pendingOperations: [] }
  const checksum = await sha256Hex(new TextEncoder().encode(JSON.stringify(wrong)))
  fs.transformNextWrite(() => JSON.stringify({ envelope: wrong, checksum }))
  await expect(s.commit(key, save(2))).rejects.toMatchObject({ code: 'storage-corrupt' })
})
