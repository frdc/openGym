// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('retains unsaved memory and error until real retry succeeds, then survives restart', async () => {
 const h = await runtime(); h.storage.failNextCommit(Object.assign(new Error('quota'), { code: 'storage-full' }))
 h.store.getState().update(s => { s.restSec = 33 }, false)
 await vi.waitFor(() => expect(h.store.getState().sync.local).toBe('error'))
 expect(h.store.getState().S.restSec).toBe(33); expect((await h.saved()).state.restSec).not.toBe(33)
 await h.store.getState().flushLocal(); expect(h.store.getState().sync.local).toBe('saved')
 const reload = await runtime({ storage: h.storage }); expect(reload.store.getState().S.restSec).toBe(33)
})
it('keeps an oversized record intact and identifies the blocked path', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.workouts.push({ ...workout('large'), note: 'x'.repeat(930000) }) }, false); await h.sync()
 expect(h.store.getState().S.workouts[0].note).toHaveLength(930000)
 expect(h.store.getState().sync.cloudError.path).toBe('workouts/bGFyZ2U'); expect(h.store.getState().sync.cloudError.code).toBe('document-too-large')
 expect((await h.saved()).pendingOperations).toHaveLength(1)
})
