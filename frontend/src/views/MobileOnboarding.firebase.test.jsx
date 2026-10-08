// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
const fixture = vi.hoisted(() => ({ current: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  fixture.current = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: fixture.current.useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__APP_VERSION__ = 'test'
let root, host
beforeEach(async () => { await fixture.current.prepare(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); useUI.setState({ sheets: [] }) })
afterEach(async () => { act(() => root.unmount()); host.remove(); await fixture.current.close() })
const mount = el => act(() => root.render(el))
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent)
import MobileOnboarding from './MobileOnboarding.jsx'
it('offers local and Firebase account choices without pairing', () => {
  mount(<MobileOnboarding />)
  expect(buttons()).toEqual(expect.arrayContaining(['Use on this device', 'Sign in', 'Create account']))
  expect(host.textContent).not.toMatch(/pair|server/i)
})
