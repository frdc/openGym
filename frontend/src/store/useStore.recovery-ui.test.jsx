// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, deferred } from './cloud-test-runtime.js'
const source = () => ({ sourceId: 'old-node', state: state({ workouts: [workout('legacy')], coach: { token: 'private' } }) })
it('exports unknown legacy training safely and only admits it after an explicit durable decision', async () => {
  const original = source()
  const h = await runtime({ legacyReader: { read: async () => [original] } })
  expect(h.store.getState().S.workouts).toEqual([])
  const rows = h.store.getState().listRecovery()
  expect(rows).toHaveLength(1)
  const id = rows[0].recoveryId
  expect(h.store.getState().recoveryState(id).workouts[0].id).toBe('legacy')
  expect(h.store.getState().recoveryState(id)).not.toHaveProperty('coach')
  await h.store.getState().resolveRecovery(id, 'add')
  expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['legacy'])
  const saved = await h.saved()
  expect(saved.recoveryCopies[0].state.coach.token).toBe('private')
  const count = saved.pendingOperations.length
  await h.store.getState().resolveRecovery(id, 'add')
  expect((await h.saved()).pendingOperations).toHaveLength(count)
  await h.store.getState().dispose()
  const reloaded = await runtime({ storage: h.storage, legacyReader: { read: async () => [original] } })
  expect((await reloaded.saved()).pendingOperations).toHaveLength(count)
  expect(reloaded.store.getState().S.workouts.map(w => w.id)).toEqual(['legacy'])
})
it('keeps an unknown source exportable without importing its training', async () => {
  const h = await runtime({ legacyReader: { read: async () => [source()] } })
  const id = h.store.getState().listRecovery()[0].recoveryId
  await h.store.getState().resolveRecovery(id, 'keep')
  expect(h.store.getState().S.workouts).toEqual([])
  expect(h.store.getState().recoveryState(id).workouts).toHaveLength(1)
})
it('does not disclose known Firebase A recovery to guest or B, even by a supplied recovery id', async () => {
  const src = { ...source(), identityProvider: 'firebase', ownerKey: owner('A').ownerKey }
  const h = await runtime({ legacyReader: { read: async () => [src] } })
  const id = (await h.saved()).recoveryCopies[0].recoveryId
  expect(h.store.getState().listRecovery()).toEqual([])
  expect(() => h.store.getState().recoveryState(id)).toThrow('recovery-owner-mismatch')
  await h.auth('B')
  expect(h.store.getState().listRecovery()).toEqual([])
  await expect(h.store.getState().resolveRecovery(id, 'add')).rejects.toThrow('recovery-owner-mismatch')
  await h.auth('A')
  expect(h.store.getState().listRecovery()).toHaveLength(1)
})

it('does not sign out B or abandon B timers when A sync finishes after an Auth transition', async () => {
  const h = await runtime({ cloud: true }); await h.auth('A')
  const remote = h.remoteFor('A'), read = remote.readProfileFromServer, gate = deferred(), entered = deferred()
  remote.readProfileFromServer = async (...args) => { entered.resolve(); await gate.promise; return read(...args) }
  const signing = h.store.getState().signOut({ force: true }); const observed = signing.then(() => null, error => error)
  await entered.promise
  const switching = h.auth('B'); gate.resolve(); await switching
  const result = await observed
  expect(result?.code).toBe('stale-context')
  expect(h.store.getState().user?.uid).toBe('B')
  expect((await h.saved()).recoveryCopies).toEqual([])
})

it('rechecks ownership after the final local departure flush before SDK signout', async () => {
  const h = await runtime(); await h.auth('A')
  const { useUI } = await import('./useUI.js')
  let switching
  const spy = vi.spyOn(useUI.getState(), 'abandonWork').mockImplementation(() => { switching = h.auth('B') })
  try {
    const result = await h.store.getState().signOut({ force: true }).then(() => null, error => error)
    await switching
    expect(result?.code).toBe('stale-context')
    expect(h.store.getState().user?.uid).toBe('B')
    expect((await h.saved()).recoveryCopies).toEqual([])
  } finally { spy.mockRestore() }
})

it('imports old Coach-authored training without reactivating Coach configuration', async () => {
  const h = await runtime()
  await h.store.getState().importBackup(state({ workouts: [workout('authored')], coach: { enabled: true, apiKey: 'private' } }))
  expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['authored'])
  expect(h.store.getState().S).not.toHaveProperty('coach')
  expect((await h.saved()).state).not.toHaveProperty('coach')
})

it('rejects a stale adoption answer after leaving and returning to the same Firebase account', async () => {
  const h = await runtime({ initial: { workouts: [workout('guest')] } }); await h.auth('A')
  const gate = deferred(), answering = h.store.getState().adoptProfile(() => gate.promise)
  const observed = answering.then(() => null, error => error)
  await h.auth('B'); await h.auth('A'); gate.resolve(true)
  expect((await observed)?.code).toBe('stale-context')
})
