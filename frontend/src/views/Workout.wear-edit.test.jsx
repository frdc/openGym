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
const wear = vi.hoisted(() => ({ edit: null }))
vi.mock('../lib/wear-bridge.js', () => ({ registerWearCompletion: () => () => {}, registerWearEditing: handler => { wear.edit = handler; return () => { wear.edit = null } }, openWearApp: vi.fn() }))
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { makeSideSet } from '../lib/workout-model.js'

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
const edit = (field, value, target = { entryIdx: 0, setIdx: 0, side: null }, unit = 'kg') => wear.edit(target, { v: 1, requestId: 'edit', contextToken: 'verified-by-bridge', revision: 1, action: 'edit-set', target, field, value, unit })

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

it('applies watch fields with phone cascade and leaves running rest and measured start intact', async () => {
  await renderWorkout([entry('0025', [false, false])])
  await act(async () => {
    useStore.getState().update(S => { S.active.entries[0].sets[0].heartRate = { startedAt: Date.now() }; S.active.entries[0].sets[0].at = 123 })
    await uiRuntime.fixture.flush()
  })
  useUI.getState().startRest(90, 0)
  const timer = useUI.getState().timer, measured = active().entries[0].sets[0].heartRate
  await act(async () => { edit('w', 65); edit('r', 7); await uiRuntime.fixture.flush() })
  expect(active().entries[0].sets.map(s => s.w)).toEqual([65, 65])
  expect(active().entries[0].sets[0]).toMatchObject({ r: 7, weightOrigin: 'manual', done: false, at: 123, heartRate: measured })
  expect(useUI.getState().timer).toBe(timer)
})
it('revalidates the current target, unit and modal readiness before changing the store', async () => {
  await renderWorkout([entry('0025', [false, false])])
  expect(() => edit('w', 70, undefined, 'lb')).toThrow('stale-unit')
  expect(() => edit('r', 9, { entryIdx: 0, setIdx: 1, side: null })).toThrow('stale-target')
  useUI.setState({ sheets: [{}] })
  expect(() => edit('r', 9)).toThrow('unsupported-set')
  expect(active().entries[0].sets[0].r).toBe(5)
})
it('edits the current unilateral side and cascades only that side', async () => {
  await renderWorkout([entry('0025', [false, false], { sets: [makeSideSet({ r: 10, w: 20 }), makeSideSet({ r: 10, w: 20 })] })])
  const target = { entryIdx: 0, setIdx: 0, side: 'L' }
  await act(async () => { edit('w', 25, target); edit('r', 7, target); await uiRuntime.fixture.flush() })
  const sets = active().entries[0].sets
  expect(sets[0]).toMatchObject({ r: 12, w: 25, done: false })
  expect(sets[0].sides.L).toMatchObject({ r: 7, w: 25, weightOrigin: 'manual' })
  expect(sets[1].sides.L.w).toBe(25)
  expect(sets.map(s => s.sides.R.w)).toEqual([20, 20])
  expect(() => edit('r', 8, { ...target, side: 'R' })).toThrow('stale-target')
})
