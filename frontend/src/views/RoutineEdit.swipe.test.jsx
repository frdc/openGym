// @vitest-environment happy-dom
// Swipe actions in the routine editor (v1.3.11): toward the start takes an exercise out, with an
// Undo, and there is nothing on the other side. The long press still reorders, and a row it has
// picked up does not swipe. The exercise's sheet keeps Remove, with the same Undo.

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
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_LONG_PRESS_MS, removeRoutineExercise } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { closeOpenRow } from '../lib/use-swipe-row.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, extra = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root, host, widthSpy

async function mount(entries, wc) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Swipe routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  if (wc) S.wc = { ...S.wc, ...wc }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { await root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>); await uiRuntime.fixture.flush(); })
}
const ex = () => useStore.getState().S.routines[0].ex
const swrows = () => [...host.querySelectorAll('.swrow')]
async function pointer(target, type, x, y = 300) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  await act(async () => { target.dispatchEvent(event); await uiRuntime.fixture.flush(); })
}
const click = async target => await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await uiRuntime.fixture.flush(); })
async function swipe(target, x0, x1) {
  await pointer(target, 'pointerdown', x0)
  await pointer(target, 'pointermove', (x0 + x1) / 2)
  await pointer(target, 'pointermove', x1)
  await pointer(target, 'pointerup', x1)
  await click(target)
  await act(async () => { await vi.advanceTimersByTime(800); await uiRuntime.fixture.flush(); })
}
const undo = async () => await act(async () => { await useUI.getState().runToastAction(); await uiRuntime.fixture.flush(); })

beforeEach(() => {
  vi.useFakeTimers()
  Object.values(sheets).forEach(mock => mock.mockReset())
  document.documentElement.dir = 'ltr'
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
})
afterEach(() => {
  closeOpenRow(true)
  act(() => root.unmount()); host.remove()
  widthSpy.mockRestore()
  vi.clearAllTimers(); vi.useRealTimers()
})

describe('swiping an exercise out of a routine', () => {
  it('is remove-only: one pane, out of reach while shut, and a swipe toward the end does nothing', async () => {
    await mount([configured('1001'), configured('1002')])
    expect(swrows()).toHaveLength(2)
    expect(host.querySelector('.swpane.cp')).toBeNull()
    const pane = swrows()[0].querySelector('.swpane.del')
    expect(pane.textContent).toBe('Remove')
    expect(pane.getAttribute('aria-hidden')).toBe('true')
    expect(pane.querySelector('button').tabIndex).toBe(-1)
    await swipe(swrows()[0].querySelector('.item'), 60, 330)
    expect(ex().map(e => e.id)).toEqual(['1001', '1002'])
    expect(swrows()[0].querySelector('.swfront').style.transform).toBe('')
  })

  it('a long swipe toward the start removes, and Undo brings back the superset link too', async () => {
    const entries = [configured('1001', { sg: 'g1' }), configured('1002', { sg: 'g1' }), configured('1003')]
    await mount(clone(entries))
    await swipe(swrows()[1].querySelector('.item'), 330, 60)
    expect(ex().map(e => e.id)).toEqual(['1001', '1003'])
    expect(ex()[0].sg).toBeUndefined()          // a lone partner loses its link
    expect(useUI.getState().toastMsg).toMatch(/” left the routine\.$/)
    await undo()
    expect(ex()).toEqual(entries)
  })

  it('Undo after another edit puts the exercise back at its old place', async () => {
    await mount([configured('1001'), configured('1002'), configured('1003')])
    await act(async () => { removeRoutineExercise('r1', 1); await uiRuntime.fixture.flush(); })
    const pending = useUI.getState().toastAction
    await act(async () => { await useStore.getState().update(s => { s.routines[0].ex.push(configured('1004')) }); await uiRuntime.fixture.flush(); })
    await act(async () => { await pending.run(); await uiRuntime.fixture.flush(); })
    expect(ex().map(e => e.id)).toEqual(['1001', '1002', '1003', '1004'])
  })

  it('the name is the keyboard’s button (no button inside a button), and the sheet’s Remove has the same Undo', async () => {
    await mount([configured('1001', { sg: 'g1' }), configured('1002', { sg: 'g1' })])
    // The row holds the superset link and the Move buttons, so it is no button itself: a screen
    // reader reads a button's insides as plain text (axe nested-interactive).
    for (const el of host.querySelectorAll('.routine-list [role="button"], .routine-list button')) {
      expect(el.parentElement.closest('[role="button"], button')).toBeNull()
    }
    const item = swrows()[1].querySelector('.item')
    expect(item.hasAttribute('role')).toBe(false)
    expect(item.querySelector('button[aria-label="Move up"]')).toBeTruthy()
    const open = item.querySelector('button.item-open')
    expect(open.type).toBe('button')
    ;await click(open);                              // Enter or Space on a <button> is this click
    expect(sheets.exConfigSheet).toHaveBeenCalledOnce()
    ;await click(item.querySelector('[data-thumb]')); // a tap elsewhere on the row opens it too
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(2)
    const onDelete = sheets.exConfigSheet.mock.calls[0][3]
    await act(async () => { await onDelete(); await uiRuntime.fixture.flush(); })
    expect(ex().map(e => e.id)).toEqual(['1001'])
    await undo()
    expect(ex().map(e => e.id)).toEqual(['1001', '1002'])
    ;await click(swrows()[1].querySelector('button[aria-label="Move up"]'));   // its own job, no sheet
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(2)
  })

  it('a long press on the name picks the row up, and a row it has picked up does not swipe', async () => {
    await mount([configured('1001'), configured('1002')])
    const item = swrows()[0].querySelector('.item-open')
    await pointer(item, 'pointerdown', 200)
    await act(async () => { await vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS); await uiRuntime.fixture.flush(); })
    expect(host.querySelector('.is-dragging')).toBeTruthy()
    await pointer(item, 'pointermove', 60)
    expect(swrows()[0].classList.contains('go-del')).toBe(false)
    await pointer(item, 'pointerup', 60)
    await act(async () => { await vi.advanceTimersByTime(800); await uiRuntime.fixture.flush(); })
    expect(ex().map(e => e.id)).toEqual(['1001', '1002'])
  })

  it('is the plain row with the setting off', async () => {
    await mount([configured('1001')], { swipeSets: false })
    expect(swrows()).toHaveLength(0)
    expect(host.querySelectorAll('[data-routine-row] .item')).toHaveLength(1)
  })
})
