// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'

it.each([null,'a'])('a closed tab workout and weigh-in survive another tab edit under owner %s', async uid => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); if (uid) { await a.auth(uid); await b.auth(uid) }
 b.store.getState().update(s => { s.workouts.push(workout('closed')); s.bodyweight.push({ d: '2026-10-07', w: 77.7, t: Date.now() }) }, false); await b.store.getState().dispose()
 a.store.getState().update(s => { s.restSec = 45 }, false); await a.store.getState().flushLocal()
 expect((await a.saved()).state).toMatchObject({ restSec: 45, workouts: [{ id: 'closed' }], bodyweight: [{ w: 77.7 }] })
})
it('a confirmed saved change reaches an already signed-in tab including the active draft', async () => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); await a.auth('a'); await b.auth('a')
 b.store.getState().update(s => { s.active = { id: 'running' }; s.bodyweight.push({ d: '2026-10-07', w: 66.6, t: Date.now() }) }, false); await b.store.getState().flushLocal()
 await vi.waitFor(() => expect(a.store.getState().S.active?.id).toBe('running')); expect(a.store.getState().S.bodyweight[0].w).toBe(66.6)
 expect(a.store.getState().activeSessionToken).toBe(b.store.getState().activeSessionToken)
})
it('adoption snapshots the other guest tab durable changes and subsequent account edits stay isolated', async () => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); b.store.getState().update(s => { s.workouts.push(workout('guest-tab')) }, false); await b.store.getState().flushLocal()
 await a.auth('a'); expect(a.store.getState().adoptionDecision.status).toBe('pending'); await a.store.getState().resolveAdoption('keep')
 b.store.getState().update(s => { s.workouts.push(workout('later-guest')) }, false); await b.store.getState().flushLocal()
 expect(a.store.getState().S.workouts).toEqual([])
})
it('sign-out flush includes workouts another same-owner tab queued', async () => {
 const a = await runtime({ cloud: true }), remote = new Proxy({}, { get: (_, method) => (o,...args) => a.remoteFor(o.uid)[method](o,...args) })
 const b = await runtime({ storage: a.storage, remote }); await a.auth('a'); await b.auth('a'); await a.sync(); await b.sync()
 b.store.getState().update(s => { s.workouts.push(workout('other-tab')) }, false); await b.store.getState().flushLocal()
 expect((await a.store.getState().signOut()).owed).toBe(false); expect((await a.remoteState('a')).workouts[0].id).toBe('other-tab')
})
