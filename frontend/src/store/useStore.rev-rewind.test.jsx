// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'

it('an older confirmed control response cannot replace newer local history or acknowledgement', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('first'),workout('new')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.restSec = 57 }, false); await h.sync(); const revision = (await h.saved()).lastConfirmedControl.dataRevision
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('first')] }), 0)); await h.sync()
 expect(h.store.getState().S.workouts.map(w => w.id)).toEqual(['first','new']); expect((await h.saved()).lastConfirmedControl.dataRevision).toBe(revision)
})
it('missing documents in a partial remote context do not erase known local records', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('known')] } } }); await h.auth('a'); await h.sync()
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('other')] }), 3)); await h.sync()
 expect(h.store.getState().S.workouts.map(w => w.id).sort()).toEqual(['known','other'])
})
it('a delayed old read cannot erase an independently saved local edit', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); const gate = deferred(), started = deferred(), port = h.remoteFor('a'), read = port.readProfileFromServer
 let once = true; port.readProfileFromServer = async (...args) => { const result = await read(...args); if (once) { once = false; started.resolve(); await gate.promise } return result }
 const pulling = h.sync(); await started.promise; h.store.getState().update(s => { s.workouts.push(workout('while-reading')) }, false); await h.store.getState().flushLocal(); gate.resolve(); await pulling
 expect(h.store.getState().S.workouts[0].id).toBe('while-reading'); expect((await h.remoteState('a')).workouts[0].id).toBe('while-reading')
})
