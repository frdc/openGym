// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it.each(['merge','replace'])('%s explicitly restores a deleted record and backup settings', async mode => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('deleted')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.workouts = [] }); await h.sync()
 const backup = state({ workouts: [workout('deleted', 50)], restSec: 43 }), preview = await h.store.getState().importConflict(backup)
 await h.store.getState().importBackup(backup, mode === 'merge' ? { mergeWith: preview || { state: h.store.getState().S, local: true } } : {}); await h.sync()
 expect((await h.remoteState('a')).workouts[0].entries[0].sets[0].w).toBe(50); expect((await h.remoteState('a')).restSec).toBe(43)
})
it('import keeps the running draft and its incarnation and converts its weights', async () => {
 const h = await runtime({ initial: { active: { id: 'running', entries: [{ id: '0025', sets: [{ w: 40 }] }] } } }), token = h.store.getState().activeSessionToken
 await h.store.getState().importBackup(state({ unit: 'lb', active: { id: 'backup-active' } }))
 expect(h.store.getState().S.active.id).toBe('running'); expect(h.store.getState().S.active.entries[0].sets[0].w).toBe(88); expect(h.store.getState().activeSessionToken).toBe(token)
})
it('imported active gets a new persisted incarnation if no current draft exists', async () => {
 const h = await runtime(); await h.store.getState().importBackup(state({ active: { id: 'backup-active' } }))
 expect(h.store.getState().activeSessionToken).toEqual(expect.any(String)); expect((await h.saved()).localMetadata.activeSessionToken).toBe(h.store.getState().activeSessionToken)
})
