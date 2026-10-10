// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it.each(['keep','add'])('holds uploads during the question; %s uses the latest account copy', async choice => {
 const h = await runtime({ cloud: true, initial: { workouts: [workout('guest')] }, profiles: { a: { workouts: [workout('account')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.workouts.push(workout('held')) }, false)
 await h.store.getState().pushState(); await h.store.getState().pullState()
 expect(h.remoteFor('a').transactions).toEqual([])
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('account'), workout('new-remote')] }), 5))
 await h.store.getState().resolveAdoption(choice); await h.sync()
 expect((await h.remoteState('a')).workouts.map(w => w.id).sort()).toEqual((choice === 'add' ? ['account','new-remote','held','guest'] : ['account','new-remote','held']).sort())
})
it('restarts with a pending decision without uploading guest data', async () => {
 const h = await runtime({ cloud: true, initial: { workouts: [workout('guest')] } }); await h.auth('a'); await h.store.getState().dispose()
 const reload = await runtime({ cloud: true, storage: h.storage }); await reload.auth('a'); await reload.sync()
 expect(reload.store.getState().adoptionDecision.status).toBe('pending'); expect(reload.remoteFor('a').transactions).toEqual([])
})
it('a rejected or stale adoption dialog cannot grant another account its contents', async () => {
 const h = await runtime({ initial: { workouts: [workout('guest')] } }); await h.auth('a')
 await expect(h.store.getState().adoptProfile(() => Promise.reject(new Error('cancelled')))).rejects.toThrow('cancelled')
 expect(h.store.getState().adoptionDecision.status).toBe('pending')
 const gate = deferred(), decision = h.store.getState().adoptProfile(() => gate.promise); await h.auth('b'); gate.resolve(true)
 await expect(decision).rejects.toThrow('stale-context'); expect(h.store.getState().S.workouts).toEqual([])
})
