// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'

it('two independent device queues merge settings and workouts against current remote control', async () => {
 const a = await runtime({ cloud: true }), remote = new Proxy({}, { get: (_, method) => (o,...args) => a.remoteFor(o.uid)[method](o,...args) })
 const b = await runtime({ remote }); await a.auth('a'); await b.auth('a'); await a.sync(); await b.sync()
 a.store.getState().update(s => { s.workouts.push(workout('a')) }, false); b.store.getState().update(s => { s.restSec = 48 }, false)
 await a.sync(); await b.sync(); expect((await a.remoteState('a'))).toMatchObject({ restSec: 48, workouts: [{ id: 'a' }] })
})
it('a stale independent device cannot resurrect an explicitly deleted workout', async () => {
 const a = await runtime({ cloud: true, profiles: { a: { workouts: [workout('deleted')] } } }), remote = new Proxy({}, { get: (_, method) => (o,...args) => a.remoteFor(o.uid)[method](o,...args) })
 const b = await runtime({ remote }); await a.auth('a'); await b.auth('a'); await a.sync(); await b.sync()
 a.store.getState().update(s => { s.workouts = [] }, false); await a.sync(); b.store.getState().update(s => { s.restSec = 48 }, false); await b.sync()
 expect((await a.remoteState('a')).workouts).toEqual([]); expect(b.store.getState().S.workouts).toEqual([])
})
it('independent routine edits merge by entity stamps, not whole-profile timestamp', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { routines: [{ id: 'a', name: 'A', ex: [], _ts: 10 }, { id: 'b', name: 'B', ex: [], _ts: 10 }] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.routines[0].name = 'A local' }, false)
 const next = state({ routines: [{ id: 'a', name: 'A', ex: [], _ts: 10 }, { id: 'b', name: 'B remote', ex: [], _ts: Date.now()+1000 }] })
 h.remoteFor('a').replaceProfile(profile(next, 4)); await h.sync(); expect(h.store.getState().S.routines.map(r => r.name)).toEqual(['A local','B remote'])
})
it('a reset queued during remote failure resumes without restoring pre-reset records', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('old')] } } }); await h.auth('a'); await h.sync(); const port = h.remoteFor('a'), reset = port.commitReset
 port.commitReset = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }) }
 await expect(h.store.getState().resetEverything()).resolves.toBeUndefined(); expect(h.store.getState().sync.cloud).toBe('waiting'); expect(h.store.getState().S.workouts).toEqual([]); expect((await h.saved()).pendingJobs[0].kind).toBe('reset')
 port.commitReset = reset; await h.sync(); expect((await h.remoteState('a')).workouts).toEqual([]); expect((await h.saved()).cloudGeneration).toBe(2)
})
