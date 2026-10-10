// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'
import { editCompletedSession } from '../lib/session-edit.js'

it('same confirmed owner recovers durable edits and active draft without inheriting another owner', async () => {
 const h = await runtime(); await h.auth('a'); h.store.getState().update(s => { s.workouts.push(workout('a')); s.active = { id: 'active-a' } }, false); await h.store.getState().flushLocal()
 const token = h.store.getState().activeSessionToken; await h.auth('b'); expect(h.store.getState().S.workouts).toEqual([]); expect(h.store.getState().S.active).toBeNull()
 await h.auth('a'); expect(h.store.getState().S.workouts[0].id).toBe('a'); expect(h.store.getState().activeSessionToken).toBe(token)
})
it('a late remote response from A cannot install or acknowledge data in B', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); const gate = deferred(), started = deferred(), port = h.remoteFor('a'), read = port.readProfileFromServer
 port.readProfileFromServer = async (...args) => { started.resolve(); await gate.promise; return read(...args) }
 const pending = h.sync(); await started.promise; await h.auth('b'); gate.resolve(); await pending.catch(() => {})
 expect(h.store.getState().ownerKey).toBe(owner('b').ownerKey); expect(h.store.getState().S.workouts).toEqual([])
})
