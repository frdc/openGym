// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ sync: vi.fn(), open: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ isAndroid: async () => true }))
vi.mock('../lib/wear-bridge.js', () => ({ syncWearApp: native.sync, openWearApp: native.open }))
import WearWorkoutActions from './WearWorkoutActions.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, element
afterEach(async () => { await act(async () => root?.unmount()); element?.remove(); vi.resetAllMocks() })
async function render() {
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root.render(<WearWorkoutActions />))
}
it('shows progress and reports remaining heart data after the watch confirms', async () => {
  let finish; native.sync.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  const button = [...element.querySelectorAll('button')].find(b => b.textContent === 'Sync with watch')
  expect(button).toBeTruthy()
  await act(async () => button.click())
  expect(button.disabled).toBe(true); expect(element.textContent).toContain('Syncing with watch…')
  await act(async () => finish({ heartPending: 1 }))
  expect(element.querySelector('[role="status"]').textContent).toBe('Workout updated. Heart rate data is still pending on the watch.')
  expect(button.disabled).toBe(false)
})
it('shows a preserved-data conflict without offering an automatic overwrite', async () => {
  native.sync.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'sync-conflict' }))
  await render()
  await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === 'Sync with watch').click())
  expect(element.querySelector('[role="status"]').textContent).toBe('Sync conflict. Watch data was kept.')
})
