// @vitest-environment happy-dom

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = (await original())
  const { createUIStoreFixture } = (await import('../store/ui-test-runtime.js'))
  uiRuntime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: uiRuntime.fixture.useStore }
})
afterEach(async () => { await uiRuntime.fixture.close(); })
beforeEach(() => uiRuntime.fixture.begin())
afterEach(async () => { await uiRuntime.fixture.flush(); })
import { describe, expect, it, beforeEach, afterEach , vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { renameWorkoutSheet, addRoutineToSessionSheet } from '../sheets.jsx'
import { buildCompletedWorkout } from './finish-workout.js'

const mounted = []
async function render(open) {
  open()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}

const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const unmountAll = () => act(() => { mounted.splice(0).forEach(r => r.unmount()) })

describe('rename workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(unmountAll)

  it('renames an active workout and disables save on empty input', async () => {
    ;await uiRuntime.fixture.applySnapshot(s => ({
      S: {
        ...s.S,
        active: { id: 'w1', d: '2026-08-25', start: 1, name: 'Leg Day', entries: [] },
      },
    }));

    const host = (await render(() => renameWorkoutSheet()))
    const input = host.querySelector('input')
    const saveBtn = [...host.querySelectorAll('button')].find(b => /save/i.test(b.textContent))

    expect(input.value).toBe('Leg Day')
    expect(saveBtn.disabled).toBe(false)

    // Type blank whitespace
    await act(async () => { type(input, '   '); await uiRuntime.fixture.flush(); })
    expect(saveBtn.disabled).toBe(true)

    // Type a new title and save
    await act(async () => { type(input, 'Heavy Squats & Core'); await uiRuntime.fixture.flush(); })
    expect(saveBtn.disabled).toBe(false)
    await act(async () => { saveBtn.click(); await uiRuntime.fixture.flush(); })

    const active = useStore.getState().S.active
    expect(active.name).toBe('Heavy Squats & Core')
    expect(active.customName).toBe(true)

    // Survives completion
    const completed = buildCompletedWorkout(active, { end: 2 })
    expect(completed.name).toBe('Heavy Squats & Core')
  })

  it('submits on Enter key press', async () => {
    ;await uiRuntime.fixture.applySnapshot(s => ({
      S: {
        ...s.S,
        active: { id: 'w1', d: '2026-08-25', start: 1, name: 'Upper A', entries: [] },
      },
    }));

    const host = (await render(() => renameWorkoutSheet()))
    const input = host.querySelector('input')

    await act(async () => { type(input, 'Upper Power'); await uiRuntime.fixture.flush(); })
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await uiRuntime.fixture.flush(); })

    const active = useStore.getState().S.active
    expect(active.name).toBe('Upper Power')
    expect(active.customName).toBe(true)
  })

  it('preserves custom renamed title when another routine is added to the session', async () => {
    ;await uiRuntime.fixture.applySnapshot(s => ({
      S: {
        ...s.S,
        routines: [
          { id: 'r1', name: 'Routine 1', ex: [{ id: 'bench_press' }] },
          { id: 'r2', name: 'Routine 2', ex: [{ id: 'squat' }] },
        ],
        active: {
          id: 'w1',
          d: '2026-08-25',
          start: 1,
          name: 'My Special Workout',
          customName: true,
          routineIds: ['r1'],
          entries: [{ id: 'bench_press', sets: [] }],
        },
      },
    }));

    const host = (await render(() => addRoutineToSessionSheet()))
    // Click on Routine 2
    const items = [...host.querySelectorAll('.item')].filter(el => !el.classList.contains('disabled'))
    expect(items.length).toBeGreaterThan(0)
    await act(async () => { items[0].click(); await uiRuntime.fixture.flush(); })

    const active = useStore.getState().S.active
    // The name should remain 'My Special Workout' instead of being overwritten with 'Routine 1 + Routine 2'
    expect(active.name).toBe('My Special Workout')
    expect(active.routineIds).toContain('r2')
  })
})
