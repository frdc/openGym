import { expect, it } from 'vitest'
import { createWorkoutStore, freshState } from './useStore.js'
import { fakeStorage } from '../lib/cloud/test-fixtures.js'
import { makeOwner, makeEnvelope } from '../lib/cloud/model.js'

it('restores private watch receipts with the same persisted workout after a process restart', async () => {
  const owner = makeOwner('demo-opengym'), state = freshState()
  state.active = { id: 'workout', start: 1000, entries: [{ id: '0025', sets: [{ r: 10, done: false }] }] }
  const storage = fakeStorage({ [owner.ownerKey]: makeEnvelope(owner, state) })
  const make = () => createWorkoutStore({ projectId: 'demo-opengym', client: null, storage, lifecycle: false, legacyReader: { read: async()=>[] }, authFactory:()=>({ ready:Promise.resolve(), stop(){} }) })
  const store = make(); await store.getState().boot()
  store.getState().update(S=>{ S.active.entries[0].sets[0].done = true }, false, { wearSessionUpdates: { session: { receipt: 'persisted' } } })
  await store.getState().flushLocal()
  const saved = await storage.read(owner.ownerKey)
  expect(saved.state.active.entries[0].sets[0].done).toBe(true)
  expect(saved.localMetadata.wearSessions.session.receipt).toBe('persisted')
  expect(saved.state).not.toHaveProperty('wearSessions')
  await store.getState().dispose()
  const restored = make(); await restored.getState().boot()
  expect(restored.getState().wearSessions.session.receipt).toBe('persisted')
  expect(restored.getState().S.active.entries[0].sets[0].done).toBe(true)
  await restored.getState().dispose()
})
