// @vitest-environment happy-dom

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
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_DRAG_SLOP, ROUTINE_LONG_PRESS_MS, reorderRoutineUnit } from './RoutineEdit.jsx'
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
async function remountCurrentState() {
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
async function lift(row, y, x = 120) {
  await pointer(row.querySelector('.item'), 'pointerdown', { x, y })
  await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
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

describe('routine long-press reorder', () => {
  it('exports the frozen threshold/slop and keeps a short press as a normal click', async () => {
    expect(ROUTINE_LONG_PRESS_MS).toBe(380)
    expect(ROUTINE_DRAG_SLOP).toBe(8)
    const layout = (await mount([configured('1001'), configured('1002')]))
    const item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { y: layout.centers[0] })
    await act(async () => { await vi.advanceTimersByTime(379); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeNull()
    await pointer(item, 'pointerup', { y: layout.centers[0] })
    await act(async () => { await item.click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).toHaveBeenCalledOnce()
    expect(exercises().map(e => e.id)).toEqual(['1001', '1002'])
  })

  it('lifts at exactly 380 ms and yields pre-lift movement strictly over 8 px to scrolling', async () => {
    let layout = (await mount([configured('1001'), configured('1002')]))
    let item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atEight = (await pointer(item, 'pointermove', { x: 108, y: layout.centers[0] }))
    expect(atEight.defaultPrevented).toBe(false)
    await act(async () => { await vi.advanceTimersByTime(380); await uiRuntime.fixture.flush(); })
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    await pointer(item, 'pointercancel', { x: 108, y: layout.centers[0] })

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = (await mount([configured('1001'), configured('1002')]))
    item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atNine = (await pointer(item, 'pointermove', { x: 109, y: layout.centers[0] }))
    await act(async () => { await vi.advanceTimersByTime(380); await uiRuntime.fixture.flush(); })
    expect(atNine.defaultPrevented).toBe(false)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('owns active movement, renders an indicator, and suppresses the compatibility click after cancel', async () => {
    const layout = (await mount([configured('1001'), configured('1002'), configured('1003')]))
    const row = rows()[1], item = row.querySelector('.item')
    const capture = vi.fn(), release = vi.fn()
    item.setPointerCapture = capture; item.releasePointerCapture = release
    await lift(row, layout.centers[1])
    expect(capture).toHaveBeenCalledWith(7)
    expect(row.classList.contains('is-dragging')).toBe(true)
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeTruthy()
    const move = (await pointer(item, 'pointermove', { y: layout.centers[2] }))
    expect(move.defaultPrevented).toBe(true)
    await pointer(item, 'pointercancel', { y: layout.centers[2] })
    expect(release).toHaveBeenCalledWith(7)
    await act(async () => { await item.click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
    expect(exercises().map(e => e.id)).toEqual(['1001', '1002', '1003'])
  })

  it('moves across measured slots and persists one complete changed order', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c'), configured('d')]))
    const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
    const row = rows()[0], item = row.querySelector('.item')
    await lift(row, layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a', 'd'])
    await uiRuntime.fixture.flush()
    expect(((await uiRuntime.fixture.saved())).state.routines[0].ex.map(e => e.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(((await uiRuntime.fixture.saved())).localRevision).toBeGreaterThan(before.localRevision)
    // one save of the copy (beside it the write id other tabs read, useStore persist)
    expect(uiRuntime.fixture.commits().length - priorCommits).toBe(1)
  })

  it('suppresses the compatibility click after a successful changed drop', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const item = rows()[0].querySelector('.item')
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])

    await act(async () => { await item.click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('lets a real tap shortly after a drop open the row again', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const item = rows()[0].querySelector('.item')
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])

    await act(async () => { await vi.advanceTimersByTime(200); await uiRuntime.fixture.flush(); })
    const target = rows()[1].querySelector('.item')
    await pointer(target, 'pointerdown', { y: layout.centers[1] })
    await pointer(target, 'pointerup', { y: layout.centers[1] })
    await act(async () => { await target.click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('never eats a tap that starts with its own pointerdown, even right after a drop', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const item = rows()[0].querySelector('.item')
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[2] + 1 })

    const target = rows()[1].querySelector('.item')
    await pointer(target, 'pointerdown', { y: layout.centers[1] })
    await pointer(target, 'pointerup', { y: layout.centers[1] })
    await act(async () => { await target.click(); await uiRuntime.fixture.flush(); })
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('moves a whole grouped unit, never splits another group, and preserves every occurrence payload', async () => {
    const pairA = configured('dup', { sg: 'pair', weight: 11, note: 'first', future: { a: 1 } })
    const pairB = configured('dup', { sg: 'pair', weight: 22, note: 'second', future: { b: 2 } })
    const layout = (await mount([pairA, pairB, configured('c'), configured('d')]))
    const row = rows()[1], item = row.querySelector('.item')
    await lift(row, layout.centers[1])
    expect(rows().slice(0, 2).every(node => node.classList.contains('is-dragging'))).toBe(true)
    await pointer(item, 'pointermove', { y: layout.listRect.bottom - 1 })
    await pointer(item, 'pointerup', { y: layout.listRect.bottom - 1 })
    expect(exercises()).toEqual([configured('c'), configured('d'), pairA, pairB])

    act(() => root.unmount()); host.remove(); root = null; host = null
    const splitLayout = (await mount([configured('a'), configured('b', { sg: 'g' }), configured('c', { sg: 'g' }), configured('tail')]))
    const tail = rows()[3], tailItem = tail.querySelector('.item')
    await lift(tail, splitLayout.centers[3])
    const betweenMembers = (splitLayout.bottoms[1] + splitLayout.tops[2]) / 2
    await pointer(tailItem, 'pointermove', { y: betweenMembers })
    await pointer(tailItem, 'pointerup', { y: betweenMembers })
    expect(exercises().map(e => e.id)).toEqual(['a', 'tail', 'b', 'c'])
  })

  it('moves the selected duplicate occurrence rather than finding by catalogue id', async () => {
    const first = configured('dup', { weight: 10, reps: 3, note: 'first' })
    const second = configured('dup', { weight: 20, reps: 9, note: 'second' })
    const layout = (await mount([first, configured('middle'), second, configured('tail')]))
    const row = rows()[2], item = row.querySelector('.item')
    await lift(row, layout.centers[2])
    await pointer(item, 'pointermove', { y: layout.tops[0] + 1 })
    await pointer(item, 'pointerup', { y: layout.tops[0] + 1 })
    expect(exercises()).toEqual([second, first, configured('middle'), configured('tail')])
  })

  it('cancels without persistence on outside release, lost capture, Escape, blur, hidden document, or second pointer', async () => {
    const cancelCases = ['outside', 'lost', 'escape', 'blur', 'hidden', 'second']
    for (const cancel of cancelCases) {
      if (root) { act(() => root.unmount()); host.remove(); root = null; host = null }
      const layout = (await mount([configured('a'), configured('b'), configured('c')]))
      const row = rows()[0], item = row.querySelector('.item')
      const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
      await lift(row, layout.centers[0])
      await pointer(item, 'pointermove', { y: layout.centers[2] })
      if (cancel === 'outside') await pointer(item, 'pointerup', { x: layout.listRect.right + 20, y: layout.centers[2] });
      if (cancel === 'lost') await pointer(item, 'lostpointercapture', { y: layout.centers[2] });
      if (cancel === 'escape') await act(async () => { await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await uiRuntime.fixture.flush(); })
      if (cancel === 'blur') await act(async () => { await window.dispatchEvent(new Event('blur')); await uiRuntime.fixture.flush(); })
      if (cancel === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        await act(async () => { await document.dispatchEvent(new Event('visibilitychange')); await uiRuntime.fixture.flush(); })
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      }
      if (cancel === 'second') await pointer(rows()[1].querySelector('.item'), 'pointerdown', { id: 8, y: layout.centers[1] });
      expect(exercises().map(e => e.id), cancel).toEqual(['a', 'b', 'c'])
      expect(await uiRuntime.fixture.saved(), cancel).toEqual(before)
      expect(host.querySelector('.is-dragging'), cancel).toBeNull()
    }
  })

  it('ignores non-primary/control pointers and leaves accessible move buttons working', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    const down = host.querySelector('button[aria-label="Move down"]')
    await pointer(down, 'pointerdown', { y: layout.centers[0] })
    await act(async () => { await vi.advanceTimersByTime(380); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeNull()
    await act(async () => { await down.click(); await uiRuntime.fixture.flush(); })
    expect(exercises().map(e => e.id)).toEqual(['b', 'a'])
    const item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { primary: false, y: layout.centers[0] })
    await act(async () => { await vi.advanceTimersByTime(380); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('autoscrolls only after lift and stops frames on cancel', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c'), configured('d')]))
    host.style.overflowY = 'auto'
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 320 })
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 900 })
    host.scrollTop = 100
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect(0, 320))
    const row = rows()[2], item = row.querySelector('.item')
    await pointer(item, 'pointerdown', { y: 310 })
    await act(async () => { await vi.advanceTimersByTime(16); await uiRuntime.fixture.flush(); })
    expect(host.scrollTop).toBe(100)
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS - 16 + 16); await uiRuntime.fixture.flush(); })
    expect(host.scrollTop).toBeGreaterThan(100)
    await pointer(item, 'pointercancel', { y: 310 })
    const stopped = host.scrollTop
    await act(async () => { await vi.advanceTimersByTime(64); await uiRuntime.fixture.flush(); })
    expect(host.scrollTop).toBe(stopped)
  })

  it('fails closed when row geometry disappears during an active drag', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const row = rows()[0], item = row.querySelector('.item')
    const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
    await lift(row, layout.centers[0])
    rows()[1].getBoundingClientRect.mockReturnValue(undefined)
    await pointer(item, 'pointermove', { y: layout.centers[2] })
    await pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(await uiRuntime.fixture.saved()).toEqual(before)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cleans pending and active gestures on unmount without late writes', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    const item = rows()[0].querySelector('.item')
    const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
    await pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => root.unmount()); root = null
    await act(async () => { await vi.advanceTimersByTime(1000); await uiRuntime.fixture.flush(); })
    expect(await uiRuntime.fixture.saved()).toEqual(before)

    const activeLayout = (await mount([configured('a'), configured('b')]))
    const activeItem = rows()[0].querySelector('.item')
    const activeBefore = await uiRuntime.fixture.saved()
    const release = vi.fn()
    activeItem.releasePointerCapture = release
    await lift(rows()[0], activeLayout.centers[0])
    act(() => root.unmount()); root = null
    await act(async () => { await vi.advanceTimersByTime(1000); await uiRuntime.fixture.flush(); })
    expect(release).toHaveBeenCalledWith(7)
    expect(await uiRuntime.fixture.saved()).toEqual(activeBefore)
  })

  it('covers reverse measured slots and an unchanged original slot', async () => {
    let layout = (await mount([configured('a'), configured('b'), configured('c'), configured('d')]))
    let item = rows()[3].querySelector('.item')
    await lift(rows()[3], layout.centers[3])
    await pointer(item, 'pointermove', { y: layout.tops[1] + 1 })
    await pointer(item, 'pointerup', { y: layout.tops[1] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['a', 'd', 'b', 'c'])

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
    item = rows()[1].querySelector('.item')
    await lift(rows()[1], layout.centers[1])
    await pointer(item, 'pointermove', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(await uiRuntime.fixture.saved()).toEqual(before)
  })

  it('reads the persisted changed order back after a fresh remount', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const item = rows()[0].querySelector('.item')
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    await pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    const saved = (await uiRuntime.fixture.saved()).state
    act(() => root.unmount()); host.remove(); root = null; host = null
    await uiRuntime.fixture.prepare(saved)
    await remountCurrentState()
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('cancels active ownership for a second pointer outside the list and pending lost capture', async () => {
    let layout = (await mount([configured('a'), configured('b'), configured('c')]))
    let item = rows()[0].querySelector('.item')
    const before = (await uiRuntime.fixture.saved())
    const priorCommits = uiRuntime.fixture.commits().length
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] })
    await pointer(document.body, 'pointerdown', { id: 8, y: 20 })
    await pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(await uiRuntime.fixture.saved()).toEqual(before)
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = (await mount([configured('a'), configured('b')]))
    item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { y: layout.centers[0] })
    await pointer(item, 'lostpointercapture', { y: layout.centers[0] })
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cancels when equal serialized exercises acquire a new current routine/list identity', async () => {
    let layout = (await mount([configured('a'), configured('b'), configured('c')]))
    let item = rows()[0].querySelector('.item')
    await lift(rows()[0], layout.centers[0])
    await pointer(item, 'pointermove', { y: layout.centers[2] })
    await act(async () => { await useStore.getState().update(s => {
      const current = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }); await uiRuntime.fixture.flush(); })
    await pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = (await mount([configured('a'), configured('b')]))
    item = rows()[0].querySelector('.item')
    await pointer(item, 'pointerdown', { y: layout.centers[0] })
    await act(async () => { await useStore.getState().update(s => {
      const current = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }); await uiRuntime.fixture.flush(); })
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('never owns nested link, Move up, or Move down controls', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    const controls = [
      rows()[1].querySelector('button[title]'),
      rows()[1].querySelector('button[aria-label="Move up"]'),
      rows()[1].querySelector('button[aria-label="Move down"]'),
    ]
    for (const control of controls) {
      await pointer(control, 'pointerdown', { y: layout.centers[1] })
      await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
      expect(host.querySelector('.is-dragging')).toBeNull()
      await pointer(control, 'pointerup', { y: layout.centers[1] })
    }
  })

  it('falls back to page/window autoscroll without a nested scroll host', async () => {
    const layout = (await mount([configured('a'), configured('b'), configured('c')]))
    const rootElement = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: rootElement })
    Object.defineProperty(rootElement, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(rootElement, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 100 })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((_, delta) => { window.scrollY += delta })
    const item = rows()[2].querySelector('.item')
    await lift(rows()[2], 295)
    await act(async () => { await vi.advanceTimersByTime(16); await uiRuntime.fixture.flush(); })
    expect(scrollBy).toHaveBeenCalled()
    expect(window.scrollY).toBeGreaterThan(100)
    await pointer(item, 'pointercancel', { y: 295 })
  })

  it('invalidates ownership before cleanup synchronously emits lost capture', async () => {
    const layout = (await mount([configured('a'), configured('b')]))
    const item = rows()[0].querySelector('.item')
    const release = vi.fn(async pointerId => (await pointer(document, 'lostpointercapture', { id: pointerId, y: layout.centers[0] })))
    item.releasePointerCapture = release
    await lift(rows()[0], layout.centers[0])
    act(() => root.unmount()); root = null
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('reorderRoutineUnit', () => {
  it('splices complete units at canonical slots and cleans true orphans', () => {
    const items = [configured('a', { sg: 'pair' }), configured('b', { sg: 'pair' }), configured('c', { sg: 'orphan' }), configured('d')]
    expect(reorderRoutineUnit(items, 3, 1)).toBe(true)
    expect(items.map(e => e.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(items[0].sg).toBe('pair'); expect(items[1].sg).toBe('pair'); expect(items[3].sg).toBeUndefined()
  })
})
