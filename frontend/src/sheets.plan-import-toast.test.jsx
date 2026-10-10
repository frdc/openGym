// @vitest-environment happy-dom
// Importing a one-routine plan file toasted "Added 1 routines to your plan" (QA copy): the
// sheet's summary line already picked the singular, the toast after the merge did not.

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
import { planImportSheet } from './sheets.jsx'
import { parsePlan } from './lib/plan-share.js'
import { EXDB } from './lib/exercises.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter(e => e.bp !== 'cardio').slice(0, 2).map(e => e.id)
const mounted = []

async function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}
const buttonFor = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const bundleOf = routines => parsePlan({ opengym_plan: 1, unit: 'kg', week: {}, routines, customEx: [] }, 'kg')
const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: ids[0], sets: 3, reps: 8, weight: 40 }] })

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  const S = clone(useStore.getState().S)
  S.routines = []
  S.week = {}
  await uiRuntime.fixture.applySnapshot({ S, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('Plan import sheet — the toast counts what it added', () => {
  it('says "1 routine" for a single routine', async () => {
    planImportSheet(bundleOf([routine('a', 'Push')]))
    const host = (await renderTop())
    await act(async () => { buttonFor(host, 'Add to my plan').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines).toHaveLength(1)
    expect(useUI.getState().toastMsg).toBe('Added 1 routine to your plan')
  })

  it('keeps the plural for several', async () => {
    planImportSheet(bundleOf([routine('a', 'Push'), routine('b', 'Pull')]))
    const host = (await renderTop())
    await act(async () => { buttonFor(host, 'Add to my plan').click(); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().toastMsg).toBe('Added 2 routines to your plan')
  })
})
