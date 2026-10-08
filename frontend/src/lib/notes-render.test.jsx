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
// The note sheet is new JSX and nothing else mounts it, so a bad hook order, a missing import or
// a wrong store path would only surface on a real device. Render it through the real sheet stack
// and drive a save, so the wiring is checked and not just the shape of the module.
import { describe, expect, it, beforeEach, afterEach , vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exerciseNoteSheet } from '../sheets.jsx'

const activeWith = entry => ({ id: 'w1', d: '2026-08-25', start: 1, routineId: 'r1', name: 'Push', entries: [entry] })

// Roots have to be torn down between tests: the sheet subscribes to the store, so a root left
// mounted reacts to the next test's setState — outside act(), which React rightly complains about.
const mounted = []

async function renderSheet() {
  exerciseNoteSheet(0)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(sheet_close(sheet))); await uiRuntime.fixture.flush(); })
  return host
}
const sheet_close = sheet => () => useUI.getState().closeSheet(sheet.id)

const type = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('exercise note sheet', () => {
  beforeEach(async () => {
    // React only treats act() as real when told it is in a test environment, and vitest shares
    // a worker across files — so set it per test rather than once at module scope.
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    ;await uiRuntime.fixture.applySnapshot(s => ({
      S: { ...s.S, exNotes: {}, active: activeWith({ id: 'bench', sets: [] }) },
    }));
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(r => r.unmount()) })
  })

  it('renders the session note, the pin and the standing note', async () => {
    const host = (await renderSheet())
    const areas = host.querySelectorAll('textarea')
    expect(areas).toHaveLength(2)
    // The pin cannot be set on an empty note — it would pin nothing.
    expect(host.querySelector('[role="switch"]').disabled).toBe(true)
  })

  it('saves the session note with its pin and the standing note separately', async () => {
    const host = (await renderSheet())
    const [today, always] = host.querySelectorAll('textarea')
    await act(async () => { type(today, 'shoulder twinged'); type(always, 'seat at 4'); await uiRuntime.fixture.flush(); })
    await act(async () => { host.querySelector('[role="switch"]').click(); await uiRuntime.fixture.flush(); })
    const save = [...host.querySelectorAll('button')].find(b => /save/i.test(b.textContent))
    await act(async () => { save.click(); await uiRuntime.fixture.flush(); })

    const S = useStore.getState().S
    expect(S.active.entries[0].note).toBe('shoulder twinged')
    expect(S.active.entries[0].notePin).toBe(true)
    // The standing note belongs to the exercise, not to today's entry.
    expect(S.exNotes.bench).toBe('seat at 4')
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('clearing the session note drops the pin with it', async () => {
    ;await uiRuntime.fixture.applySnapshot(s => ({
      S: { ...s.S, active: activeWith({ id: 'bench', sets: [], note: 'old', notePin: true }) },
    }));
    const host = (await renderSheet())
    const [today] = host.querySelectorAll('textarea')
    await act(async () => { type(today, ''); await uiRuntime.fixture.flush(); })
    const save = [...host.querySelectorAll('button')].find(b => /save/i.test(b.textContent))
    await act(async () => { save.click(); await uiRuntime.fixture.flush(); })
    const e = useStore.getState().S.active.entries[0]
    expect(e.note).toBeUndefined()
    expect(e.notePin).toBeUndefined()
  })
})
