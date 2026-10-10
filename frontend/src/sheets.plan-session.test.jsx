// @vitest-environment happy-dom
// "Saved as 2 × 10, the training day shows 2 × 15" (Discord report, #275), end to end through the
// real store: beginWorkout → tick the rows → finishWorkout → edit the routine the way the routine
// editor saves it → beginWorkout again. Nothing here calls the prescription directly: the rows are
// what the workout screen would render.

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
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { isWarmupRow } from './lib/workout-model.js'

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const upd = async fn => await act(async () => { await useStore.getState().update(fn); await uiRuntime.fixture.flush(); })
const rowsOf = rid => S().active.entries.filter(e => e.rid === rid && e.id === BENCH)
  .map(e => e.sets.filter(s => !isWarmupRow(s)).map(s => `${s.w}x${s.r}`))[0]

async function install(routines, extra = {}) {
  const st = clone(DEF)
  Object.assign(st, { routines, week: { 1: ['A'] }, active: null, workouts: [], weighIn: false }, extra)
  await uiRuntime.fixture.applySnapshot({ S: st, user: null })
}

async function startOn(day, rids) {
  vi.setSystemTime(new Date(day + 'T17:00:00'))
  await act(async () => { await beginWorkout(rids, null); await uiRuntime.fixture.flush(); })
}

// Tick every row, optionally typing a rep count first (what the stepper would write), and finish.
async function trainActive(day, typedReps) {
  vi.setSystemTime(new Date(day + 'T18:00:00'))
  ;await upd(s => s.active.entries.forEach(e => e.sets.forEach(x => {
    if (!isWarmupRow(x) && typedReps != null) x.r = typedReps
    x.done = true
  })));
  await act(async () => { await finishWorkout(); await uiRuntime.fixture.flush(); })
  useUI.setState({ sheets: [] })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear()
  useUI.setState({ sheets: [] })
})
afterEach(() => { vi.useRealTimers() })

describe('what you plan is what you train', () => {
  it('a routine edited from 2 × 15 to 2 × 10 opens at 10 on the next training day', async () => {
    await install([{ id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 50, mode: 'reps' }] }])
    await startOn('2026-09-07', ['A'])
    expect(rowsOf('A')).toEqual(['50x15', '50x15'])
    await trainActive('2026-09-07')
    expect(S().workouts[0].entries[0].target.reps).toBe(15)

    await upd(s => { s.routines[0].ex[0] = { ...s.routines[0].ex[0], reps: 10 } })
    await startOn('2026-09-14', ['A'])
    expect(S().active.entries[0].target.reps).toBe(10)
    expect(rowsOf('A')).toEqual(['50x10', '50x10'])
  })

  it('logging 15 once on a 2 × 10 plan does not turn every later session into 15s', async () => {
    await install([{ id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, mode: 'reps' }] }])
    await startOn('2026-09-07', ['A'])
    expect(rowsOf('A')).toEqual(['50x10', '50x10'])
    await trainActive('2026-09-07', 15)
    await startOn('2026-09-14', ['A'])
    expect(rowsOf('A')).toEqual(['52.5x10', '52.5x10'])
  })

  it('a routine trains its own line: Plan B on Wednesday does not move Plan A on Monday (#216)', async () => {
    ;await install([
      { id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 60, mode: 'reps' }] },
      { id: 'B', name: 'Plan B', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 40, mode: 'reps' }] },
    ]);
    await startOn('2026-09-07', ['A'])
    expect(rowsOf('A')).toEqual(['60x10', '60x10'])
    await trainActive('2026-09-07')
    await startOn('2026-09-09', ['B'])
    // B's first time: B's own plan, the light day's 40 at its 15 reps — not the heavy day's 60
    expect(rowsOf('B')).toEqual(['40x15', '40x15'])
    await trainActive('2026-09-09', 12)
    await startOn('2026-09-14', ['A'])
    expect(rowsOf('A')).toEqual(['62.5x10', '62.5x10'])  // A's own line, not B's miss
    await trainActive('2026-09-14')
    await startOn('2026-09-16', ['B'])
    expect(rowsOf('B')).toEqual(['40x15', '40x15'])      // B holds after its own miss
  })

  it('"Your last session" still carries the 15s over', async () => {
    await install([{ id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, mode: 'reps' }] }], { startFrom: 'last' })
    await startOn('2026-09-07', ['A'])
    await trainActive('2026-09-07', 15)
    await startOn('2026-09-14', ['A'])
    expect(rowsOf('A')).toEqual(['52.5x15', '52.5x15'])
  })
})
