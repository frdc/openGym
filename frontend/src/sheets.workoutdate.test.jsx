// @vitest-environment happy-dom
// Editing when a saved workout happened (#218). The sets are the record and are never touched;
// what moves is where the session sits in history — which is also what the PR badges and the
// legacy sync key depend on, so both are checked from the sheet, not just from the helper.

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
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDateSheet, workoutDetailSheet, workoutDurationSheet } from './sheets.jsx'
import { prepareLegacyState } from './lib/cloud/legacy-migration.js'
import { backfillStart } from './lib/backfill.js'
import { startTimeOf } from './lib/workout-date.js'

const mounted = []
async function render(open) {
  open()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  return host
}
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const unmountAll = () => act(() => { mounted.splice(0).forEach(r => r.unmount()) })

const entry = (id, w) => ({ id, sets: [{ w, r: 5, done: true }] })
const workout = (id, d, time, min, entries, prs = []) => {
  const start = backfillStart(d, time)
  return { id, d, start, end: start + min * 60000, name: id, vol: 100, entries, prs }
}
const history = () => useStore.getState().S.workouts
const setHistory = async workouts => {
  const prepared = await prepareLegacyState({ workouts })
  await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, workouts: prepared.workouts } }))
}

describe('changing the date of a saved workout', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toast: vi.fn() })
    document.body.innerHTML = ''
    ;await setHistory([
      workout('early', '2026-08-20', '18:00', 60, [entry('bench', 80)], ['bench']),
      workout('late', '2026-08-25', '07:30', 47, [entry('bench', 90)], ['bench']),
    ]);
  })
  afterEach(unmountAll)

  it('is offered from the workout detail sheet and opens prefilled', async () => {
    const host = (await render(() => workoutDetailSheet(history()[1])))
    const open = button(host, 'Change date & time')
    expect(open).toBeTruthy()
    const edit = (await render(() => open.click()))
    expect(edit.querySelector('h3').textContent).toBe('Change date & time')
    expect(edit.querySelector('input[type=date]').value).toBe('2026-08-25')
    expect(edit.querySelector('input[type=time]').value).toBe('07:30')
  })

  it('moves the session, keeps the length it had and re-files it in date order', async () => {
    const host = (await render(() => workoutDateSheet(history()[1])))
    await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-18'); await uiRuntime.fixture.flush(); })
    await act(async () => { type(host.querySelector('input[type=time]'), '06:15'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })

    expect(history().map(w => w.id)).toEqual(['late', 'early'])
    const moved = history()[0]
    expect(moved.d).toBe('2026-08-18')
    expect(startTimeOf(moved)).toBe('06:15')
    expect(moved.end - moved.start).toBe(47 * 60000)
    expect(moved.entries).toEqual([entry('bench', 90)])
    expect(useUI.getState().toast).toHaveBeenCalledWith('Workout moved')
  })

  it('rebuilds the PR badges the new order implies', async () => {
    // 90 kg was logged second, so 80 kg held the badge too. Moved first, the 80 kg session
    // is no longer a record and the 90 kg one is.
    const host = (await render(() => workoutDateSheet(history()[1])))
    await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-18'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history().map(w => [w.id, w.prs])).toEqual([['late', ['bench']], ['early', []]])
  })

  it('refuses a day in the future and leaves history alone', async () => {
    const before = history()
    const host = (await render(() => workoutDateSheet(before[1])))
    await act(async () => { type(host.querySelector('input[type=date]'), '2099-01-01'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenCalledWith('Pick a day up to today')
    expect(useUI.getState().sheets).toHaveLength(1)   // still open to correct the date
  })

  it('an empty date is refused rather than moving the workout to nowhere', async () => {
    const before = history()
    const host = (await render(() => workoutDateSheet(before[1])))
    await act(async () => { type(host.querySelector('input[type=date]'), ''); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenCalledWith('Pick a day up to today')
  })

  // At 01:42, today at 23:30 passed the date check and filed the session 22 hours ahead.
  it('refuses a time today that has not happened yet, counting the length it keeps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 26, 1, 42))
    try {
      const before = history()
      const host = (await render(() => workoutDateSheet(before[1])))   // 47 minutes long
      await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-26'); await uiRuntime.fixture.flush(); })
      for (const time of ['23:30', '01:00']) {
        await act(async () => { type(host.querySelector('input[type=time]'), time); await uiRuntime.fixture.flush(); })
        await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
        expect(history(), time).toEqual(before)
        expect(useUI.getState().toast).toHaveBeenLastCalledWith('That’s still in the future. Try an earlier start.')
      }
      await act(async () => { type(host.querySelector('input[type=time]'), '00:50'); await uiRuntime.fixture.flush(); })
      await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
      expect(history().find(w => w.id === 'late').d).toBe('2026-08-26')
    } finally { vi.useRealTimers() }
  })

  it('saving without changing anything closes and touches nothing', async () => {
    const before = history()
    const host = (await render(() => workoutDateSheet(before[1])))
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('leaves a second workout on the same day in start-time order', async () => {
    const host = (await render(() => workoutDateSheet(history()[1])))
    await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-20'); await uiRuntime.fixture.flush(); })
    await act(async () => { type(host.querySelector('input[type=time]'), '21:00'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history().map(w => w.id)).toEqual(['early', 'late'])
    expect(history()).toHaveLength(2)
  })

  // The note field only writes on blur, and moving a legacy record re-keys it — so a note
  // typed and left focused has to be flushed before the move, not after it.
  it('keeps a note typed but never blurred', async () => {
    const host = (await render(() => workoutDetailSheet(history()[1])))
    await act(async () => { type(host.querySelector('textarea'), 'felt strong'); await uiRuntime.fixture.flush(); })
    const edit = (await render(() => button(host, 'Change date & time').click()))
    await act(async () => { type(edit.querySelector('input[type=date]'), '2026-08-18'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(edit, 'Save').click(); await uiRuntime.fixture.flush(); })
    unmountAll()
    expect(history().find(w => w.id === 'late').note).toBe('felt strong')
  })

  it('a record written before ids keeps one identity for sync', async () => {
    const legacy = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'Old', vol: 0, entries: [], prs: [] }
    await setHistory([legacy])
    const host = (await render(() => workoutDateSheet(history()[0])))
    await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-18'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()).toHaveLength(1)
    expect(history()[0].id).toBe((await prepareLegacyState({ workouts: [legacy] })).workouts[0].id)
    expect(history()[0].d).toBe('2026-08-18')
  })

  // The sheet keeps the copy it opened with. A sync that brings in the same record with its old
  // key frozen as its id (moved or edited on the other device) must not make its note and date
  // rows quietly write nowhere.
  it('keeps writing to a record from before ids after a sync froze its key as its id', async () => {
    const legacy = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'Old', vol: 0, entries: [], prs: [] }
    await setHistory([legacy])
    const host = (await render(() => workoutDetailSheet(history()[0])))
    await setHistory([{ ...legacy, id: history()[0].id, d: '2026-08-24', _ts: 5 }])
    await act(async () => { type(host.querySelector('textarea'), 'felt strong'); await uiRuntime.fixture.flush(); })
    await act(async () => { host.querySelector('textarea').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await uiRuntime.fixture.flush(); })
    expect(history()).toHaveLength(1)
    expect(history()[0].note).toBe('felt strong')
  })

  it('deletes only the workout it shows, also among records written before ids', async () => {
    const a = { d: '2026-08-20', start: 1767200000000, end: 1767203600000, name: 'A', vol: 0, entries: [], prs: [] }
    const b = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'B', vol: 0, entries: [], prs: [] }
    await setHistory([a, b, history()[1]])
    const host = (await render(() => workoutDetailSheet(history().find(w => w.name === 'B'))))
    const confirm = (await render(() => button(host, 'Delete workout').click()))
    await act(async () => { button(confirm, 'Delete').click(); await uiRuntime.fixture.flush(); })
    expect(history().map(w => w.name)).toEqual(['A', 'late'])
  })

  it('does nothing when the workout was deleted from another sheet meanwhile', async () => {
    const host = (await render(() => workoutDateSheet(history()[1])))
    await setHistory([history()[0]])
    await act(async () => { type(host.querySelector('input[type=date]'), '2026-08-18'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history().map(w => w.id)).toEqual(['early'])
    expect(useUI.getState().toast).not.toHaveBeenCalledWith('Workout moved')
  })
})

// People forget to end a workout (Discord): a 47-minute session saved as five hours. The detail
// sheet corrects the length; the start, the day, the sets and the badges stay.
describe('changing the duration of a saved workout', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toast: vi.fn() })
    document.body.innerHTML = ''
    ;await setHistory([
      workout('early', '2026-08-20', '18:00', 60, [entry('bench', 80)], ['bench']),
      workout('forgot', '2026-08-25', '07:30', 300, [entry('bench', 90)], ['bench']),
    ]);
  })
  afterEach(unmountAll)

  it('is offered from the workout detail sheet and opens at the length it has', async () => {
    const host = (await render(() => workoutDetailSheet(history()[1])))
    const open = button(host, 'Change duration')
    expect(open).toBeTruthy()
    const edit = (await render(() => open.click()))
    expect(edit.querySelector('h3').textContent).toBe('Change duration')
    expect(edit.querySelector('input.num').value).toBe('300')
  })

  it('shortens the session from its start and leaves everything else as it was', async () => {
    const before = history()[1]
    const host = (await render(() => workoutDurationSheet(before)))
    await act(async () => { type(host.querySelector('input.num'), '50'); await uiRuntime.fixture.flush(); })
    await act(async () => { host.querySelector('button[aria-label="Decrease"]').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })

    const after = history()[1]
    expect(after.end - after.start).toBe(45 * 60000)
    expect(after.start).toBe(before.start)
    expect(after.d).toBe(before.d)
    expect(after.entries).toEqual(before.entries)
    expect(after.prs).toEqual(['bench'])
    expect(after._ts).toBeGreaterThan(0)   // stamped: the sync keeps it over an older copy
    expect(history().map(w => w.id)).toEqual(['early', 'forgot'])
    expect(useUI.getState().toast).toHaveBeenCalledWith('Duration changed')
  })

  // The minimum of a minute used to apply on every keystroke: emptying the field put a 1 back
  // at once, and the 75 typed after it read 175 — saved as 2h 55m without a word.
  it('lets the field be emptied to type a new length, and saves what was typed', async () => {
    const host = (await render(() => workoutDurationSheet(history()[1])))
    const field = host.querySelector('input.num')
    await act(async () => { type(field, '3'); await uiRuntime.fixture.flush(); })
    await act(async () => { type(field, ''); await uiRuntime.fixture.flush(); })
    expect(field.value).toBe('')
    await act(async () => { type(field, '75'); await uiRuntime.fixture.flush(); })
    expect(field.value).toBe('75')
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    const after = history()[1]
    expect(after.end - after.start).toBe(75 * 60000)
  })

  // QA 1.3.9: a cleared field was put back to 1 as it lost focus to Save, and the session saved as
  // one minute long without a word. It is refused now, with the reason, and the length is kept.
  it('refuses a field left empty or at 0, says why, and keeps the saved length', async () => {
    const before = history()[1]
    const host = (await render(() => workoutDurationSheet(before)))
    const field = host.querySelector('input.num')
    for (const typed of ['', '0']) {
      await act(async () => { type(field, typed); await uiRuntime.fixture.flush(); })
      await act(async () => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await uiRuntime.fixture.flush(); })
      expect(field.value === '' || field.value === '0', typed).toBe(true)
      expect(host.textContent).toContain('Enter how long it took (at least 1 minute).')
      await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
      expect(history()[1]).toEqual(before)
      expect(useUI.getState().toast).toHaveBeenLastCalledWith('Enter how long it took (at least 1 minute).')
    }
    await act(async () => { type(field, '40'); await uiRuntime.fixture.flush(); })
    expect(host.textContent).not.toContain('at least 1 minute')
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()[1].end - history()[1].start).toBe(40 * 60000)
  })

  // 99999 minutes saved as '1666h 39m', ending weeks from now.
  it('refuses more than a day, says why under the field, and keeps the saved length', async () => {
    const before = history()[1]
    const host = (await render(() => workoutDurationSheet(before)))
    const field = host.querySelector('input.num')
    await act(async () => { type(field, '99999'); await uiRuntime.fixture.flush(); })
    expect(host.textContent).toContain('That’s more than a day. Keep it to 24 hours or less.')
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()[1]).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenLastCalledWith('That’s more than a day. Keep it to 24 hours or less.')
    await act(async () => { type(field, '1440'); await uiRuntime.fixture.flush(); })
    expect(host.textContent).not.toContain('more than a day')
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()[1].end - history()[1].start).toBe(1440 * 60000)
  })

  it('saving the same length closes and touches nothing', async () => {
    const before = history()
    const host = (await render(() => workoutDurationSheet(before[1])))
    await act(async () => { button(host, 'Save').click(); await uiRuntime.fixture.flush(); })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('keeps a note typed in the detail sheet but never blurred', async () => {
    const host = (await render(() => workoutDetailSheet(history()[1])))
    await act(async () => { type(host.querySelector('textarea'), 'forgot to stop'); await uiRuntime.fixture.flush(); })
    const edit = (await render(() => button(host, 'Change duration').click()))
    await act(async () => { type(edit.querySelector('input.num'), '60'); await uiRuntime.fixture.flush(); })
    await act(async () => { button(edit, 'Save').click(); await uiRuntime.fixture.flush(); })
    unmountAll()
    const saved = history().find(w => w.id === 'forgot')
    expect(saved.note).toBe('forgot to stop')
    expect(saved.end - saved.start).toBe(60 * 60000)
  })
})
