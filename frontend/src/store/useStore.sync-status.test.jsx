// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { runtime, owner, state, workout, profile, deferred } from './cloud-test-runtime.js'

vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ abandonWork() {}, stopRest() {}, stopWork() {} }) } }))
it('shows saved locally and pending cloud independently, then acknowledges only successful remote commit', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); expect(h.store.getState().sync.cloud).toBe('synced')
 h.store.getState().update(s => { s.restSec = 39 }, false); await h.store.getState().flushLocal()
 expect(h.store.getState().sync).toMatchObject({ local: 'saved', pendingCount: 1 }); expect(h.store.getState().unsyncedChanges().owed).toBe(true)
 const status = await h.sync(); expect(status.cloud).toBe('synced'); expect(h.store.getState().unsyncedChanges()).toMatchObject({ owed: false, count: 0 })
})
it.each([['unavailable','waiting'],['permission-denied','blocked'],['unauthenticated','auth-required']])('surfaces %s as %s without signing out or losing state', async (code,cloud) => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); h.store.getState().update(s => { s.restSec = 39 }, false); await h.store.getState().flushLocal()
 h.remoteFor('a').failNext(Object.assign(new Error(code),{code})); await h.sync()
 expect(h.store.getState().sync).toMatchObject({ local: 'saved', cloud, cloudError: { code } }); expect(h.store.getState().user.uid).toBe('a'); expect(h.store.getState().S.restSec).toBe(39); expect(h.store.getState().unsyncedChanges().owed).toBe(true)
 await h.sync(); expect(h.store.getState().sync.cloud).toBe('synced')
})
it('guest manual sync stays local and does not invent account transport', async () => {
 const h = await runtime(); h.store.getState().update(s => { s.restSec = 39 }, false); const status = await h.sync()
 expect(status.local).toBe('saved'); expect(h.store.getState().isGuest()).toBe(true); expect(status.cloud).not.toBe('synced')
})
it('refuses ordinary signout with owed changes and force preserves archive for original owner', async () => {
 const h = await runtime(); await h.auth('a'); h.store.getState().update(s => { s.workouts.push(workout('owed')) }, false); await h.store.getState().flushLocal()
 expect(await h.store.getState().signOut()).toMatchObject({ owed: true, count: 1 }); expect(h.store.getState().user.uid).toBe('a')
 expect(await h.store.getState().signOut({ force: true })).toMatchObject({ owed: true, stashed: true }); expect(h.store.getState().isGuest()).toBe(true)
 await h.auth('b'); expect(h.store.getState().S.workouts).toEqual([]); await h.auth('a'); expect(h.store.getState().S.workouts[0].id).toBe('owed')
})
it('signout after successful retry leaves no cloud debt and restores local active on return', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); h.store.getState().update(s => { s.active = { id: 'running' }; s.restSec = 39 }, false)
 expect((await h.store.getState().signOut()).owed).toBe(false); await h.auth('a'); expect(h.store.getState().S.active.id).toBe('running')
})
it('failed durability prevents forced signout and keeps the current memory copy visible', async () => {
 const h = await runtime(); await h.auth('a'); h.storage.commit = async () => { throw Object.assign(new Error('full'), { code: 'storage-full' }) }
 h.store.getState().update(s => { s.restSec = 39 }, false)
 await expect(h.store.getState().signOut({ force: true })).rejects.toThrow('full'); expect(h.store.getState().user.uid).toBe('a'); expect(h.store.getState().S.restSec).toBe(39)
})
it('only a confirmed Auth signout changes owner after an authentication error', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync(); h.store.getState().update(s => { s.restSec = 39 }, false)
 h.remoteFor('a').failNext(Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' })); await h.sync(); expect(h.store.getState().user.uid).toBe('a')
 await h.auth(null); expect(h.store.getState().isGuest()).toBe(true); expect((await h.storage.read(owner('a').ownerKey)).state.restSec).toBe(39)
})
