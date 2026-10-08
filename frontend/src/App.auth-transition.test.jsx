// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { openPasswordSignIn, openPasswordRegister } from './components/PasswordAuth.jsx'
import { leaveServer } from './components/ServerSync.jsx'
import { fakeStorage } from './lib/cloud/test-fixtures.js'
import { makeOwner } from './lib/cloud/model.js'
const h = vi.hoisted(() => ({ fixture: null }))
vi.mock('./store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('./store/ui-test-runtime.js')
  h.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: h.fixture.useStore }
})
vi.mock('./views/Home.jsx', () => ({ default: () => <div data-domain>Ready profile content</div> }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, onUser, login, register, release, transition, adoption, failRead
beforeEach(async () => {
  failRead = false; localStorage.clear(); location.hash = '#/home'; useUI.getState().closeAll()
  const gate = new Promise(r => { release = r }), storage = fakeStorage(), read = storage.read
  const owner = makeOwner('demo-opengym', 'a')
  storage.read = async key => { if (key === owner.ownerKey) { await gate; if (failRead) { failRead = false; throw Object.assign(new Error('read unavailable'), {code:'storage-unavailable'}) } } return read(key) }
  login = vi.fn(async () => { transition = onUser({ uid: 'a', email: 'a@example.test' }); return { uid: 'a' } })
  register = vi.fn(async () => { transition = onUser({ uid: 'a', email: 'a@example.test' }); return { uid: 'a' } })
  await h.fixture.prepare({}, { storage, authFactory: input => { onUser = input.onUser; return { ready: Promise.resolve(null), stop() {}, login, register, signOut: () => onUser(null) } } })
  adoption = vi.spyOn(useStore.getState(), 'adoptProfile').mockResolvedValue(null)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<App />) })
})
afterEach(async () => { release(); await act(async () => { await transition; root.unmount(); useUI.getState().closeAll() }); host.remove(); await h.fixture.close(); vi.restoreAllMocks() })
const type = (name, value) => act(() => { const el = host.querySelector(`[name="${name}"]`); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
async function submit(signup) {
  act(() => { (signup ? openPasswordRegister : openPasswordSignIn)() })
  type('email', 'a@example.test'); type('password', 'secret1'); if (signup) type('password-again', 'secret1')
  await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
}
it.each([false, true])('closes successful account form only after the real Shell hydration transition (register=%s)', async signup => {
  await submit(signup)
  expect(useStore.getState().localReady).toBe(false)
  expect(host.querySelector('[data-domain]')).toBeNull()
  expect(adoption).not.toHaveBeenCalled()
  const modal = host.querySelector('#modal-root')
  expect(modal?.hidden).toBe(true); expect(modal?.hasAttribute('inert')).toBe(true); expect(modal?.style.display).toBe('none')
  await act(async () => { release(); await transition })
  expect(useStore.getState()).toMatchObject({localReady:true,user:{uid:'a'}})
  expect(useUI.getState().sheets).toHaveLength(0)
  expect(host.querySelector('form')).toBeNull()
  expect(host.querySelector('[data-domain]')).not.toBeNull()
  expect(adoption).toHaveBeenCalledOnce()
})
it('closing the sheet during hydration invalidates its late successful result', async () => {
  await submit(false)
  act(() => useUI.getState().closeAll())
  await act(async () => { release(); await transition })
  expect(useUI.getState().sheets).toHaveLength(0)
  expect(adoption).not.toHaveBeenCalled()
})

it('retains only the account form while an owner read fails, and closes after a successful retry', async () => {
  failRead = true
  await submit(false)
  await act(async () => { release(); await transition })
  expect(useStore.getState()).toMatchObject({localReady:false,sync:{local:'error'}})
  expect(host.querySelector('[data-domain]')).toBeNull()
  expect(host.querySelector('#modal-root')?.hidden).toBe(true)
  expect(host.textContent).toContain('Try again')
  expect(adoption).not.toHaveBeenCalled()
  await act(async () => { await useStore.getState().retryLocal() })
  expect(useStore.getState()).toMatchObject({localReady:true,user:{uid:'a'}})
  expect(useUI.getState().sheets).toHaveLength(0)
  expect(adoption).toHaveBeenCalledOnce()
})
it('a mismatched SDK result cannot close or adopt the confirmed account', async () => {
  login.mockImplementationOnce(async () => { transition = onUser({uid:'a'}); return {uid:'b'} })
  await submit(false)
  await act(async () => { release(); await transition })
  expect(useStore.getState()).toMatchObject({localReady:true,user:{uid:'a'}})
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(host.textContent).toContain('Opening your local account')
  expect(adoption).not.toHaveBeenCalled()
})
it('ordinary domain sheets unmount during hydration instead of retaining their content', async () => {
  const unmounted = vi.fn()
  function DomainSheet() { React.useEffect(() => unmounted, []); return <div data-private>Prior profile sheet content</div> }
  act(() => useUI.getState().openSheet(() => <DomainSheet />))
  expect(host.querySelector('[data-private]')).not.toBeNull()
  await submit(false)
  expect(host.querySelector('[data-private]')).toBeNull()
  expect(unmounted).toHaveBeenCalledOnce()
  await act(async () => { release(); await transition })
  expect(adoption).toHaveBeenCalledOnce()
  expect(useUI.getState().sheets).toHaveLength(1)
})
it('StrictMode forced sign-out acts once and closes its dialog after real guest hydration', async () => {
  await act(async () => { release(); await onUser({uid:'a'}); root.render(<React.StrictMode><App /></React.StrictMode>) })
  await act(async () => { useStore.getState().update(s => { s.routines.push({id:'pending-a',name:'Pending A',ex:[]}) }, false); await useStore.getState().flushLocal() })
  const done=vi.fn()
  await act(async () => { await leaveServer('signout',{exportBackup:vi.fn(),done}) })
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(host.textContent).toContain('Sign out anyway')
  await act(async () => { [...host.querySelectorAll('button')].find(b=>b.textContent==='Sign out anyway').click(); await new Promise(r=>setTimeout(r,20)) })
  expect(useStore.getState()).toMatchObject({localReady:true,user:null})
  expect(useUI.getState().sheets).toHaveLength(0)
  expect(done).toHaveBeenCalledOnce()
  expect(done.mock.calls[0][0]).toMatchObject({owed:true,stashed:true})
})