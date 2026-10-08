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
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it , vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { beginWorkout, logPastWorkoutSheet } from './sheets.jsx'
import { todayISO } from './lib/format.js'

// beginWorkout / beginBackfill snapshot S.workoutView onto s.active so the header ⋮ can
// re-lay-out the running session without touching the saved default.

const mounted = []
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
async function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('workout view is snapshot onto the active session', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], workoutView: 'cards' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('beginWorkout copies the current default onto s.active', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workoutView: 'compact' } }))
    await act(async () => { await beginWorkout(null, null); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.workoutView).toBe('compact')
  })

  it('beginWorkout falls back to cards when the default is unset', async () => {
    await uiRuntime.fixture.applySnapshot(s => { const S = { ...s.S }; delete S.workoutView; return { S } })
    await act(async () => { await beginWorkout(null, null); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('later changes to the default leave the running session alone', async () => {
    await act(async () => { await beginWorkout(null, null); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.workoutView).toBe('cards')
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workoutView: 'list' } }))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('a backfilled session snapshots it too', async () => {
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workoutView: 'list' } }))
    logPastWorkoutSheet()
    const host = (await mountTopSheet())
    await act(async () => { type(host.querySelector('input[type=date]'), '2020-01-02'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Continue').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.workoutView).toBe('list')
  })
})
