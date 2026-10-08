// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it.each(['keep','add'])('requires explicit %s decision even for a newly created account', async choice => {
 const h = await runtime({ cloud: true, initial: { workouts: [workout('guest')], customEx: [{ id: 'custom', name: 'Mine' }] } }); await h.auth('a'); await h.sync()
 expect(h.store.getState().adoptionDecision.status).toBe('pending'); expect((await h.remoteState('a')).workouts).toEqual([])
 await h.store.getState().resolveAdoption(choice)
 expect((await h.remoteState('a')).workouts.map(w => w.id)).toEqual(choice === 'add' ? ['guest'] : [])
 expect((await h.storage.read(owner().ownerKey)).state.workouts[0].id).toBe('guest')
})
it('custom-exercise-only guest data requires adoption and uploads only after Add', async () => {
 const h = await runtime({ cloud: true, initial: { customEx: [{ id: 'custom', name: 'Mine' }] } }); await h.auth('a'); await h.sync()
 expect((await h.remoteState('a')).customEx).toEqual([]); await h.store.getState().resolveAdoption('add')
 expect((await h.remoteState('a')).customEx[0].name).toBe('Mine')
})
it('keeps account settings and history when guest data is declined', async () => {
 const h = await runtime({ cloud: true, initial: { restSec: 31, workouts: [workout('guest')] }, profiles: { a: { restSec: 64, workouts: [workout('account')] } } }); await h.auth('a'); await h.store.getState().resolveAdoption('keep'); await h.sync()
 expect(h.store.getState().S.restSec).toBe(64); expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['account'])
})
it('does not manufacture adoption for a pristine guest', async () => {
 const h = await runtime({ initial: {}, cloud: true }); await h.auth('a'); await h.sync(); expect(h.store.getState().adoptionDecision).toBeNull()
})
it('passes numeric extra counts to the retained adoption dialog contract', async () => {
 const h = await runtime({ initial: { workouts: [workout('guest')], bodyweight: [{ d: '2026-10-07', w: 80, t: 1 }], routines: [{ id: 'r', name: 'Plan', ex: [] }] } }); await h.auth('a')
 let offered; await h.store.getState().adoptProfile(extras => { offered = extras; return false })
 expect(offered).toMatchObject({ workouts: 1, bodyweight: 1, customEx: 0, routines: 1 })
})
