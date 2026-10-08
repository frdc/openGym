// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'

it('preserves unproven old offline settings, plan and notes as recovery without auto ownership', async () => {
 const legacy = state({ restSec: 140, week: { 1: 'r1', 3: 'r1' }, exNotes: { bench: 'new note' }, workouts: [workout('old')] })
 const h = await runtime({ cloud: true, legacyReader: { read: async () => [{ sourceId: 'node', state: legacy, ownerMetadata: { owner: 'a' } }] }, profiles: { a: { restSec: 60, workouts: [workout('remote')] } } }); await h.auth('a'); await h.sync()
 expect(h.store.getState().S.restSec).toBe(60); expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['remote'])
 expect((await h.saved()).recoveryCopies[0].state).toMatchObject({ restSec: 140, week: { 1: 'r1', 3: 'r1' }, exNotes: { bench: 'new note' } })
 expect(h.remoteFor('a').transactions).toEqual([])
})
it('explicit trusted Guest admission retains legacy values and one durable marker across reload', async () => {
 const legacyReader = { read: async () => [{ sourceId: 'accepted', adoptForOwnerKey: owner().ownerKey, state: state({ restSec: 140, week: { 3: 'r' }, exNotes: { bench: 'note' } }) }] }
 const h = await runtime({ legacyReader }), before = await h.saved()
 expect(before.state).toMatchObject({ restSec: 140, week: { 3: 'r' }, exNotes: { bench: 'note' } }); expect(before.pendingOperations).toEqual([]); expect(before.pendingJobs).toEqual([])
 expect(before.localMetadata.seededRecoveryIds).toEqual([before.recoveryCopies[0].recoveryId])
 expect(before.recoveryCopies[0].state).toEqual((await legacyReader.read())[0].state)
 const reload = await runtime({ storage: h.storage, legacyReader }), after = await reload.saved()
 expect(after.pendingOperations).toEqual([]); expect(after.pendingJobs).toEqual([])
 expect(after.localMetadata.seededRecoveryIds).toEqual(before.localMetadata.seededRecoveryIds)
 expect(after.recoveryCopies).toEqual(before.recoveryCopies); expect(after.state).toEqual(before.state)
})
it('an existing current archive and queue are never replaced by a newly admitted old source', async () => {
 const h = await runtime(); h.store.getState().update(s => { s.restSec = 55 }, false); await h.store.getState().flushLocal(); const before = await h.saved()
 const reload = await runtime({ storage: h.storage, legacyReader: { read: async () => [{ sourceId: 'old', adoptForOwnerKey: owner().ownerKey, state: state({ restSec: 140 }) }] } })
 const after = await reload.saved(); expect(after.state.restSec).toBe(55); expect(after.pendingOperations.map(op => op.opId)).toEqual(before.pendingOperations.map(op => op.opId)); expect(after.recoveryCopies[0].reason).toBe('destination-exists')
})
