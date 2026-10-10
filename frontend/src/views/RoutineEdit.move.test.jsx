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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { act } from 'react'
import { LANGS, DERIVED_LOCALES } from '../lib/i18n-core.js'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { _setLangState } from '../lib/i18n-core.js'
import de from '../locales/de.js'
import { buildPlanBundle, parsePlan } from '../lib/plan-share.js'

const cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

const mocks = vi.hoisted(() => ({ exConfigSheet: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: mocks.exConfigSheet, confirmSheet: vi.fn()
}))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const custom = id => ({ id, n: id, bp: 'chest', eq: 'body weight', tg: 'chest', custom: true })
const entry = (id, setup, sg) => ({
  id, sets: 3, reps: 5, weight: setup, note: `setup-${setup}`,
  ...(sg ? { sg } : {})
})

let root
let container

async function setRoutine(ex) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Move test', emoji: 'dumbbell', ex }]
  S.customEx = ['c1', 'c2', 'c3', 'c4'].map(custom)
  await uiRuntime.fixture.applySnapshot({ S, user: null })
}

async function renderRoutine() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { await root.render(
    <MemoryRouter initialEntries={['/routine/r1']}>
      <Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>
  ); await uiRuntime.fixture.flush(); })
}

function itemFor(name) {
  return [...container.querySelectorAll('.item')].find(item => item.textContent.includes(name))
}

function moveButton(name, direction) {
  return itemFor(name).querySelector(`button[aria-label="${direction}"]`)
}

async function pointerActivateArea(button) {
  // Model browser hit-testing: pointer-events:none removes the disabled button
  // from the target chain, exposing the clickable routine row underneath.
  const disabledRule = cssSource.match(/\.iconbtn:disabled\s*\{[^}]*\}/)?.[0] || ''
  const target = /pointer-events\s*:\s*none/.test(disabledRule)
    ? button.closest('.item')
    : button
  await act(async () => { target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    if (!(target instanceof HTMLButtonElement && target.disabled)) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }; await uiRuntime.fixture.flush(); })
}

beforeEach(() => {
  localStorage.clear()
  mocks.exConfigSheet.mockClear()
  _setLangState('en', null, null, null)
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  _setLangState('en', null, null, null)
})

describe('routine move controls', () => {
  // #377: the arrows on a superset row move that one exercise, not the whole superset.
  it('moves a superset member inside its superset and persists complete occurrences', async () => {
    ;await setRoutine([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30, 'g'),
      entry('c4', 40)
    ]);
    await renderRoutine()

    await act(async () => { await moveButton('setup-10', 'Move down').click(); await uiRuntime.fixture.flush(); })

    const moved = useStore.getState().S.routines[0].ex
    expect(moved).toEqual([
      entry('c2', 20, 'g'),
      entry('c1', 10, 'g'),
      entry('c3', 30, 'g'),
      entry('c4', 40)
    ])
    await uiRuntime.fixture.flush()
    expect(((await uiRuntime.fixture.saved())).state.routines[0].ex).toEqual(moved)
  })

  it('takes the last member out of its superset, where it stands, and the next press moves it on', async () => {
    ;await setRoutine([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30, 'g'),
      entry('c4', 40)
    ]);
    await renderRoutine()
    expect(moveButton('setup-30', 'Move down').title).toBe('Move out of the superset')
    expect(moveButton('setup-20', 'Move down').title).toBe('Move down')

    await act(async () => { await moveButton('setup-30', 'Move down').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30),
      entry('c4', 40)
    ])

    await act(async () => { await moveButton('setup-30', 'Move down').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c4', 40),
      entry('c3', 30)
    ])
  })

  it('a superset member on the first row can still leave upward; a superset of two dissolves', async () => {
    ;await setRoutine([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30)
    ]);
    await renderRoutine()
    const up = moveButton('setup-10', 'Move up')
    expect(up.disabled).toBe(false)
    expect(up.title).toBe('Move out of the superset')

    await act(async () => { await up.click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c1', 10),
      entry('c2', 20),
      entry('c3', 30)
    ])
    expect(moveButton('setup-10', 'Move up').disabled).toBe(true)
  })

  it('a single exercise jumps a whole superset and does not join it', async () => {
    ;await setRoutine([
      entry('c3', 30),
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g')
    ]);
    await renderRoutine()

    await act(async () => { await moveButton('setup-30', 'Move down').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30)
    ])
  })

  it('moves the selected duplicate occurrence without aliasing its configuration', async () => {
    ;await setRoutine([
      entry('c1', 10),
      entry('c2', 20),
      entry('c1', 30)
    ]);
    await renderRoutine()

    await act(async () => { await moveButton('setup-30', 'Move up').click(); await uiRuntime.fixture.flush(); })

    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c1', 10),
      entry('c1', 30),
      entry('c2', 20)
    ])
  })

  it('moves a standalone occurrence down with every configuration field intact', async () => {
    const selected = {
      ...entry('c1', 10),
      mode: 'reps', prog: 'double', repsMin: 4, repsMax: 12,
      side: true, warmupSets: 2,
      intensifier: { type: 'restpause', pauseSec: 20 }
    }
    await setRoutine([selected, entry('c2', 20), entry('c3', 30)])
    await renderRoutine()

    await act(async () => { await moveButton('setup-10', 'Move down').click(); await uiRuntime.fixture.flush(); })

    expect(useStore.getState().S.routines[0].ex).toEqual([
      entry('c2', 20), selected, entry('c3', 30)
    ])
  })

  it('disables unit-boundary directions without cleaning or persisting state', async () => {
    ;await setRoutine([
      entry('c1', 10, 'orphan'),
      entry('c2', 20)
    ]);
    await renderRoutine()
    const before = useStore.getState().S

    expect(moveButton('c1', 'Move up').disabled).toBe(true)
    expect(moveButton('c2', 'Move down').disabled).toBe(true)
    await act(async () => { await moveButton('c1', 'Move up').click(); await uiRuntime.fixture.flush(); })

    expect(useStore.getState().S).toBe(before)
    expect(useStore.getState().S.routines[0].ex[0].sg).toBe('orphan')
    expect(localStorage.getItem('gym_state_v1')).toBeNull()
  })

  it('keeps pointer activation in both disabled boundary areas isolated from the routine row', async () => {
    ;await setRoutine([
      entry('c1', 10, 'orphan'),
      entry('c2', 20)
    ]);
    await renderRoutine()
    const before = useStore.getState().S
    const firstUp = moveButton('c1', 'Move up')
    const lastDown = moveButton('c2', 'Move down')

    expect(firstUp.disabled).toBe(true)
    expect(lastDown.disabled).toBe(true)
    await pointerActivateArea(firstUp)
    await pointerActivateArea(lastDown)

    expect(mocks.exConfigSheet).not.toHaveBeenCalled()
    expect(useStore.getState().S).toBe(before)
    expect(useStore.getState().S.routines[0].ex[0].sg).toBe('orphan')
    expect(localStorage.getItem('gym_state_v1')).toBeNull()
  })

  it('uses localized accessible names and titles, retains button focus, and does not open config', async () => {
    _setLangState('de', de, null, null)
    await setRoutine([entry('c1', 10), entry('c2', 20)])
    await renderRoutine()
    const button = moveButton('c2', 'Nach oben')

    expect(button.title).toBe('Nach oben')
    button.focus()
    await act(async () => { await button.click(); await uiRuntime.fixture.flush(); })

    expect(document.activeElement?.tagName).toBe('BUTTON')
    expect(mocks.exConfigSheet).not.toHaveBeenCalled()
  })

  it('retains reordered occurrence order and grouping through plan export and import', async () => {
    ;await setRoutine([
      entry('c1', 10, 'g'),
      entry('c2', 20, 'g'),
      entry('c3', 30)
    ]);
    await renderRoutine()
    await act(async () => { await moveButton('setup-10', 'Move down').click(); await uiRuntime.fixture.flush(); })

    const parsed = parsePlan(JSON.stringify(buildPlanBundle(useStore.getState().S, 'Move test')))
    expect(parsed.routines[0].ex).toEqual([
      entry('c2', 20, 'g'),
      entry('c1', 10, 'g'),
      entry('c3', 30)
    ])
  })
})

describe('routine move-control locale coverage', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })

  it('defines both accessible names in every non-English locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(Object.keys(LANGS).filter(c => c !== 'en' && !DERIVED_LOCALES[c]).length)
    Object.entries(packs).forEach(([path, pack]) => {
      expect(pack, `${path} is missing Move up`).toHaveProperty('Move up')
      expect(pack, `${path} is missing Move down`).toHaveProperty('Move down')
    })
  })
})
