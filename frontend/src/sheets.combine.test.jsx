// @vitest-environment happy-dom

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('./lib/wear-bridge.js', () => ({ requestWearWorkoutOpen: vi.fn() }))
import { requestWearWorkoutOpen } from './lib/wear-bridge.js'
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
import { beforeEach, describe, expect, it , vi , afterEach } from 'vitest'
import { beginWorkout } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter(e => e.bp !== 'cardio').slice(0, 3).map(e => e.id)

async function install(routines, week = {}) {
  const S = clone(DEF)
  S.routines = routines
  S.week = week
  S.active = null
  S.workouts = []
  await uiRuntime.fixture.applySnapshot({ S, user: null })
}

beforeEach(async () => {
  localStorage.clear()
  useUI.setState({ sheets: [] })
  ;await install([
    { id: 'strength', name: 'Strength', emoji: '🏋️', prog: 'off', ex: [{ id: ids[0], sets: 3, reps: 5, weight: 60 }] },
    { id: 'core', name: 'Core', emoji: '🧘', prog: 'off', ex: [{ id: ids[1], sets: 3, reps: 12, weight: 0 }, { id: ids[2], sets: 3, reps: 10, weight: 0 }] },
    { id: 'rehab', name: 'Rehab', emoji: '🩹', excludeFromProgression: true, ex: [{ id: ids[1], sets: 2, reps: 15, weight: 5 }] },
  ]);
})

describe('beginWorkout with a routine-id list', () => {
  it('concatenates the routines’ entries in order, stamps rid, derives the name', async () => {
    requestWearWorkoutOpen.mockClear()
    await act(async () => { await beginWorkout(['strength', 'core'], null); await uiRuntime.fixture.flush(); })
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.entries.map(e => e.rid)).toEqual(['strength', 'core', 'core'])
    expect(a).not.toHaveProperty('routineId')
    expect(a).not.toHaveProperty('excludeFromProgression')
    expect(requestWearWorkoutOpen).toHaveBeenCalledOnce()
  })

  it('a single-element list is an ordinary single-routine session', async () => {
    await act(async () => { await beginWorkout(['strength'], null); await uiRuntime.fixture.flush(); })
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength'])
    expect(a.name).toBe('Strength')
    expect(a.entries.every(e => e.rid === 'strength')).toBe(true)
  })

  it('an empty list is a freestyle session — no entries, no rid', async () => {
    await act(async () => { await beginWorkout([], null); await uiRuntime.fixture.flush(); })
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual([])
    expect(a.name).toBe('Freestyle')
    expect(a.entries).toEqual([])
  })

  it('carries a merged excluded routine’s per-entry noProg', async () => {
    await act(async () => { await beginWorkout(['strength', 'rehab'], null); await uiRuntime.fixture.flush(); })
    const a = useStore.getState().S.active
    expect(a.entries.find(e => e.rid === 'rehab').noProg).toBe(true)
    expect(a.entries.find(e => e.rid === 'strength').noProg).toBeUndefined()
  })

  it('drops an unknown id and de-dupes a repeat (first wins)', async () => {
    await act(async () => { await beginWorkout(['core', 'gone', 'core'], null); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.active.routineIds).toEqual(['core'])
  })
})
