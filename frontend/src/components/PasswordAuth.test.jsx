// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { PasswordSignInSheet, PasswordRegisterForm, passwordError, looksLikeEmail } from './PasswordAuth.jsx'
const h = vi.hoisted(() => ({ fixture: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  h.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: h.fixture.useStore }
})
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(async () => false) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, onUser, close, login, register, resetPassword
beforeEach(async () => {
  close = vi.fn(); login = vi.fn(async () => ({ uid: 'a' })); register = vi.fn(async () => ({ uid: 'a' })); resetPassword = vi.fn(async () => {})
  await h.fixture.prepare({}, { authFactory: input => { onUser = input.onUser; return { ready: Promise.resolve(null), stop() {}, login, register, resetPassword } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); await h.fixture.close() })
const mount = (signup = false) => act(() => root.render(signup ? <PasswordRegisterForm close={close} /> : <PasswordSignInSheet close={close} />))
const type = (name, value) => act(() => { const el = host.querySelector(`[name="${name}"]`); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
const click = async text => { await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text).click() }) }
const submit = async () => { await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() }) }
const credentials = () => { type('email', '  Ada@example.com  '); type('password', 'secret1') }
it('validates email and passwords locally, retaining password-manager semantics', async () => {
  mount(true); type('email', 'bad'); await submit(); expect(login).not.toHaveBeenCalled(); expect(host.textContent).toContain('That is not an e-mail address.')
  type('email', 'a@example.com'); type('password', '123'); await submit(); expect(host.textContent).toContain('Use at least 6 characters.')
  type('password', 'secret1'); type('password-again', 'other'); await submit(); expect(host.textContent).toContain('The two passwords are not the same.')
  expect(register).not.toHaveBeenCalled(); expect(host.querySelectorAll('[autocomplete="new-password"]')).toHaveLength(2)
  expect(looksLikeEmail('user@example.com')).toBe(true)
})
it('waits for confirmed Auth ownership before closing sign in', async () => {
  mount(); credentials(); await submit(); expect(login).toHaveBeenCalledWith('Ada@example.com', 'secret1'); expect(close).not.toHaveBeenCalled()
  expect(useStore.getState().user).toBeNull()
  await act(async () => { await onUser({ uid: 'a', email: 'Ada@example.com' }) }); expect(close).toHaveBeenCalledOnce()
})
it('registers with the same confirmed ownership barrier', async () => {
  mount(true); credentials(); type('password-again', 'secret1'); await submit(); expect(register).toHaveBeenCalledWith('Ada@example.com', 'secret1'); expect(close).not.toHaveBeenCalled()
  await act(async () => { await onUser({ uid: 'a' }) }); expect(close).toHaveBeenCalledOnce()
})
it('sends a reset email and clears a previous safe translated error on retry', async () => {
  mount(); credentials(); login.mockRejectedValueOnce({ code: 'auth/invalid-credential', message: 'secret token' }); await submit()
  expect(host.textContent).toContain('Wrong e-mail or password.'); expect(host.textContent).not.toContain('secret token')
  await click('Reset your password'); expect(host.querySelector('[name="password"]')).toBeNull(); await submit()
  expect(resetPassword).toHaveBeenCalledWith('Ada@example.com'); expect(host.textContent).toContain('Check your e-mail for a password reset link.')
})
it('ignores a delayed login UI callback after cancellation', async () => {
  let resolve; login.mockReturnValueOnce(new Promise(r => { resolve = r })); mount(); credentials(); await submit(); await click('Cancel')
  await act(async () => { resolve({ uid: 'a' }); await onUser({ uid: 'a' }) }); expect(close).toHaveBeenCalledOnce()
})
it('mode changes invalidate pending results and duplicate submits cannot duplicate Auth requests', async () => {
  let reject; login.mockReturnValueOnce(new Promise((_, r) => { reject = r })); mount(); credentials(); await submit(); await submit(); expect(login).toHaveBeenCalledOnce()
  await click('Reset your password'); await act(async () => { reject({ code: 'auth/wrong-password' }) }); expect(host.textContent).not.toContain('Wrong e-mail or password.')
})
it.each(['auth/user-disabled', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/not-configured', 'unknown'])('does not expose provider details for %s', code => {
  expect(passwordError({ code, message: 'token=private' })).not.toContain('private')
})
