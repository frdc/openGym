// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('shared storage joins same-owner edits while keeping account envelopes separate', async () => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); await a.auth('a'); await b.auth('a')
 a.store.getState().update(s => { s.restSec = 42 }, false); b.store.getState().update(s => { s.targetW = 77 }, false)
 await Promise.all([a.store.getState().flushLocal(), b.store.getState().flushLocal()]); expect((await a.saved()).state).toMatchObject({ restSec: 42, targetW: 77 })
 await b.auth('b'); expect(b.store.getState().S.targetW).not.toBe(77); expect(a.store.getState().ownerKey).toBe(owner('a').ownerKey)
})
it('Auth sign-out hides the prior owner in every notified tab, retaining its archive', async () => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); await a.auth('a'); await b.auth('a')
 a.store.getState().update(s => { s.workouts.push(workout('account')) }, false); await a.store.getState().flushLocal()
 await Promise.all([a.auth(null), b.auth(null)])
 for (const h of [a,b]) { expect(h.store.getState().ownerKey).toBe(owner().ownerKey); expect(h.store.getState().S.workouts).toEqual([]) }
 expect((await a.storage.read(owner('a').ownerKey)).state.workouts[0].id).toBe('account')
})
it('stale empty tab edits preserve a running draft and its token atomically', async () => {
 const a = await runtime(), b = await runtime({ storage: a.storage }); const old = structuredClone(b.store.getState().S)
 a.store.getState().update(s => { s.active = { id: 'started' } }, false); await a.store.getState().flushLocal(); const token = a.store.getState().activeSessionToken
 b.store.setState({ S: old, activeSessionToken: null }); b.store.getState().update(s => { s.restSec = 32 }, false); await b.store.getState().flushLocal()
 expect((await b.saved()).state.active.id).toBe('started'); expect((await b.saved()).localMetadata.activeSessionToken).toBe(token)
})
