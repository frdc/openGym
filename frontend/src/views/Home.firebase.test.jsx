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
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__APP_VERSION__ = 'test'
let root, host, onUser
beforeEach(async () => { await fixture.current.prepare({}, { authFactory: input => { onUser = input.onUser; return { ready: Promise.resolve(null), stop() {} } } }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); useUI.setState({ sheets: [] }) })
afterEach(async () => { act(() => root.unmount()); host.remove(); await fixture.current.close() })
const mount = el => act(() => root.render(el))
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent)
import Home from './Home.jsx'
it.each([
  [{ uid: 'a', displayName: 'Ada', email: 'ada@example.com' }, 'Ada'],
  [{ uid: 'a', email: 'ada@example.com' }, 'ada@example.com'],
  [{ uid: 'a' }, 'Account'],
])('greets the confirmed Firebase profile without a legacy name: %s', async (user, label) => {
  await onUser(user); mount(<Home />)
  expect(host.textContent).toContain(label); expect(host.textContent).not.toContain('undefined')
})
