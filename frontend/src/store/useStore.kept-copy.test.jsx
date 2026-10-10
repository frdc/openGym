// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('reset recovery is exportable only from its original confirmed owner', async () => {
 const h = await runtime(); await h.auth('a'); h.store.getState().update(s => { s.workouts.push(workout('recover')) }, false); await h.store.getState().resetEverything()
 expect((await h.store.getState().keptState('demo-opengym','a')).workouts[0].id).toBe('recover')
 await h.auth('b'); expect(await h.store.getState().keptState('demo-opengym','a')).toBeNull(); expect(await h.store.getState().keptChanges()).toEqual([])
 await h.auth('a'); expect((await h.store.getState().keptState('demo-opengym','a')).workouts[0].id).toBe('recover')
})
it('media referenced by recovery remains protected from local GC', async () => {
 const hash = 'a'.repeat(64), h = await runtime({ initial: { workouts: [{ ...workout('media'), media: [{ hash, type: 'image' }] }] } }); await h.store.getState().resetEverything()
 expect(await h.store.getState().stashedMediaHashes()).toContain(hash)
})
