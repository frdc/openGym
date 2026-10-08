// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('resets the cloud generation and retains local recovery plus clears active incarnation', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { workouts: [workout('before')] } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.active = { id: 'active' } }, false); await h.store.getState().resetEverything(); await h.sync()
 expect(h.store.getState().S.workouts).toEqual([]); expect(h.store.getState().activeSessionToken).toBeNull()
 expect((await h.saved()).cloudGeneration).toBe(2); expect((await h.saved()).recoveryCopies.some(c => c.reason === 'reset' && c.state.workouts[0].id === 'before')).toBe(true)
 expect((await h.remoteState('a')).workouts).toEqual([])
})
it('guest reset is local and preserves language and recovery', async () => {
 const h = await runtime({ initial: { lang: 'pt-BR', workouts: [workout('before')] } }); await h.store.getState().resetEverything()
 expect(h.store.getState().S.lang).toBe('pt-BR'); expect((await h.saved()).pendingJobs).toEqual([]); expect((await h.saved()).recoveryCopies[0].state.workouts[0].id).toBe('before')
})
