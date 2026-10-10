// @vitest-environment happy-dom
// The plate-loading editor (barWeightSheet) and the plate inventory sheet write S.loadKind,
// S.barWeights and S.plates the way lib/plates.js reads them: a load kind and a unit's plate list
// are stamped with the time they were set, the way back to the default included, so the last
// change wins a sync (lib/sync-merge.js).

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('./store/useStore.js', async original => {
  const actual = (await original())
  const { createUIStoreFixture } = (await import('./store/ui-test-runtime.js'))
  uiRuntime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: uiRuntime.fixture.useStore }
})
afterEach(async () => { await uiRuntime.fixture.close(); })
beforeEach(() => uiRuntime.fixture.begin())
afterEach(async () => { await uiRuntime.fixture.flush(); })
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it , vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { barWeightSheet, plateInventorySheet } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'
import { loadKindFor } from './lib/plates.js'

const SQUAT = '0043'      // barbell
const COCOONS = '0260'    // body weight
const LEG_PRESS = EXIDX['0585'] ? '0585' : Object.values(EXIDX).find(e => e.eq === 'leverage machine').id
const DUMBBELL = Object.values(EXIDX).find(e => e.eq === 'dumbbell').id

const mounted = []
async function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}
const S = () => useStore.getState().S
const stamped = kind => ({ kind, _ts: expect.any(Number) })
const segButton = (host, text) => [...host.querySelectorAll('.seg button')].find(b => b.textContent.trim() === text)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
// A labelled Stepper is .stp-w > .stp-l (label) + .stp (Decrease, value input, Increase).
const stepperOf = (host, label) => [...host.querySelectorAll('.stp-w')].find(el => el.querySelector('.stp-l')?.textContent.trim() === label)
const valueOf = st => st.querySelector('input').value
const dec = st => st.querySelector('[aria-label="Decrease"]')
const inc = st => st.querySelector('[aria-label="Increase"]')

describe('plate loading editor', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    await uiRuntime.fixture.applySnapshot({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[SQUAT].eq).toBe('barbell')
    expect(EXIDX[LEG_PRESS].eq).toBe('leverage machine')
    expect(EXIDX[COCOONS].eq).toBe('body weight')
    expect(EXIDX[DUMBBELL].eq).toBe('dumbbell')
  })

  it('the editor derives its default from the same config the workout rows use', async () => {
    // A body-weight exercise a routine runs as a weighted lift (bodyweight: false): the rows
    // show no line, so the editor must show Off — and picking Single stack must stick.
    await act(async () => { await barWeightSheet(COCOONS, { id: COCOONS, bodyweight: false }); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    await act(async () => { await segButton(host, 'Single stack').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[COCOONS]).toEqual(stamped('single'))
    // Without a config the equipment decides: body weight → single stack by default.
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, loadKind: {} } }))
    await act(async () => { await barWeightSheet(COCOONS); await uiRuntime.fixture.flush(); })
    const host2 = (await mountTopSheet())
    expect(segButton(host2, 'Single stack').classList.contains('on')).toBe(true)
  })

  it('a pick the equipment alone cannot settle is stored, not read back as the default', async () => {
    // The exercise-detail sheet has no routine config, so it cannot know whether the routine logs
    // this body-weight exercise as added weight ('single') or as a plain total ('none') — the two
    // readings of the bodyweight flag disagree. The segment shows the body-weight default, and
    // tapping it used to match the cfg-less default and delete the key: the pick stored nothing
    // and the rows of a bodyweight:false routine went on showing no plate line at all.
    await act(async () => { await barWeightSheet(COCOONS); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(segButton(host, 'Single stack').classList.contains('on')).toBe(true)
    await act(async () => { await segButton(host, 'Single stack').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[COCOONS]).toEqual(stamped('single'))
    expect(loadKindFor(S(), { id: COCOONS, bodyweight: false })).toBe('single')
    // 'Off' is the other reading's default and is stored just the same.
    await act(async () => { await segButton(host, 'Off').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[COCOONS]).toEqual(stamped('none'))
  })

  it('a dumbbell still stores no kind of its own for the one its equipment already implies', async () => {
    // The two readings of the bodyweight flag differ for a dumbbell too ('single' as added
    // weight, 'none' as a plain loaded lift), but the cfg-less default — 'none' — is what a
    // dumbbell row derives, so the segment and the rows already agree and the pick is only
    // restating it. Storing it would freeze 'none' onto the exercise everywhere and override the
    // 'single' an entry with bodyweight: true derives, with no way left to take it off: the pick
    // puts the exercise back on its equipment's (a stamped null) instead.
    await act(async () => { await barWeightSheet(DUMBBELL); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    await act(async () => { await segButton(host, 'Off').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[DUMBBELL]).toEqual(stamped(null))
    expect(loadKindFor(S(), { id: DUMBBELL, bodyweight: true })).toBe('single')
  })

  it('a barbell defaults to per side and stores nothing until you pick something else', async () => {
    await act(async () => { await barWeightSheet(SQUAT); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(host.querySelector('h3').textContent).toBe('Plate loading')
    expect(segButton(host, 'Per side').classList.contains('on')).toBe(true)
    expect(S().loadKind).toEqual({})
    await act(async () => { await segButton(host, 'Single stack').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[SQUAT]).toEqual(stamped('single'))
    await act(async () => { await segButton(host, 'Per side').click(); await uiRuntime.fixture.flush(); })
    // Back to what the equipment implies: a stamped null, not a dropped key, so the way back
    // wins a sync against the other device's older 'single' instead of losing to it.
    expect(S().loadKind[SQUAT]).toEqual(stamped(null))
    expect(segButton(host, 'Per side').classList.contains('on')).toBe(true)
    await act(async () => { await segButton(host, 'Off').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[SQUAT]).toEqual(stamped('none'))
    expect(host.textContent).toContain('No plate line under the sets.')
  })

  it('"No bar" is an explicit 0 in barWeights; off again deletes it', async () => {
    await act(async () => { await barWeightSheet(SQUAT); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    const sw = host.querySelector('.switch, [role="switch"], input[type="checkbox"]')
    expect(sw).toBeTruthy()
    await act(async () => { await sw.click(); await uiRuntime.fixture.flush(); })
    expect(S().barWeights[SQUAT]).toBe(0)
    expect(host.textContent).toContain('Plates are counted from 0')
    expect(host.textContent).not.toContain('Bar (lb)')   // the stepper is gone while there is no bar
    await act(async () => { await host.querySelector('.switch, [role="switch"], input[type="checkbox"]').click(); await uiRuntime.fixture.flush(); })
    expect(S().barWeights[SQUAT]).toBeUndefined()
  })

  it('the bar stepper writes the override; stepping to 0 falls back to the default', async () => {
    await act(async () => { await barWeightSheet(SQUAT); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    const st = stepperOf(host, 'Bar (lb)')
    expect(st).toBeTruthy()
    expect(valueOf(st)).toBe('45')
    await act(async () => { await inc(st).click(); await uiRuntime.fixture.flush(); })
    expect(S().barWeights[SQUAT]).toBe(47.5)
    for (let i = 0; i < 19; i++) await act(async () => { await dec(stepperOf(host, 'Bar (lb)')).click(); await uiRuntime.fixture.flush(); })
    expect(S().barWeights[SQUAT]).toBeUndefined()
    expect(valueOf(stepperOf(host, 'Bar (lb)'))).toBe('45')
    expect(host.textContent).toContain('Default for this bar type.')
  })

  it('a machine can be made a single stack with its own base weight', async () => {
    await act(async () => { await barWeightSheet(LEG_PRESS); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    await act(async () => { await segButton(host, 'Single stack').click(); await uiRuntime.fixture.flush(); })
    expect(S().loadKind[LEG_PRESS]).toEqual(stamped('single'))
    const st = stepperOf(host, 'Base weight (lb)')
    expect(st).toBeTruthy()
    expect(host.textContent).not.toContain('No bar')
    expect(valueOf(st)).toBe('0')
    await act(async () => { await inc(st).click(); await uiRuntime.fixture.flush(); })
    expect(S().barWeights[LEG_PRESS]).toBe(2.5)
  })
})

describe('plate inventory sheet', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    await uiRuntime.fixture.applySnapshot({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('lists every lb size with the standard count; the first edit copies the set and changes one count', async () => {
    await act(async () => { await plateInventorySheet(); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(host.querySelector('h3').textContent).toBe('Plates')
    for (const w of ['45 lb', '35 lb', '25 lb', '15 lb', '10 lb', '5 lb', '2.5 lb', '1.25 lb']) expect(stepperOf(host, w), w).toBeTruthy()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('6')
    expect(valueOf(stepperOf(host, '15 lb'))).toBe('0')   // not in the standard set
    expect(stepperOf(host, '45 lb').textContent).toContain('pairs')
    expect(S().plates).toEqual({})
    for (let i = 0; i < 5; i++) await act(async () => { await dec(stepperOf(host, '45 lb')).click(); await uiRuntime.fixture.flush(); })
    expect(S().plates.lb[45]).toBe(1)
    expect(S().plates.lb[35]).toBe(6)     // the rest of the standard set came along
    expect(S().plates.lb[15]).toBeUndefined()
    expect(S().plates.lb._ts).toEqual(expect.any(Number))
    await act(async () => { await inc(stepperOf(host, '15 lb')).click(); await uiRuntime.fixture.flush(); })
    expect(S().plates.lb[15]).toBe(1)
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('1')
    expect(S().plates.kg).toBeUndefined()   // the other unit is untouched
    expect(host.textContent).toContain('Your own list for lb.')
  })

  it('"Back to the standard set" empties the unit\'s own list, stamped', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, plates: { lb: { 45: 1, _ts: 5 }, kg: { 20: 2 } } } }))
    await act(async () => { await plateInventorySheet(); await uiRuntime.fixture.flush(); })
    const host = (await mountTopSheet())
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('1')
    await act(async () => { await button(host, 'Back to the standard set').click(); await uiRuntime.fixture.flush(); })
    // A list with no sizes, not a deleted unit: the reset has to win a sync against the other
    // device's older list rather than get it back.
    expect(S().plates).toEqual({ lb: { _ts: expect.any(Number) }, kg: { 20: 2 } })
    expect(S().plates.lb._ts).toBeGreaterThan(5)
    expect(button(host, 'Back to the standard set')).toBeUndefined()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('6')
    expect(host.textContent).toContain('The standard set, plenty of each')
    // …and the next change starts from the standard set again.
    await act(async () => { await dec(stepperOf(host, '45 lb')).click(); await uiRuntime.fixture.flush(); })
    expect(S().plates.lb[45]).toBe(5)
    expect(S().plates.lb[35]).toBe(6)
  })
})
