// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('guest tombstones and reset never delete account records', async () => {
 const h = await runtime({ cloud: true, initial: { workouts: [workout('account')] }, profiles: { a: { workouts: [workout('account')] } } })
 h.store.getState().update(s => { s.workouts = [] }); await h.store.getState().resetEverything(); await h.auth('a'); await h.sync()
 if (h.store.getState().adoptionDecision) await h.store.getState().resolveAdoption('keep')
 expect((await h.remoteState('a')).workouts[0].id).toBe('account')
})
it('a raw old Node id cannot activate a Firebase owner', async () => {
 const h = await runtime(); expect(() => h.store.getState().setUser({ id: 'node-account' })).toThrow('auth-confirmation-required'); expect(h.store.getState().ownerKey).toBe(owner().ownerKey)
})
