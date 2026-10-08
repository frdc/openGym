// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('counts remote and local missing workouts once and captures the preview baseline', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('remote')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.workouts.push(workout('local')) }, false)
 const preview = await h.store.getState().importConflict(state())
 expect(preview.workouts).toBe(2); expect(preview.localState.workouts.map(w => w.id).sort()).toEqual(['local','remote']); expect(preview.localRevision).toEqual(expect.any(Number))
})
it('replace preserves local edits created after the preview while removing previewed omissions', async () => {
 const h = await runtime({ initial: { workouts: [workout('before')] } }); const backup = state({ workouts: [workout('backup')] })
 await h.store.getState().importConflict(backup)
 h.store.getState().update(s => { s.workouts.push(workout('during')) }, false); await h.store.getState().importBackup(backup)
 expect(h.store.getState().S.workouts.map(w => w.id).sort()).toEqual(['backup','during'])
})
it('rejects a preview carried across owners', async () => {
 const h = await runtime({ initial: { workouts: [workout('guest')] } }); const preview = await h.store.getState().importConflict(state()); await h.auth('a')
 expect(() => h.store.getState().importBackup(state(), { mergeWith: preview })).toThrow('owner-mismatch')
})
