// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('pulls remote changes while preserving the current active draft', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('remote')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.active = { id: 'running', entries: [] } }, false); await h.store.getState().flushLocal()
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('remote'), workout('new')] }), 4)); await h.sync()
 expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['remote','new']); expect(h.store.getState().S.active.id).toBe('running')
})
it('merges simultaneous local settings and remote history and confirms the queue', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.restSec = 47 }, false)
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('new')] }), 2)); await h.sync()
 expect(h.store.getState().S).toMatchObject({ restSec: 47, workouts: [{ id: 'new' }] }); expect((await h.saved()).pendingOperations).toEqual([])
})
it('returns history edits synchronously and uploads corrected PR documents', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('first'), workout('later', 30, '2026-09-02')], exWeights: { '0025': { w: 40, d: '2026-09-01' } } } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { editCompletedSession(s, 'first'); s.active.entries[0].sets[0].w = 20 }, false)
 const saved = h.store.getState().saveHistoryEdit(); expect(saved.id).toBe('first'); expect(saved.then).toBeUndefined()
 await h.store.getState().flushLocal(); await h.sync()
 expect(h.store.getState().S.exWeights['0025'].w).toBe(30); expect((await h.remoteState('a')).exWeights['0025'].w).toBe(30)
 expect(h.store.getState().S.active).toBeNull()
})
it('returns deletion synchronously, clears the draft and retains a tombstone', async () => {
 const h = await runtime({ initial: { workouts: [workout('first')] } })
 h.store.getState().update(s => { editCompletedSession(s, 'first'); s.active.entries[0].sets[0].done = false }, false)
 expect(h.store.getState().deleteHistoryEdit()).toBe(true); await h.store.getState().flushLocal()
 expect((await h.saved()).state.workouts).toEqual([]); expect((await h.saved()).state.deleted.workouts.first).toBeGreaterThan(0)
})
it('keeps the editor and queue unchanged when domain saving fails', async () => {
 const h = await runtime({ initial: { active: { id: 'gone', editingWorkoutId: 'gone', entries: [] } } })
 expect(() => h.store.getState().saveHistoryEdit()).toThrow(); expect(h.store.getState().S.active.id).toBe('gone'); expect((await h.saved()).pendingOperations).toEqual([])
})
