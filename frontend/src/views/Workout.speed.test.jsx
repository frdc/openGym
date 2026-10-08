// @vitest-environment happy-dom
// Cardio speed in mph (Discord "miles per hour"): the set row shows, steps and takes typing in
// the profile's speed unit, and what it stores is always km/h.

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
import { afterEach, describe, expect, it, vi , beforeEach } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BIKE = '2138'   // stationary bike, cardio
let root, container

async function mount(settings = {}) {
  if (root) unmount()
  const S = { ...JSON.parse(JSON.stringify(DEF)), ...settings }
  S.active = {
    id: 'speed-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Cardio', bw: null, cur: 0,
    entries: [{ id: BIKE, target: { sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 8, done: false }] }],
  }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(<MemoryRouter><Workout /></MemoryRouter>); await uiRuntime.fixture.flush(); })
}
function unmount() {
  act(() => root.unmount())
  container.remove()
  root = null
}
afterEach(() => { if (root) unmount() })

// The speed column is the second stepper of the set row, after the minutes.
const speedCell = () => container.querySelector('.setrow').querySelectorAll('.stp')[1]
const shown = () => speedCell().querySelector('input').value
const header = () => container.querySelector('.sethead .r-sp').textContent
const stored = () => useStore.getState().S.active.entries[0].sets[0].speed
const tap = async label => await act(async () => { await speedCell().querySelector(`button[aria-label="${label}"]`).click(); await uiRuntime.fixture.flush(); })
async function type(value) {
  const input = speedCell().querySelector('input')
  await act(async () => { Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true })); await uiRuntime.fixture.flush(); })
}

describe('cardio speed in the set row', () => {
  it('reads, steps and takes typing in mph for a profile in pounds, and stores km/h', async () => {
    await mount({ unit: 'lb' })
    expect(header()).toBe('Speed (mph)')
    expect(shown()).toBe('4.97')   // 8 km/h
    // A tap is half a mile an hour, not half a kilometre.
    await tap('Increase')
    expect(stored()).toBe(8.8)
    expect(shown()).toBe('5.47')
    await type('6')
    expect(stored()).toBe(9.66)
    await type('6.5')
    expect(stored()).toBe(10.46)
    expect(shown()).toBe('6.5')
  })

  it('follows a chosen speed unit over the weight unit', async () => {
    await mount({ unit: 'kg', speedUnit: 'mph' })
    expect(header()).toBe('Speed (mph)')
    await mount({ unit: 'lb', speedUnit: 'kmh' })
    expect(header()).toBe('Speed (km/h)')
    expect(shown()).toBe('8')
  })

  it('leaves a km/h profile exactly as it was', async () => {
    await mount()
    expect(header()).toBe('Speed (km/h)')
    expect(shown()).toBe('8')
    await tap('Increase')
    expect(stored()).toBe(8.5)
    await type('10.25')
    expect(stored()).toBe(10.25)
  })
})

// The line under the exercise reads the past in the same unit as the row it sits over, whether
// it holds the last time or the best set (#173).
describe('the reference line in mph', () => {
  const past = { id: 'w0', d: '2026-09-20', start: Date.now() - 3 * 86400000, end: Date.now() - 3 * 86400000 + 1800000, name: 'Cardio',
    entries: [{ id: BIKE, target: { mode: 'cardio', sets: 1, min: 20, speed: 16.09344 }, sets: [{ min: 20, speed: 16.09344, done: true }] }] }
  const refText = () => container.querySelector('.refline')?.textContent || ''

  it('shows last time and the best set in mph for a profile in pounds', async () => {
    await mount({ unit: 'lb', workouts: [past] })
    expect(refText()).toContain('20 min @ 10 mph')
    await mount({ unit: 'lb', workouts: [past], logRef: 'best' })
    expect(refText()).toContain('20 min @ 10 mph')
  })
})
