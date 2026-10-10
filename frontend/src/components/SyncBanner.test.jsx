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

const patch = sync => act(() => useStore.setState({ sync: { local: 'saved', cloud: 'synced', ...sync }, user: { uid: 'a' }, isGuest: () => false }))
const indicator = () => { function Dot() { return <i>{String(useConnectionTrouble())}</i> }; mount(<><SyncBanner /><Dot /></>) }


import SyncBanner, { useConnectionTrouble, PENDING_GRACE_MS } from './SyncBanner.jsx'

import { connectionView } from './ServerSync.jsx'


it('leaves all page height available while synced', () => { patch({}); mount(<SyncBanner />); expect(host.textContent).toBe(''); expect(document.documentElement.style.getPropertyValue('--conn')).toBe('') })
it('shows local saving and failed writes without claiming they are saved', () => {
  patch({ local: 'saving' }); mount(<SyncBanner />); expect(host.textContent).toContain('Saving on this device')
  patch({ local: 'error' }); expect(host.textContent).toContain('could not be saved'); expect(host.textContent).not.toContain('are saved')
})
it.each(['waiting', 'auth-required', 'blocked', 'adoption-required'])('shows cloud %s and a matching action', cloud => {
  patch({ cloud }); mount(<SyncBanner />); expect(host.querySelector('button')).toBeTruthy(); expect(host.querySelector('[role="status"]')).toBeTruthy()
})
it('delays pending changes, cancels the delay after success, and uses the same grace for the hidden indicator', () => {
  vi.useFakeTimers()
  try {
    patch({ cloud: 'pending' }); mount(<SyncBanner />); expect(host.textContent).toBe('')
    act(() => vi.advanceTimersByTime(PENDING_GRACE_MS - 1)); expect(host.textContent).toBe('')
    patch({}); act(() => vi.advanceTimersByTime(1)); expect(host.textContent).toBe('')
    act(() => fixture.current.setFixture(s => { s.connStatus = false })); patch({ cloud: 'pending' }); indicator(); expect(host.textContent).toBe('false')
    act(() => vi.advanceTimersByTime(PENDING_GRACE_MS)); expect(host.textContent).toBe('true')
  } finally { vi.useRealTimers() }
})
it('shows browser offline immediately and follows the online event', () => {
  patch({}); mount(<SyncBanner />)
  const prior = Object.getOwnPropertyDescriptor(navigator, 'onLine')
  try {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); act(() => window.dispatchEvent(new Event('offline'))); expect(host.textContent).toContain('Offline')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); act(() => window.dispatchEvent(new Event('online'))); expect(host.textContent).toBe('')
  } finally { if (prior) Object.defineProperty(navigator, 'onLine', prior); else delete navigator.onLine }
})
it('local-only is a quiet choice and never a hidden trouble indicator', () => {
  act(() => { fixture.current.setFixture(s => { s.connStatus = false }); useStore.setState({ sync: { local: 'saved', cloud: 'unconfigured' }, user: null, isGuest: () => true }) }); indicator(); expect(host.textContent).toBe('false')
})
it('the visible banner replaces the hidden trouble indicator', () => { patch({ cloud: 'blocked' }); indicator(); expect(host.querySelector('i').textContent).toBe('false') })
