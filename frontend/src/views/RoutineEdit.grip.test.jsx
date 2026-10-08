// @vitest-environment happy-dom
// The drag handle on pointer devices (#277, #114): a visible grip with a grab cursor, and a mouse
// press on it picks the row up at once. The long press everywhere else is unchanged.

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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_LONG_PRESS_MS } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, extra = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root
let host

function stateFor(entries) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Drag routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  return S
}
function rect(top, height, left = 20, width = 340) {
  return { x: left, y: top, left, right: left + width, top, bottom: top + height, width, height }
}
const rows = () => [...host.querySelectorAll('[data-routine-row]')]
function geometry(heights = rows().map(() => 70)) {
  const list = host.querySelector('.routine-list')
  let top = 100
  const tops = [], bottoms = [], centers = []
  rows().forEach((row, i) => {
    const height = heights[i] ?? 70
    tops.push(top); bottoms.push(top + height); centers.push(top + height / 2)
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(tops[i], height))
    top += height + 10
  })
  const listRect = rect(80, top - 80)
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => listRect)
  return { list, tops, bottoms, centers, listRect }
}
async function mount(entries) {
  await uiRuntime.fixture.applySnapshot({ S: stateFor(entries), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { await root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>); await uiRuntime.fixture.flush(); })
  return geometry()
}
async function pointer(target, type, { id = 7, kind = 'touch', primary = true, button = 0, x = 120, y = 120 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: id, pointerType: kind, isPrimary: primary, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  await act(async () => { await target.dispatchEvent(event); await uiRuntime.fixture.flush(); })
  return event
}
const exercises = () => useStore.getState().S.routines[0].ex

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(Date.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  localStorage.clear()
  Object.values(sheets).forEach(mock => mock.mockReset())
  root = null; host = null
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers()
})

const grip = i => rows()[i].querySelector('[data-drag-handle]')
const cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('routine drag handle', () => {
  it('puts a grip on every row, out of the accessibility tree, named for what it does', async () => {
    await mount([configured('1001'), configured('1002')])
    expect(rows().map(row => !!row.querySelector('.item [data-drag-handle] svg'))).toEqual([true, true])
    expect(grip(0).getAttribute('aria-hidden')).toBe('true')
    expect(grip(0).getAttribute('title')).toBe('Reorder exercises')
  })

  it('shows the grip, with a grab cursor, only where there is a mouse or trackpad', () => {
    const base = cssSource.match(/\.routine-grip\{[^}]*\}/)?.[0] || ''
    expect(base).toMatch(/display:none/)
    expect(base).toMatch(/cursor:grab/)
    const fine = cssSource.match(/@media \(hover:hover\) and \(pointer:fine\)\{\s*\.routine-grip\{display:flex\}/)
    expect(fine).toBeTruthy()
    expect(cssSource).toMatch(/\.routine-list\.is-reordering,\.routine-list\.is-reordering \*\{cursor:grabbing\}/)
  })

  it('keeps the list one column on a computer, where #app lists otherwise go two-up', () => {
    // The reorder reads rows top to bottom; in two columns a drop landed in the wrong place.
    expect(cssSource).toMatch(/@media \(min-width:1000px\)\{[\s\S]*#app \.list\{display:grid/)
    expect(cssSource).toMatch(/#app \.list\.routine-list\{display:flex;flex-direction:column\}/)
  })

  it('picks the row up at once under a mouse and drops it where it is let go', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c'), configured('d')]))
    const down = (await pointer(grip(0), 'pointerdown', { kind: 'mouse', y: layout.centers[0] }))
    // No hold: lifted on the press itself, and the press does not go on to select text.
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    expect(down.defaultPrevented).toBe(true)
    await pointer(grip(0), 'pointermove', { kind: 'mouse', y: layout.centers[2] + 1 })
    await pointer(grip(0), 'pointerup', { kind: 'mouse', y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a', 'd'])
    // The click that follows the drop does not open the exercise's settings.
    await act(async () => { await grip(2).click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('leaves a click on the grip without a move as nothing at all', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    await pointer(grip(1), 'pointerdown', { kind: 'mouse', y: layout.centers[1] })
    await pointer(grip(1), 'pointerup', { kind: 'mouse', y: layout.centers[1] })
    await act(async () => { await grip(1).click(); await uiRuntime.fixture.flush(); })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b'])
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('keeps the long press for a mouse on the rest of the row, and for a finger on the grip', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    const item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { kind: 'mouse', y: layout.centers[0] })
    expect(rows()[0].classList.contains('is-dragging')).toBe(false)
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    await pointer(item, 'pointercancel', { kind: 'mouse', y: layout.centers[0] })

    await act(async () => { await vi.advanceTimersByTime(200); await uiRuntime.fixture.flush(); })
    const touch = (await pointer(grip(1), 'pointerdown', { kind: 'touch', y: layout.centers[1] }))
    expect(touch.defaultPrevented).toBe(false)
    expect(rows()[1].classList.contains('is-dragging')).toBe(false)
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
    expect(rows()[1].classList.contains('is-dragging')).toBe(true)
  })

  it('ignores a right-click on the grip', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    await pointer(grip(0), 'pointerdown', { kind: 'mouse', button: 2, y: layout.centers[0] })
    expect(rows()[0].classList.contains('is-dragging')).toBe(false)
  })
})
