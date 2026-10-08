// @vitest-environment happy-dom
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
// #378 / #358: a custom exercise stored without `custom: true` — what a plan import (a shared
// plan file, a plan from the AI coach) wrote before 1.3.8 — showed no Edit and no Delete, in the
// exercise sheet or in the routine's exercise settings, and its thumbnail went through the
// built-in renderer. Every one of those now asks where the exercise lives, not for the flag.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it , vi } from 'vitest'
import { createRoot } from 'react-dom/client'

import { registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { Thumb } from './components/Media.jsx'
import { customExSheet, exerciseDetailSheet, exConfigSheet } from './sheets.jsx'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S

async function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(el); await uiRuntime.fixture.flush(); })
  return host
}
const renderTop = async () => {
  const sheet = useUI.getState().sheets.at(-1)
  return (await render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent.trim())
const click = async (host, sel, text) => {
  const el = [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  await act(async () => { await el.click(); await uiRuntime.fixture.flush(); })
}

// Exactly what a pre-1.3.8 plan import stored: no flag, no equipment.
const legacy = () => ({ id: 'cx1', n: 'My row', bp: 'back' })
async function seed(ex, extra = {}) {
  await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, customEx: [ex], ...extra } }))
  registerCustom([ex])
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  await uiRuntime.fixture.applySnapshot({ S: structuredClone(DEF), user: null, config: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  registerCustom([])
})

describe('a custom exercise stored without the flag', () => {
  it('its sheet offers Edit and Delete', async () => {
    const ex = legacy()
    await seed(ex)
    exerciseDetailSheet(ex)
    const host = (await renderTop())
    expect(buttons(host)).toEqual(expect.arrayContaining(['Edit', 'Delete']))
  })

  it('Edit opens the form filled in with it', async () => {
    const ex = legacy()
    await seed(ex)
    exerciseDetailSheet(ex)
    await click((await renderTop()), 'button', 'Edit')
    const form = (await renderTop())
    expect(form.textContent).toContain('Edit custom exercise')
    expect(form.querySelector('input.input').value).toBe('My row')
    expect(form.querySelector('.chip.on').textContent).toBe('back')
  })

  it('Delete takes it out of the routines and keeps the name in history', async () => {
    const ex = legacy()
    ;await seed(ex, {
      routines: [{ id: 'r1', name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 8, w: 40 }, { id: '0027', sets: 3, reps: 8, w: 40 }] }],
      workouts: [{ d: '2026-09-01', entries: [{ id: 'cx1', sets: [{ r: 8, w: 40, done: true }] }] }],
    });
    exerciseDetailSheet(ex)
    await click((await renderTop()), 'button', 'Delete')
    await click((await renderTop()), 'button', 'Delete')   // the confirmation
    expect(S().customEx).toEqual([])
    expect(S().routines[0].ex.map(e => e.id)).toEqual(['0027'])
    expect(S().workouts[0].entries[0].n).toBe('My row')
  })

  it('the routine exercise settings offer "Edit or delete this exercise"', async () => {
    const ex = legacy()
    await seed(ex)
    exConfigSheet(ex, { id: 'cx1', sets: 3, reps: 8, w: 40 }, () => {})
    expect(buttons((await renderTop()))).toContain('Edit or delete this exercise')
  })

  it('its thumbnail is the custom one, never a dataset image', async () => {
    const ex = { ...legacy(), img: 'stray.jpg' }
    await seed(ex)
    const host = (await render(<Thumb ex={ex} />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })

  it('equipment from an import that the list lacks counts as picked, so Save works', async () => {
    const ex = { ...legacy(), eq: 'custom', custom: true }
    await seed(ex)
    customExSheet(ex)
    const form = (await renderTop())
    expect([...form.querySelectorAll('.chip.on')].map(c => c.textContent)).toContain('custom')
    await act(async () => { const el = form.querySelector('input.input')
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, 'My cable row')
      el.dispatchEvent(new Event('input', { bubbles: true })); await uiRuntime.fixture.flush(); })
    await click(form, 'button', 'Save')
    expect(S().customEx[0]).toMatchObject({ id: 'cx1', n: 'My cable row', eq: 'custom' })
  })
})

describe('the store heals it', () => {
  it('a copy that enters the store gets the flag back, without a new stamp on the entry', async () => {
    await uiRuntime.fixture.prepare({ ...structuredClone(DEF), customEx: [{ ...legacy(), _ts: 7 }] })
    expect(S().customEx[0]).toMatchObject({ id: 'cx1', custom: true, eq: '', _ts: 7 })
    const healed = S().customEx
    useStore.getState().update(s => { s.restSec = 90 })
    expect(S().customEx[0]._ts).toBe(7)   // healing twice changes nothing
    expect(S().customEx[0]).toEqual(healed[0])
  })
})
