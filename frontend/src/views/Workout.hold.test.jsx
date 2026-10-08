// @vitest-environment happy-dom
// The end of a hold, against the real store and work timer: it sounds once. The chime and its
// buzz pattern belong to the timer (store/useUI.js); the set it ticks adds neither its own beep,
// which clipped the chime's first note, nor its short buzz, which cut the pattern off.

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
import { beep, chime, vibrate, alertBuzz } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const plank = () => ({ id: '1001', target: { mode: 'time', sets: 2, sec: 10 }, sets: [{ sec: 10, w: 0, done: false }, { sec: 10, w: 0, done: false }] })

let root
let container

async function renderWorkout(entries) {
  const S = clone(DEF)
  S.sound = true
  S.active = { id: 'hold-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Hold', bw: null, cur: 0, entries }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(<MemoryRouter><Workout /></MemoryRouter>); await uiRuntime.fixture.flush(); })
}

const startHold = async () => {
  const go = container.querySelector('button[aria-label="Start set"]')
  expect(go).toBeTruthy()
  await act(async () => { await go.click(); await uiRuntime.fixture.flush(); })
  expect(useUI.getState().work).not.toBeNull()
}
const tickBeeps = () => beep.mock.calls.filter(call => call[1] === 1040)
const doneOf = () => useStore.getState().S.active.entries[0].sets.map(s => s.done)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(beep).mockClear(); vi.mocked(chime).mockClear(); vi.mocked(vibrate).mockClear(); vi.mocked(alertBuzz).mockClear()
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

describe('the end of a hold', () => {
  it('ran out on its own: the chime and its buzz pattern, and no tick beep or short buzz after them', async () => {
    await renderWorkout([plank()])
    await startHold()
    await act(async () => { vi.advanceTimersByTime(11_000); await uiRuntime.fixture.flush(); })
    expect(doneOf()).toEqual([true, false])
    expect(chime).toHaveBeenCalledOnce()
    expect(tickBeeps()).toEqual([])
    // The end's buzz goes through alertBuzz, which can buzz as an alarm on silent (#375).
    expect(alertBuzz.mock.calls).toEqual([[[200, 100, 200]]])
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('finished early with Done: the set ticks the way a tap does, beep and buzz', async () => {
    await renderWorkout([plank()])
    await startHold()
    await act(async () => { vi.advanceTimersByTime(4_000); await uiRuntime.fixture.flush(); })
    await act(async () => { await useUI.getState().finishWorkEarly(); await uiRuntime.fixture.flush(); })
    expect(doneOf()).toEqual([true, false])
    expect(chime).not.toHaveBeenCalled()
    expect(tickBeeps()).toHaveLength(1)
    expect(vibrate).toHaveBeenLastCalledWith(30)
  })
})

// Owner's call: a timed per-side set pauses ten seconds to switch sides between its left and
// right hold, and rests in full only once both are held.
describe('a per-side hold', () => {
  const sidePlank = () => ({ id: '1001', target: { mode: 'time', sets: 2, sec: 10, side: true }, sets: [
    { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
    { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
  ] })
  const holdRow = async n => {
    const go = container.querySelectorAll('button[aria-label="Start set"]')[n]
    await act(async () => { await go.click(); await uiRuntime.fixture.flush(); })
    await act(async () => { vi.advanceTimersByTime(11_000); await uiRuntime.fixture.flush(); })
  }

  it('left held: a 10 s "Switch sides" countdown, which ends with the chime and goes', async () => {
    await renderWorkout([sidePlank()])
    await holdRow(0)
    expect(doneOf()).toEqual([true, false, false, false])
    const tm = useUI.getState().timer
    expect(tm).toMatchObject({ kind: 'switch', total: 10 })
    expect(chime).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(10_000); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().timer).toBeNull()
    expect(chime).toHaveBeenCalledTimes(2)
    expect(alertBuzz).toHaveBeenCalledTimes(2)
  })

  it('right held too: the set\'s full rest, not another switch', async () => {
    await renderWorkout([sidePlank()])
    await holdRow(0)
    await holdRow(1)
    expect(doneOf()).toEqual([true, true, false, false])
    const tm = useUI.getState().timer
    expect(tm.kind).toBeUndefined()
    expect(tm.total).toBe(useStore.getState().S.restSec)
  })

  it('Left and Right pills carry both words, so they are one width (#322)', async () => {
    await renderWorkout([sidePlank()])
    const pills = [...container.querySelectorAll('.sidepill')]
    expect(pills.map(p => p.textContent)).toEqual(['Left', 'Right', 'Left', 'Right'])
    for (const p of pills) expect([p.dataset.l, p.dataset.r]).toEqual(['Left', 'Right'])
  })
})
