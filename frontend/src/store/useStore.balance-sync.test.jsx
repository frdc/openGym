// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { runtime, state, workout, profile } from './cloud-test-runtime.js'

import { withOverride } from '../lib/structuralBalance.js'
it('local choice and clear beat older remote choices and survive owner return', async () => {
 const h = await runtime({ cloud: true, profiles: { a: { balanceOverrides: { 'atg:pullups': { id: '0017', _ts: 90 } } } } }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.balanceOverrides = withOverride(s.balanceOverrides,'poliquin:dips','0009'); s.balanceOverrides = withOverride(s.balanceOverrides,'atg:pullups',null) }, false)
 h.remoteFor('a').replaceProfile(profile(state({ workouts: [workout('remote')], balanceOverrides: { 'poliquin:dips': { id: '0251', _ts: 50 }, 'atg:pullups': { id: '0017', _ts: 90 } } }), 3)); await h.sync()
 expect((await h.remoteState('a')).balanceOverrides).toMatchObject({ 'poliquin:dips': { id: '0009' }, 'atg:pullups': { id: null } })
 await h.auth(null); await h.auth('a'); expect(h.store.getState().S.balanceOverrides['poliquin:dips'].id).toBe('0009')
})
it('a newer remote role choice wins over a pending local choice', async () => {
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync()
 h.store.getState().update(s => { s.balanceOverrides = withOverride(s.balanceOverrides,'poliquin:dips','0009') }, false)
 const stamp = h.store.getState().S.balanceOverrides['poliquin:dips']._ts
 h.remoteFor('a').replaceProfile(profile(state({ balanceOverrides: { 'poliquin:dips': { id: '2364', _ts: stamp+1000 } } }), 2)); await h.sync()
 expect(h.store.getState().S.balanceOverrides['poliquin:dips'].id).toBe('2364')
})
