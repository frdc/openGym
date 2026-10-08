// @vitest-environment happy-dom
// Issue #294: "Progression" (with its "No automatic progression" choice) and the switch below it
// read like two settings for the same thing. They are not, and the screen now says how.

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
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { POLICY_DESC } from '../lib/progression.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

async function renderRoutine(routine) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [], ...routine }]
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(
    <MemoryRouter initialEntries={['/routine/r1']}>
      <Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>
  ); await uiRuntime.fixture.flush(); })
}

const rowTitled = title => [...container.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const note = () => container.querySelector('.sect-b + .small.dim').textContent

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('routine progression wording (#294)', () => {
  it('names the switch for what it is: a deload routine, whose workouts do not count', async () => {
    await renderRoutine({})
    expect(rowTitled('Exclude from automatic progression')).toBeUndefined()
    const row = rowTitled('Deload routine')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('Its workouts do not count toward progression. They still show in history and statistics.')
  })

  it('says under the section what the chosen progression does, "no automatic progression" included', async () => {
    await renderRoutine({ prog: 'off' })
    expect(note()).toBe(POLICY_DESC.off + ' Applies to every exercise in this routine that does not set its own rule.')
    act(() => root.unmount())
    container.remove()
    await renderRoutine({})
    expect(note().startsWith(POLICY_DESC.linear)).toBe(true)
  })

  it('once it is a deload routine, says the progression choice does not apply to it', async () => {
    await renderRoutine({ excludeFromProgression: true })
    expect(note()).toBe('A deload routine opens at the numbers set here, so the progression above does not apply to it. The next regular target continues from the last included workout.')
  })

  it('the switch still writes the same routine flag the session builder reads', async () => {
    await renderRoutine({})
    await act(async () => { await rowTitled('Deload routine').querySelector('[role="switch"]').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].excludeFromProgression).toBe(true)
    await act(async () => { await rowTitled('Deload routine').querySelector('[role="switch"]').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].excludeFromProgression).toBeUndefined()
  })
})
