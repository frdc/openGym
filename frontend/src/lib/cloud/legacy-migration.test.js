import { describe, expect, it, vi } from 'vitest'
import { migrateLegacy, prepareLegacyState, createLegacyReader } from './legacy-migration.js'
import { nativeLoadLegacyStrict } from '../mobile.js'
import { fakeStorage, fakeFilesystem, fixtureEnvelope, fixtureState } from './test-fixtures.js'
import { makeOwner } from './model.js'
const owner = makeOwner('demo-opengym', 'test-user')
const source = (extra = {}) => ({ sourceId: 'browser:gym_state_v1', state: fixtureState({ workouts: [{ d: '2026-09-01', start: 123, entries: [] }] }), ...extra })
const reader = item => ({ read: async () => [item], markComplete: vi.fn() })
describe('recoverable legacy migration', () => {
  it('adopts decided copies with stable IDs and repeats after marker interruption without modifying source', async () => {
    const original = source({ adoptForOwnerKey: owner.ownerKey }), before = structuredClone(original), legacyReader = reader(original), storage = fakeStorage()
    legacyReader.markComplete.mockRejectedValueOnce(new Error('interrupted'))
    await expect(migrateLegacy({ storage, legacyReader, owner })).rejects.toThrow('interrupted')
    const saved = await storage.read(owner.ownerKey)
    expect(saved.state.workouts[0].id).toMatch(/^legacy-[a-f0-9]{64}$/)
    expect(original).toEqual(before)
    const again = await migrateLegacy({ storage, legacyReader, owner })
    expect(again.envelope.state.workouts).toEqual(saved.state.workouts)
    expect(again.envelope.recoveryCopies).toHaveLength(1)
    expect(again.envelope.pendingOperations).toEqual([])
  })
  it('does not treat matching Node UID as Firebase proof', async () => {
    const result = await migrateLegacy({ storage: fakeStorage(), legacyReader: reader(source({ ownerKey: owner.ownerKey, identityProvider: 'node' })), owner })
    expect(result.envelope.state.workouts).toEqual([])
    expect(result.recoveryCopies[0]).toMatchObject({ sourceId: 'browser:gym_state_v1', status: 'pending', reason: 'unproven-owner' })
    expect(result.recoveryCopies[0].state.workouts).toHaveLength(1)
  })
  it('does not mark completion on failed commit or mismatched reread', async () => {
    const legacyReader = reader(source({ adoptForOwnerKey: owner.ownerKey })), storage = fakeStorage()
    storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' }))
    await expect(migrateLegacy({ storage, legacyReader, owner })).rejects.toMatchObject({ code: 'storage-full' })
    expect(legacyReader.markComplete).not.toHaveBeenCalled()
    await expect(migrateLegacy({ storage: { ...fakeStorage(), read: async () => null }, legacyReader, owner })).rejects.toMatchObject({ code: 'migration-unconfirmed' })
    expect(legacyReader.markComplete).not.toHaveBeenCalled()
  })
  it('preserves an existing destination and its pending queue', async () => {
    const envelope = fixtureEnvelope({ pendingOperations: [{ opId: 'kept', ownerKey: owner.ownerKey }], state: fixtureState({ workouts: [{ id: 'existing' }] }) })
    const result = await migrateLegacy({ storage: fakeStorage({ [owner.ownerKey]: envelope }), legacyReader: reader(source({ adoptForOwnerKey: owner.ownerKey })), owner })
    expect(result.envelope.state.workouts).toEqual([{ id: 'existing' }])
    expect(result.envelope.pendingOperations.map(o => o.opId)).toEqual(['kept'])
    expect(result.recoveryCopies[0]).toMatchObject({ status: 'pending', reason: 'destination-exists' })
  })
  it('recovers ambiguous workout identities without dropping either entry', async () => {
    const copy = source({ adoptForOwnerKey: owner.ownerKey })
    copy.state.workouts.push({ d: '2026-09-01', start: 123, entries: [{ exId: 'different' }] })
    const result = await migrateLegacy({ storage: fakeStorage(), legacyReader: reader(copy), owner })
    expect(result.envelope.state.workouts).toEqual([])
    expect(result.recoveryCopies[0]).toMatchObject({ reason: 'ambiguous-workout-identity', status: 'pending' })
    expect(result.recoveryCopies[0].state.workouts).toHaveLength(2)
  })
  it('keeps existing IDs and derives missing IDs deterministically across copies', async () => {
    const state = source().state
    state.workouts.push({ id: 'already-there', d: '2026-09-02', entries: [] })
    const a = await prepareLegacyState(state), b = await prepareLegacyState(structuredClone(state))
    expect(a.workouts.map(w => w.id)).toEqual(b.workouts.map(w => w.id))
    expect(a.workouts[1].id).toBe('already-there')
    expect(state.workouts[0].id).toBeUndefined()
  })
  it('strict native reads distinguish missing, corrupt and IO failures', async () => {
    const fs = fakeFilesystem()
    expect(await nativeLoadLegacyStrict({ loadFilesystem: fs.loadFilesystem })).toBeNull()
    fs.files.set('opengym-state.json', '{broken')
    await expect(nativeLoadLegacyStrict({ loadFilesystem: fs.loadFilesystem })).rejects.toMatchObject({ code: 'legacy-corrupt' })
    fs.files.set('opengym-state.json', JSON.stringify(fixtureState()))
    fs.files.set('opengym-state-owner.json', JSON.stringify({ owner: 'node-user', ts: 1 }))
    expect(await nativeLoadLegacyStrict({ loadFilesystem: fs.loadFilesystem })).toMatchObject({ ownerMetadata: { owner: 'node-user', ts: 1 } })
    fs.mod.Filesystem.readFile = async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) }
    await expect(nativeLoadLegacyStrict({ loadFilesystem: fs.loadFilesystem })).rejects.toMatchObject({ code: 'EACCES' })
  })
  it('default readers retain browser/native evidence without credential metadata', async () => {
    const values = new Map([['gym_state_v1', JSON.stringify(source().state)], ['gym_owner', owner.uid], ['gym_user', JSON.stringify({ id: owner.uid, token: 'secret' })]])
    const legacyReader = createLegacyReader({ localStorage: { getItem: key => values.get(key) ?? null }, readNative: async () => ({ state: fixtureState(), ownerMetadata: { owner: owner.uid, ts: 1 } }) })
    const result = await migrateLegacy({ storage: fakeStorage(), legacyReader, owner })
    expect(result.recoveryCopies).toHaveLength(2)
    expect(result.recoveryCopies.every(c => c.status === 'pending')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(values.size).toBe(3)
  })
})

it('does not hide parsed null/native invalid state as an absent file', async () => {
  const fs = fakeFilesystem()
  fs.files.set('opengym-state.json', 'null')
  await expect(nativeLoadLegacyStrict({ loadFilesystem: fs.loadFilesystem })).rejects.toMatchObject({ code: 'legacy-corrupt' })
})

it('does not adopt workouts with null entries or malformed identity silently', async () => {
  await expect(prepareLegacyState({ workouts: [null] })).rejects.toMatchObject({ code: 'invalid-legacy-state' })
  await expect(prepareLegacyState({ workouts: [{ entries: [] }] })).rejects.toMatchObject({ code: 'ambiguous-workout-identity' })
  await expect(prepareLegacyState({ workouts: [{ id: 'same' }, { id: 'same' }] })).rejects.toMatchObject({ code: 'ambiguous-workout-identity' })
})

it('admits trusted Firebase/guest identities only into their exact classified owner', async () => {
  const proven = source({ ownerKey: owner.ownerKey, identityProvider: 'firebase' })
  const result = await migrateLegacy({ storage: fakeStorage(), legacyReader: reader(proven), owner })
  expect(result.envelope.state.workouts).toHaveLength(1)
  const guest = makeOwner(owner.projectId)
  const guestCopy = source({ ownerKey: guest.ownerKey, identityProvider: 'guest' })
  expect((await migrateLegacy({ storage: fakeStorage(), legacyReader: reader(guestCopy), owner: guest })).envelope.state.workouts).toHaveLength(1)
  expect((await migrateLegacy({ storage: fakeStorage(), legacyReader: reader(guestCopy), owner })).envelope.state.workouts).toEqual([])
})
