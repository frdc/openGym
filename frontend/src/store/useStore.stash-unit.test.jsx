// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { runtime, state, workout, profile } from './cloud-test-runtime.js'

it('restores owner active in the new confirmed unit after another device converts', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.active = { id: 'run', entries: [{ id: '0025', sets: [{ w: 100, r: 5 }] }] } }, false); await h.store.getState().flushLocal(); const token = h.store.getState().activeSessionToken
 await h.auth(null)
 const remote = new Proxy({}, { get: (_, method) => (owner,...args) => h.remoteFor(owner.uid)[method](owner,...args) })
 const other = await runtime({ remote }); await other.auth('a'); await other.sync(); await other.store.getState().setUnit('lb')
 await h.auth('a'); await h.sync()
 expect(h.store.getState().S.unit).toBe('lb'); expect(h.store.getState().S.active.entries[0].sets[0].w).toBe(220.5); expect(h.store.getState().activeSessionToken).toBe(token)
})
