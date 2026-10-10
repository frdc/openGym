// @vitest-environment happy-dom
// Hardware keys on the workout screen (issue #133), against the real store and timers: what a
// key press does to the session, not only what lib/workout-keys.js decides.

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
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, done, extra = {}) => ({
  id,
  target: { sets: done.length, reps: 5, weight: 60 },
  sets: done.map(d => ({ w: 60, r: 5, done: d })),
  ...extra,
})

let root
let container

async function renderWorkout(entries, cur = 0, extra = {}) {
  const S = clone(DEF)
  S.active = { id: 'keys-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Keys', bw: null, cur, entries, ...extra }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(<MemoryRouter><Workout /></MemoryRouter>); await uiRuntime.fixture.flush(); })
}

const press = async (key, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => { target.dispatchEvent(event); await uiRuntime.fixture.flush(); })
  return event
}
const active = () => useStore.getState().S.active
const doneOf = idx => active().entries[idx].sets.map(s => s.done)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('workout keys (issue #133)', () => {
  it('Space ticks the next open set of the current exercise and starts its rest', async () => {
    await renderWorkout([entry('1001', [true, false, false]), entry('1002', [false])])
    const event = (await press(' '))
    expect(event.defaultPrevented).toBe(true)   // the page does not scroll as well
    expect(doneOf(0)).toEqual([true, true, false])
    expect(useUI.getState().timer).not.toBeNull()
    await press('Enter')
    expect(doneOf(0)).toEqual([true, true, true])
  })

  it('once the exercise on screen is finished, a press brings up the next one and the next press ticks it', async () => {
    await renderWorkout([entry('1001', [true]), entry('1002', [false, false])])
    await press(' ')
    expect(active().cur).toBe(1)
    expect(doneOf(1)).toEqual([false, false])
    await press(' ')
    expect(doneOf(1)).toEqual([true, false])
  })

  it('the arrows switch exercise', async () => {
    await renderWorkout([entry('1001', [false]), entry('1002', [false]), entry('1003', [false])])
    await press('ArrowRight')
    expect(active().cur).toBe(1)
    await press('ArrowRight')
    expect(active().cur).toBe(2)
    await press('ArrowRight')
    expect(active().cur).toBe(2)
    await press('ArrowLeft')
    expect(active().cur).toBe(1)
    expect(doneOf(0).concat(doneOf(1), doneOf(2))).toEqual([false, false, false])
  })

  it('in the list, an arrow that moves the current exercise brings it into view', async () => {
    const scrolled = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { scrolled.push(this) }
    try {
      await renderWorkout([entry('1001', [false]), entry('1002', [false])], 0, { workoutView: 'list' })
      await act(async () => { vi.advanceTimersByTime(100); await uiRuntime.fixture.flush(); })
      scrolled.length = 0
      await press('ArrowRight')
      await act(async () => { vi.advanceTimersByTime(100); await uiRuntime.fixture.flush(); })
      expect(active().cur).toBe(1)
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].classList.contains('cur')).toBe(true)
      expect(scrolled[0].getAttribute('data-exidx')).toBe('1')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('keys typed into a set\'s field stay in the field', async () => {
    await renderWorkout([entry('1001', [false, false]), entry('1002', [false])])
    const input = container.querySelector('.setrow input')
    expect(input).toBeTruthy()
    input.focus()
    for (const key of [' ', 'Enter', 'ArrowRight']) expect((await press(key, input)).defaultPrevented).toBe(false)
    expect(doneOf(0)).toEqual([false, false])
    expect(active().cur).toBe(0)
  })

  it('does nothing while a sheet is open on top', async () => {
    await renderWorkout([entry('1001', [false]), entry('1002', [false])])
    useUI.getState().openSheet(() => null)
    await press(' ')
    await press('ArrowRight')
    expect(doneOf(0)).toEqual([false])
    expect(active().cur).toBe(0)
  })

  it('a timed set is started rather than ticked, and the next press is its Done', async () => {
    const plank = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    await renderWorkout([plank])
    await press(' ')
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    await act(async () => { vi.advanceTimersByTime(10_000); await uiRuntime.fixture.flush(); })
    await press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(10)
  })

  it('a second press right after it starts a hold does not log the hold at a second', async () => {
    // A USB button that bounces, or a double press.
    const plank = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    await renderWorkout([plank])
    await press(' ')
    await act(async () => { vi.advanceTimersByTime(200); await uiRuntime.fixture.flush(); })
    const second = (await press(' '))
    expect(second.defaultPrevented).toBe(true)   // still the workout's key, it just does nothing
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    await act(async () => { vi.advanceTimersByTime(2_000); await uiRuntime.fixture.flush(); })
    await press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(2)
  })

  it('stops listening when the workout screen goes away', async () => {
    await renderWorkout([entry('1001', [false])])
    act(() => root.unmount())
    root = null
    await press(' ')
    expect(doneOf(0)).toEqual([false])
  })
})
