// @vitest-environment happy-dom
// Finishing a workout while a timed hold counts down. Discard has stopped the hold since GL!59;
// Finish stopped only the rest timer, so the hold bar (app-wide, App.jsx) went on counting over
// the summary and Home, chimed at zero, and its callback then wrote into a workout that was gone.

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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, finishWorkoutSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

// Mounted before the click's own act(): a render nested inside it lands only once it is over.
async function tapInTopSheet(text) {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  const target = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  expect(target, text).toBeTruthy()
  await act(async () => { target.click(); await uiRuntime.fixture.flush(); })
}

async function install(sets) {
  const st = clone(DEF)
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineId: null, name: 'Core', bw: null, cur: 0,
    entries: [{ id: EXDB[0].id, target: { mode: 'reps', sets: sets.length, reps: 5, weight: 40 }, sets }]
  }
  await uiRuntime.fixture.applySnapshot({ S: st, user: null })
}

// Shaped like the row's own callback in views/Workout.jsx: it writes what was held into the set.
const holdInto = set => vi.fn(elapsed => useStore.getState().update(s => { s.active.entries[0].sets[set].sec = elapsed }))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
  useUI.getState().stopWork()
  vi.useRealTimers()
})

describe('finishing while a timed hold runs', () => {
  it('stops the hold, which then never calls back into the finished workout', async () => {
    await install([{ w: 40, r: 5, done: true }])
    const held = holdInto(0)
    useUI.getState().startWork(45, 'Plank', held)

    await act(async () => { await finishWorkout(); await uiRuntime.fixture.flush(); })

    expect(S().active).toBeNull()
    expect(S().workouts).toHaveLength(1)
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })

  it('stops it too when the hold is the set left unchecked and Finish early is confirmed', async () => {
    await install([{ w: 40, r: 5, done: true }, { w: 40, r: 5 }])
    const held = holdInto(1)
    useUI.getState().startWork(45, 'Plank', held)

    await act(async () => { await finishWorkout(); await uiRuntime.fixture.flush(); })
    await tapInTopSheet('Finish workout')

    expect(S().active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })
})

// The header's Finish pill (v1.3.11): a sheet with Finish and save and Discard workout, the
// unchecked-sets warning as its subtitle, and no second question after Finish and save.
describe('the Finish sheet', () => {
  const sheetText = async () => {
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
    return host
  }
  const tapItem = async (host, text) => await act(async () => { [...host.querySelectorAll('.menu-item')].find(el => el.textContent.includes(text)).click(); await uiRuntime.fixture.flush(); })

  it('all sets done: Finish workout? and a save that needs no confirm', async () => {
    await install([{ w: 40, r: 5, done: true }])
    await act(async () => { await finishWorkoutSheet({ onDiscard: vi.fn() }); await uiRuntime.fixture.flush(); })
    const host = (await sheetText())
    expect(host.querySelector('h3').textContent).toBe('Finish workout?')
    expect([...host.querySelectorAll('.menu-item .tt')].map(e => e.textContent)).toEqual(['Finish and save', 'Discard workout'])
    expect(host.querySelector('.menu-item.danger').textContent).toContain('Discard workout')
    await tapItem(host, 'Finish and save')
    expect(S().active).toBeNull()
    expect(S().workouts).toHaveLength(1)
  })

  it('keeps the early-finish wording as its message, and Discard calls the screen\'s own discard', async () => {
    await install([{ w: 40, r: 5, done: true }, { w: 40, r: 5 }, { w: 40, r: 5 }])
    const onDiscard = vi.fn()
    await act(async () => { await finishWorkoutSheet({ onDiscard }); await uiRuntime.fixture.flush(); })
    const host = (await sheetText())
    expect(host.querySelector('h3').textContent).toBe('Finish early?')
    expect(host.textContent).toContain('2 sets still unchecked. Finish the workout now?')
    await tapItem(host, 'Discard workout')
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(S().active).not.toBeNull()
  })

  it('nothing checked: says so', async () => {
    await install([{ w: 40, r: 5 }])
    await act(async () => { await finishWorkoutSheet({ onDiscard: vi.fn() }); await uiRuntime.fixture.flush(); })
    const host = (await sheetText())
    expect(host.querySelector('h3').textContent).toBe('Nothing logged yet')
    expect(host.textContent).toContain('You haven’t checked off any sets.')
  })
})
