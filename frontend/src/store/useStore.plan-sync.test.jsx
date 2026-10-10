// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { runtime, state, workout, profile } from './cloud-test-runtime.js'

import { buildCombinedEntries } from '../lib/session-merge.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { isWarmupRow } from '../lib/workout-model.js'
const planned = () => ({ routines: [{ id: 'A', name: 'Push', _ts: 100, ex: [{ id: '0025', sets: 3, reps: 5, weight: 100 }] }] })
const start = s => buildCombinedEntries(s, ['A']).entries
function train(s) {
 const entries = start(s).map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, done: true })) }))
 s.workouts.push(buildCompletedWorkout({ id: 'trained', d: '2026-09-01', start: 1000, routineIds: ['A'], entries }, { end: 2000 }))
}
it('routine edit stamps restart the next session while preserving historical plan after reload', async () => {
 const h = await runtime({ initial: planned() }); h.store.getState().update(s => { train(s) }, false)
 h.store.getState().update(s => { s.routines[0].ex[0].reps = 8 }, false); await h.store.getState().flushLocal()
 const reload = await runtime({ storage: h.storage }), entry = start(reload.store.getState().S)[0]
 expect(entry.plan.why[0]).toBe('Plan changed, so starting from your new target.')
 expect(entry.sets.filter(s => !isWarmupRow(s)).map(s => s.r)).toEqual([8,8,8]); expect(reload.store.getState().S.workouts[0].entries[0].planned.reps).toBe(5)
})
it.each([true,false])('remote routine edit=%s and completed session retain both plan snapshots', async remoteEdit => {
 const h = await runtime({ cloud: true, profiles: { a: planned() } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { if (remoteEdit) train(s); else s.routines[0].ex[0].reps = 8 }, false, { kind: 'finish' })
 const remote = state(planned()); if (remoteEdit) { remote.routines[0].ex[0].reps = 8; remote.routines[0]._ts = Date.now()+10000 } else train(remote)
 h.remoteFor('a').replaceProfile(profile(remote, 4)); await h.sync()
 expect(h.store.getState().S.routines[0].ex[0].reps).toBe(8); expect(h.store.getState().S.workouts[0].entries[0].planned.reps).toBe(5)
 expect(start(h.store.getState().S)[0].plan.why[0]).toBe('Plan changed, so starting from your new target.')
})
it('unit conversion changes both target and historical planned weight once', async () => {
 const h = await runtime({ initial: planned() }); h.store.getState().update(s => { train(s) }, false); await h.store.getState().setUnit('lb')
 expect(h.store.getState().S.routines[0].ex[0].weight).toBe(220.5); expect(h.store.getState().S.workouts[0].entries[0].planned.weight).toBe(220.5)
 expect(start(h.store.getState().S)[0].plan.why[0]).not.toBe('Plan changed, so starting from your new target.')
})
it('unsent plan settings and routine edits remain owned across sign-out and return', async () => {
 const h = await runtime(); await h.auth('a'); h.store.getState().update(s => { Object.assign(s, planned()); s.startFrom = 'last'; s.routines[0].ex[0].reps = 8 }, false); await h.store.getState().flushLocal()
 await h.auth(null); await h.auth('a'); expect(h.store.getState().S.startFrom).toBe('last'); expect(h.store.getState().S.routines[0].ex[0].reps).toBe(8)
})
