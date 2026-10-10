// @vitest-environment happy-dom
// A past workout's detail sheet. Discord (rubik_97): drop-set weights were counted in the volume
// but never listed, and supersets were not shown at all. Discord 'Improvement ideas': an exercise
// opens its own history from here, and the workout can be copied as text.

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
import { workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const lifts = EXDB.filter(e => e.bp !== 'cardio' && e.eq === 'barbell').slice(0, 3).map(e => e.id)
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []

async function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

const workout = (entries, extra = {}) => ({
  id: 'w1', d: '2026-09-15', start: Date.UTC(2026, 8, 15, 17), end: Date.UTC(2026, 8, 15, 18), name: 'Push',
  vol: 0, prs: [], routineIds: [], entries, ...extra,
})
const done = (w, r, more = {}) => ({ w, r, done: true, ...more })

let toast
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  toast = vi.fn()
  useUI.setState({ sheets: [], toast })
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [], active: null })
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('workout detail', () => {
  it('shows retained per-set and completed-side heart-rate measurements in history', async () => {
    const heartRate = {
      v: 1, status: 'partial', effortEndMs: 10000, recoveryEndMs: 42000,
      points: [[0, 120], [10000, 150], [42000, 130]],
      effort: { count: 2, mean: 135, peak: 150 }, recovery: { count: 1, mean: 130, peak: 130 },
      milestones: [{ seconds: 30, atMs: 42000, bpm: 130, delta: 20 }],
    }
    workoutDetailSheet(workout([
      { id: lifts[0], target: { mode: 'reps' }, sets: [done(100, 8, { heartRate })] },
      { id: lifts[1], target: { mode: 'reps', perSide: true }, sets: [{ done: false, sides: {
        L: done(20, 8, { heartRate }), R: { w: 20, r: 8, done: false },
      } }] },
    ]))
    const host = await mountTopSheet()
    expect(host.querySelectorAll('[aria-label="Set heart rate"]')).toHaveLength(2)
    expect(host.textContent).toContain('Mean 135 bpm · Peak 150 bpm')
    expect(host.textContent).toContain('32 s: 130 bpm (−20 bpm)')
    expect(host.textContent).toContain('Left')
  })

  it('lists a drop-set\'s drops and a rest-pause set\'s bursts', async () => {
    workoutDetailSheet(workout([
      { id: lifts[0], target: { mode: 'reps' }, sets: [done(100, 8, { type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(60, 16, { type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })] },
    ]))
    const rows = [...((await mountTopSheet()).querySelectorAll('.wd-ex .ss'))].map(el => el.textContent)
    expect(rows).toEqual(['100×8 ↘ 80×6 ↘ 60×5', '60×10+4+2'])
  })

  it('keeps a superset together under one label, in a flat and in a combined workout', async () => {
    const entries = [
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], sg: 'sg1', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], target: { mode: 'reps' }, sets: [done(60, 5)] },
    ]
    workoutDetailSheet(workout(entries))
    let host = (await mountTopSheet())
    let groups = host.querySelectorAll('.wd-ss')
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector('.ss-label').textContent).toBe('Superset')
    expect(groups[0].querySelectorAll('.wd-ex')).toHaveLength(2)
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)

    useUI.setState({ sheets: [] })
    const combined = entries.map((e, i) => ({ ...e, rid: i < 2 ? 'A' : 'B' }))
    workoutDetailSheet(workout(combined, { routineIds: ['A', 'B'] }))
    host = (await mountTopSheet())
    expect(host.textContent).toContain('Freestyle')           // routines since deleted
    expect(host.querySelectorAll('.wd-ss .wd-ex')).toHaveLength(2)
  })

  it('shows an unpaired exercise without a superset label', async () => {
    workoutDetailSheet(workout([
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(20, 12)] },
    ]))
    expect(((await mountTopSheet()).querySelector('.wd-ss'))).toBeNull()
  })

  it('opens the exercise\'s history from its row', async () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const row = ((await mountTopSheet()).querySelector('.wd-ex'))
    expect(row.getAttribute('role')).toBe('button')
    await act(async () => { row.click(); await uiRuntime.fixture.flush(); })
    expect(useUI.getState().sheets).toHaveLength(2)
    const history = (await mountTopSheet())
    expect(history.textContent).toContain('Exercise history')
    expect(history.textContent).toContain('60×5')
  })

  it('copies the workout as text, with the note as it stands in the box', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5, { phase: 'warmup' }), done(80, 5)] }])
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = (await mountTopSheet())
    const note = host.querySelector('textarea')
    await act(async () => { Object.getOwnPropertyDescriptor(note.constructor.prototype, 'value').set.call(note, 'Good day')
      note.dispatchEvent(new Event('input', { bubbles: true })); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Copy as text').click(); await uiRuntime.fixture.flush(); })
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0]
    expect(text.split('\n')[0]).toMatch(/^Push · /)
    expect(text).toContain('\n80×5\n')
    expect(text).not.toContain('60×5')
    expect(text.endsWith('\n\nGood day')).toBe(true)
    expect(toast).toHaveBeenCalledWith('Copied')
  })

  // One rule for both: a superset paired across two routines of a combined session is shown apart
  // in the sheet, each under its own routine, and the copied text does not call it a superset.
  it('groups a combined session\'s supersets the same way in the sheet and in the copied text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w = workout([
      { id: lifts[0], rid: 'A', sg: 'x', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], rid: 'B', sg: 'x', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], rid: 'B', target: { mode: 'reps' }, sets: [done(60, 5)] },
    ], { routineIds: ['A', 'B'] })
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = (await mountTopSheet())
    expect(host.querySelector('.wd-ss')).toBeNull()
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)
    await act(async () => { button(host, 'Copy as text').click(); await uiRuntime.fixture.flush(); })
    expect(writeText.mock.calls[0][0]).not.toContain('Superset')
  })

  it('says so when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    document.execCommand = () => false
    workoutDetailSheet(workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }]))
    const host = (await mountTopSheet())
    await act(async () => { button(host, 'Copy as text').click(); await uiRuntime.fixture.flush(); })
    expect(toast).toHaveBeenCalledWith('Could not copy')
    delete document.execCommand
  })
})
