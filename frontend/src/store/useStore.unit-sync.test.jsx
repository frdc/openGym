// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it.each([true,false])('unit action convert=%s persists and synchronizes once with active draft', async convert => {
 const h = await runtime({ cloud: true, profiles: { a: { bodyweight: [{ d: '2026-10-01', w: 80, t: 10 }], workouts: [workout('first', 40)] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.active = { id: 'active', entries: [{ id: '0025', sets: [{ w: 40 }] }] } }, false); await h.store.getState().flushLocal(); const token = h.store.getState().activeSessionToken
 await h.store.getState().setUnit('lb', { convert }); await h.sync()
 expect(h.store.getState().S.unit).toBe('lb'); expect(h.store.getState().S.bodyweight[0].w).toBe(convert ? 176.4 : 80)
 expect(h.store.getState().S.bodyweight[0].t).toBe(10); expect((await h.remoteState('a')).unit).toBe('lb'); expect(h.store.getState().activeSessionToken).toBe(token)
 await h.store.getState().setUnit('lb', { convert }); expect(h.store.getState().S.bodyweight[0].w).toBe(convert ? 176.4 : 80)
})
