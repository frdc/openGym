// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('leaves held guest and account edits recoverable across sign-out and sign-in', async () => {
 const h = await runtime({ initial: { workouts: [workout('guest')] } }); await h.auth('a')
 h.store.getState().update(s => { s.workouts.push(workout('held')) }, false); await h.store.getState().flushLocal()
 await h.auth(null); await h.auth('a')
 expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['held']); expect(h.store.getState().adoptionDecision.status).toBe('pending')
 await h.store.getState().resolveAdoption('add'); expect(h.store.getState().S.workouts.map(w => w.id).sort()).toEqual(['guest','held'])
})
