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
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { removeActiveExercise } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { LANGS, DERIVED_LOCALES } from '../lib/i18n-core.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, sg) => ({
  id,
  ...(sg ? { sg } : {}),
  target: { sets: 1, reps: 1 },
  sets: [{ w: 0, r: 1, done: false }]
})

let root
let container
let sheetRoot
let sheetContainer

async function setActive(entries, cur = 0) {
  const S = clone(DEF)
  S.wc = { ...S.wc, exerciseButtons: true }   // the removal button is opt-in now; the menu path is covered in Workout.test.jsx
  S.active = {
    id: 'remove-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Remove test', bw: null, cur, entries
  }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
}

async function renderWorkout(entries) {
  await setActive(entries)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(<MemoryRouter><Workout /></MemoryRouter>); await uiRuntime.fixture.flush(); })
}

function removeButton() {
  return [...container.querySelectorAll('button')].find(button => button.textContent.includes('Remove exercise'))
}

async function renderTopSheet() {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  await act(async () => { await sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return sheetContainer
}

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  await uiRuntime.fixture.applySnapshot({ S: clone(DEF), user: null })
  root = null
  container = null
  sheetRoot = null
  sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('active-session exercise removal', () => {
  it('disables removal for the whole duration of a timed hold', async () => {
    await renderWorkout([entry('1001')])
    expect(removeButton()).toBeTruthy()
    expect(removeButton().disabled).toBe(false)

    await act(async () => { await useUI.getState().startWork(30, 'Hold', vi.fn()); await uiRuntime.fixture.flush(); })

    expect(removeButton().disabled).toBe(true)
  })

  it('cancels a pending timed callback before indexes shift and cleans a one-member group', async () => {
    await setActive([entry('1001', 'sg-1'), entry('1002', 'sg-1'), entry('1003')], 1)
    expect(useStore.getState().S.active.cur).toBe(1)
    const wrongWrite = vi.fn(elapsed => {
      useStore.getState().update(s => { s.active.entries[0].sets[0].sec = elapsed })
    })
    useUI.getState().startWork(5, 'Hold', wrongWrite)

    removeActiveExercise(0)
    vi.advanceTimersByTime(10_000)

    const active = useStore.getState().S.active
    expect(useUI.getState().work).toBeNull()
    expect(wrongWrite).not.toHaveBeenCalled()
    expect(active.entries.map(e => e.id)).toEqual(['1002', '1003'])
    expect(active.cur).toBe(0)
    expect(active.entries[0].sg).toBeUndefined()
    expect(active.entries[0].sets[0].sec).toBeUndefined()
  })

  it('cancels a running rest countdown when the exercise it belongs to is removed', async () => {
    await setActive([entry('1001'), entry('1002')], 0)
    useUI.getState().startRest(90, 0)
    expect(useUI.getState().timer).not.toBeNull()

    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })

    expect(useUI.getState().timer).toBeNull()
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])
  })

  it('keeps a rest countdown that belongs to another exercise, re-pointed at it', async () => {
    await setActive([entry('1001'), entry('1002'), entry('1003')], 1)
    useUI.getState().startRest(90, 1)

    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().timer?.forIdx).toBe(0)
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002', '1003'])

    await act(async () => { removeActiveExercise(1); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().timer?.forIdx).toBe(0)
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])

    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().timer).toBeNull()
  })

  it('leaves a rest countdown without a known owner running', async () => {
    await setActive([entry('1001'), entry('1002')], 0)
    useUI.getState().startRest(90)

    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().timer).not.toBeNull()
  })

  it('does not mutate before confirmation, leaves state unchanged on Cancel, and removes on Confirm', async () => {
    await renderWorkout([entry('1001'), entry('1002')])

    await act(async () => { await removeButton().click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '1002'])

    let dialog = (await renderTopSheet())
    const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancel')
    await act(async () => { await cancel.click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '1002'])

    await act(async () => { await removeButton().click(); await uiRuntime.fixture.flush(); })
    dialog = (await renderTopSheet())
    const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Remove')
    await act(async () => { await confirm.click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])
  })

  it('uses the selected superset member occurrence rather than its exercise id', async () => {
    await renderWorkout([entry('1001', 'pair'), entry('1001', 'pair'), entry('1002')])
    useStore.getState().update(s => {
      s.active.entries[0].target.marker = 'keep-first'
      s.active.entries[1].target.marker = 'remove-second'
    }, false)

    await act(async () => { await removeButton().click(); await uiRuntime.fixture.flush(); })
    const chooser = (await renderTopSheet())
    const choices = [...chooser.querySelectorAll('.item')]
    expect(choices).toHaveLength(2)
    await act(async () => { await choices[1].click(); await uiRuntime.fixture.flush(); })

    const dialog = (await renderTopSheet())
    const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Remove')
    await act(async () => { await confirm.click(); await uiRuntime.fixture.flush(); })

    const active = useStore.getState().S.active
    expect(active.entries.map(e => e.id)).toEqual(['1001', '1002'])
    expect(active.entries[0].target.marker).toBe('keep-first')
    expect(active.entries[0].sg).toBeUndefined()
  })

  it('hides the remove control for an empty freestyle session', async () => {
    await renderWorkout([])
    expect(removeButton()).toBeUndefined()
  })
})

describe('remove-exercise locale coverage', () => {
  const required = [
    'Remove {0}?',
    'The sets you logged for this exercise in this session will be lost.',
    'This removes the exercise from your current session.',
    'Remove',
    'Which exercise in this superset do you want to remove?'
  ]
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  // Every non-English language has its own pack (English is the source, so it has none),
  // except a derived locale such as de-CH, which transforms its base language's pack at load
  // time — computed from LANGS rather than hardcoded so adding a language doesn't silently
  // understate this test's own coverage.
  const nonEnglishLangCount = Object.keys(LANGS)
    .filter(code => code !== 'en' && !DERIVED_LOCALES[code]).length

  it('defines every new prompt in every non-English locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(nonEnglishLangCount)
    expect(Object.keys(packs).some(p => p.endsWith('/ar.js'))).toBe(true)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty(key))
    })
  })
})

describe('remove-exercise edge cases', () => {
  it('removing the last remaining exercise leaves an empty, coherent session', async () => {
    await setActive([entry('a')], 0)
    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })
    const A = useStore.getState().S.active
    expect(A.entries).toHaveLength(0)
    expect(A.cur).toBe(0)
  })

  it('removing one half of a two-member superset dissolves the group', async () => {
    await setActive([entry('a', 'g1'), entry('b', 'g1'), entry('c')], 0)
    await act(async () => { removeActiveExercise(1); await uiRuntime.fixture.flush(); })
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual(['a', 'c'])
    // A superset of one is not a superset.
    expect(A.entries[0].sg).toBeUndefined()
  })

  it('removing an entry below the active one keeps cur on the same exercise', async () => {
    await setActive([entry('a'), entry('b'), entry('c')], 2)
    await act(async () => { removeActiveExercise(0); await uiRuntime.fixture.flush(); })
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual(['b', 'c'])
    expect(A.entries[A.cur].id).toBe('c')
  })

  it('persists the shortened active session for reload without changing completed history', async () => {
    const first = entry('same')
    first.target.marker = 'keep-first'
    const second = entry('same')
    second.target.marker = 'remove-second'
    await setActive([first, second, entry('other')], 1)
    const workouts = [{ id: 'completed', d: '2026-08-10', entries: [{ id: 'same', sets: [{ w: 42, r: 5, done: true }] }] }]
    await uiRuntime.fixture.applySnapshot(state => ({ S: { ...state.S, workouts: clone(workouts) } }))

    await act(async () => { removeActiveExercise(1); await uiRuntime.fixture.flush(); })

    const persisted = (await uiRuntime.fixture.saved()).state
    expect(persisted.workouts).toEqual(workouts)
    expect(persisted.active.entries.map(e => e.id)).toEqual(['same', 'other'])
    expect(persisted.active.entries[0].target.marker).toBe('keep-first')
    expect(persisted.active.cur).toBe(1)

    await uiRuntime.fixture.applySnapshot({ S: Object.assign(clone(DEF), persisted), user: null })
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['same', 'other'])
    expect(useStore.getState().S.workouts).toEqual(workouts)
  })
})
