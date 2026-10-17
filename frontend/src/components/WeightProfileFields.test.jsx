// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({ fixture: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  runtime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: runtime.fixture.useStore }
})
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { WeightProfileFields } from './WeightProfileFields.jsx'
import { bindUI } from './ui.jsx'

let root, host, selected
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  bindUI(useUI)
  runtime.fixture.begin()
  await runtime.fixture.applySnapshot({ S: { ...useStore.getState().S, unit: 'kg', weightProfiles: {} } })
  useUI.setState({ sheets: [] }); selected = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => {
  act(() => root.unmount()); host.remove(); useUI.setState({ sheets: [] }); await runtime.fixture.close()
})
const clickText = (parent, label) => [...parent.querySelectorAll('button')].find(b => b.textContent.includes(label)).click()
function render() {
  root.render(<WeightProfileFields cfg={{ inc: 2.5 }} onChange={cfg => { selected = cfg }} />)
}
function showTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
it('offers saved profiles directly from the exercise and uses Movement without losing the manual step', async () => {
  await act(async () => render())
  expect(host.textContent).toContain('Weight type')
  act(() => clickText(host, 'Weight type'))
  act(() => showTopSheet())
  expect(host.textContent).toContain('5.3 / 5.3 kg')
  act(() => clickText(host, 'Movement'))
  expect(selected).toMatchObject({ inc: 2.5, weightProfile: { name: 'Movement', start: 11.8, step: 6.8 } })
})
it('creates a custom decimal profile and durably saves it before applying selection', async () => {
  await act(async () => render())
  act(() => clickText(host, 'Weight type')); act(() => showTopSheet())
  act(() => clickText(host, 'New weight profile')); act(() => showTopSheet())
  act(() => type(host.querySelector('[aria-label="Profile name"]'), 'My machine'))
  act(() => type(host.querySelector('[aria-label="Initial load (kg)"]'), '11,8'))
  act(() => type(host.querySelector('[aria-label="Load increment (kg)"]'), '6,8'))
  await act(async () => { clickText(host, 'Save'); await runtime.fixture.flush() })
  const saved = Object.values(useStore.getState().S.weightProfiles).find(p => p.name === 'My machine')
  expect(saved).toMatchObject({ unit: 'kg', start: 11.8, step: 6.8 })
  expect(selected.weightProfile.id).toBe(saved.id)
})
