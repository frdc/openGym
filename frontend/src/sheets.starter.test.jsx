// @vitest-environment happy-dom
// The chooser is where a starter plan can quietly do the wrong thing: overwrite a weekday
// without asking, ask when there was nothing to overwrite, or apply a plan the user cancelled.

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
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { loadStarterPlan, starterPlanSheet } from './sheets.jsx'

const mounted = []

const S = () => useStore.getState().S
// S.week[day] is a routine-id list now; the starter plan writes a one-element list per day.
const nameOn = day => S().routines.find(r => r.id === [].concat(S().week[day] ?? [])[0])?.name

// Renders whatever sheet is on top and returns its host element.
async function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}

const rowFor = (host, name) => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const buttonFor = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent === label)

// Opens the chooser and taps one of its rows.
async function choose(name) {
  starterPlanSheet()
  const host = (await renderTop())
  await act(async () => { rowFor(host, name).click(); await uiRuntime.fixture.flush(); })
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  ;await uiRuntime.fixture.applySnapshot(s => ({
    S: { ...s.S, routines: [{ id: 'mine', name: 'My routine', emoji: 'star', ex: [] }], week: {}, active: null },
  }));
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('starter plan chooser', () => {
  it('lists every plan with its day count', async () => {
    starterPlanSheet()
    const host = (await renderTop())
    expect([...host.querySelectorAll('.item .tt')].map(el => el.textContent))
      .toEqual(['Push / Pull / Legs', 'Upper / Lower', 'Full Body', '5×5'])
    expect(rowFor(host, 'Upper / Lower').querySelector('.ss').textContent).toContain('4 days per week')
  })

  it('loads straight away when the plan’s weekdays are free, without asking', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, week: { 0: ['mine'], 6: ['mine'] } } }))
    await choose('Upper / Lower')

    expect(useUI.getState().sheets).toHaveLength(0)   // no confirmation was raised
    expect(nameOn(1)).toBe('Upper A')
    expect(nameOn(2)).toBe('Lower A')
    expect(nameOn(4)).toBe('Upper B')
    expect(nameOn(5)).toBe('Lower B')
    expect(S().week[0]).toEqual(['mine'])             // untouched weekdays stay put
    expect(S().week[6]).toEqual(['mine'])
    expect(S().routines[0].name).toBe('My routine')   // and nothing is deleted
    expect(useUI.getState().toastMsg).toBe('Upper / Lower loaded')
  })

  it('loading the same plan twice reuses its routines instead of duplicating them', () => {
    expect(loadStarterPlan('upper-lower')).toBe(true)
    const ids = S().routines.map(r => r.id)
    const week = structuredClone(S().week)
    expect(loadStarterPlan('upper-lower')).toBe(true)
    expect(S().routines.map(r => r.id)).toEqual(ids)
    expect(S().routines.filter(r => r.name === 'Upper A')).toHaveLength(1)
    expect(S().week).toEqual(week)
  })

  it('asks first when a weekday the plan wants is already taken', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, week: { 3: ['mine'] } } }))
    await choose('Full Body')

    const confirm = (await renderTop())
    expect(confirm.querySelector('h3').textContent).toBe('Load Full Body?')
    expect(confirm.textContent).toContain('Monday, Wednesday and Friday')
    expect(S().week[3]).toEqual(['mine'])                  // nothing applied yet
    expect(S().routines).toHaveLength(1)

    await act(async () => { buttonFor(confirm, 'Load plan').click(); await uiRuntime.fixture.flush(); })
    expect(nameOn(1)).toBe('Full Body A')
    expect(nameOn(3)).toBe('Full Body B')
    expect(nameOn(5)).toBe('Full Body C')
  })

  it('leaves everything alone when the confirmation is cancelled', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, week: { 1: ['mine'] } } }))
    const before = structuredClone(S())
    await choose('5×5')

    const confirm = (await renderTop())
    await act(async () => { buttonFor(confirm, 'Cancel').click(); await uiRuntime.fixture.flush(); })
    expect(S()).toEqual(before)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('does not ask when only weekdays outside the plan are occupied', async () => {
    ;await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, week: { 2: ['mine'], 4: ['mine'] } } }));await choose('5×5');                                                                // wants Mon/Wed/Fri
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(nameOn(1)).toBe('5×5 A')
  })
})

describe('loadStarterPlan', () => {
  it('two different plans add independent routines', () => {
    loadStarterPlan('ppl')
    const first = S().routines.slice(1).map(r => r.id)
    loadStarterPlan('full-body')
    const second = S().routines.slice(4).map(r => r.id)
    expect(S().routines).toHaveLength(7)
    expect(new Set([...first, ...second]).size).toBe(6)
  })

  it('refuses a plan it does not know and changes nothing', () => {
    const before = structuredClone(S())
    expect(loadStarterPlan('nope')).toBe(false)
    expect(loadStarterPlan(undefined)).toBe(false)
    expect(S()).toEqual(before)
    expect(useUI.getState().toastMsg).toBe('')
  })
})
