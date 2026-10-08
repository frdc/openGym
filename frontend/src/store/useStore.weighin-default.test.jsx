// @vitest-environment happy-dom
// v1.3.11: "Weigh in before workouts" starts off for a profile created from nothing. A profile
// that already exists keeps what it had: one saved with the switch on stays on, and one saved
// before the setting existed (no key) still reads as on through DEF and `!== false`.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { runtime } from './cloud-test-runtime.js'
import { freshState, DEF, restoredStateFor, restartedState } from './useStore.js'

describe('weigh-in default', () => {
  it('a fresh profile starts with the weigh-in off', () => {
    expect(freshState().weighIn).toBe(false)
  })

  it('DEF keeps it on, so an existing profile without the key is not changed under it', () => {
    expect(DEF.weighIn).toBe(true)
    const old = { workouts: [{ id: 'w1' }], routines: [] }         // written before the setting existed
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, old)
    expect(S.weighIn).toBe(true)
    const off = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { ...old, weighIn: false })
    expect(off.weighIn).toBe(false)
  })
})

describe('exercise animations default', () => {
  it('a fresh profile starts with Small animations, the thumbnail on the workout screen', () => {
    expect(freshState().gifSize).toBe('mini')
  })

  it('DEF keeps Full, so an existing profile without the key is not changed under it', () => {
    expect(DEF.gifSize).toBe('full')
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { workouts: [{ id: 'w1' }], routines: [] })
    expect(S.gifSize).toBe('full')
  })
})

// A reset, or another account signing in on this device, starts a new profile: the same new
// defaults as a first run, in the language already on screen, and the reset keeps its stamps.
describe('starting over', () => {
  const old = () => ({ ...JSON.parse(JSON.stringify(DEF)), lang: 'de', weighIn: true, gifSize: 'full', resetAt: 5, resetIds: { workouts: ['w-old'] }, workouts: [{ id: 'w1', d: '2026-09-01', entries: [] }] })


  it('Reset everything gives weigh-in off and small animations, in the same language', async () => {
    const { store: useStore, saved } = await runtime({ initial: old() })
    await useStore.getState().resetEverything()
    const S = useStore.getState().S
    expect(S.weighIn).toBe(false)
    expect(S.gifSize).toBe('mini')
    expect(S.lang).toBe('de')
    expect(S.langAuto).toBe(false)
    expect(S.workouts).toEqual([])
    expect(S.resetAt).toBeGreaterThan(5)
    expect((await saved()).recoveryCopies[0].state.resetIds.workouts).toContain('w-old')
    expect((await saved()).recoveryCopies[0].state.workouts[0].id).toBe('w1')
  })

  it('restartedState keeps a language nobody picked yet marked as such', () => {
    expect(restartedState({ lang: 'ar', langAuto: true })).toMatchObject({ lang: 'ar', langAuto: true, weighIn: false, gifSize: 'mini' })
  })

  it('another confirmed account starts from fresh defaults without the old profile', async () => {
    const h = await runtime(); await h.auth('a')
    h.store.getState().update(s => { Object.assign(s, old()) }, false); await h.store.getState().flushLocal(); await h.auth('b')
    expect(h.store.getState().S).toMatchObject({ workouts: [], weighIn: false, gifSize: 'mini' })
    expect(h.store.getState().S.lang).not.toBe('de')
  })
})
