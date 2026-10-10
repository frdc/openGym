// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { runtime, state, workout, profile } from './cloud-test-runtime.js'

import { freshState, DEF } from './useStore.js'
import { effectiveLang } from '../lib/default-lang.js'
it('marks only fresh profiles for automatic language and does not upload browser derivation', async () => {
 expect(freshState().langAuto).toBe(true); expect(DEF.langAuto).toBeUndefined()
 const h = await runtime({ cloud: true }); await h.auth('a'); await h.sync()
 expect(effectiveLang(freshState(), h.store.getState().config, ['de-DE'])).toBe('de')
 await h.sync(); expect(h.remoteFor('a').transactions).toEqual([])
})
it('explicit language survives reload and overrides browser preference', async () => {
 const h = await runtime(); h.store.getState().update(s => { s.lang = 'pt-BR'; s.langAuto = false }, false); await h.store.getState().flushLocal()
 const reload = await runtime({ storage: h.storage }); expect(effectiveLang(reload.store.getState().S, reload.store.getState().config, ['de-DE'])).toBe('pt-BR')
})
it('existing English state without automatic marker stays English', async () => {
 const h = await runtime({ initial: { lang: 'en' } }); expect(effectiveLang(h.store.getState().S, h.store.getState().config, ['de-DE'])).toBe('en')
})
