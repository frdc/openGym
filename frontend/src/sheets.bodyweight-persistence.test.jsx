// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const slot = vi.hoisted(() => ({ fixture: null }))
vi.mock('./store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('./store/ui-test-runtime.js')
  slot.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: slot.fixture.useStore }
})
import { runtime, deferred } from './store/cloud-test-runtime.js'
import { bwSheet } from './sheets.jsx'
import Modals from './components/Modals.jsx'
import { useUI } from './store/useUI.js'
let root, host, h, gate, originalCommit
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({sheets:[],toastMsg:''})
  h=await runtime(); await slot.fixture.attach(h.store)
  gate=deferred(); originalCommit=h.storage.commit
  h.storage.commit=async (...args)=>{await gate.promise; return originalCommit(...args)}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
  act(()=>root.render(<React.StrictMode><Modals /></React.StrictMode>))
})
afterEach(async()=>{gate.resolve();h.storage.commit=originalCommit;await act(async()=>{await h.store.getState().flushLocal().catch(()=>{});root.unmount();useUI.getState().closeAll()});host.remove();await slot.fixture.close()})
const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)
async function save(options={}) {
  act(()=>bwSheet(options))
  await act(async()=>{button(options.required?'Save & start workout':'Save').click();await Promise.resolve()})
}
it('never calls a weight saved toast before confirmed disk commit',async()=>{
  await save()
  expect(h.store.getState().sync.local).toBe('saving')
  expect(useUI.getState().toastMsg).not.toBe('Weight saved')
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(button('Save').disabled).toBe(true)
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect((await h.saved()).state.bodyweight[0].w).toBe(70)
  expect(useUI.getState().toastMsg).toBe('Weight saved')
  expect(useUI.getState().sheets).toHaveLength(0)
})
it('starts the required workout once only after local confirmation',async()=>{
  const done=vi.fn();await save({required:true,onDone:done})
  expect(done).not.toHaveBeenCalled()
  act(()=>button('Save & start workout').click())
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect(done).toHaveBeenCalledExactlyOnceWith(70)
})
it('keeps failed weight intent retryable without saved toast or workout start',async()=>{
  h.storage.commit=async()=>{await gate.promise;throw Object.assign(new Error('quota'),{code:'storage-full'})}
  const done=vi.fn();await save({required:true,onDone:done})
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal().catch(()=>{})})
  expect(done).not.toHaveBeenCalled();expect(h.store.getState().sync.local).toBe('error')
  expect(h.store.getState().S.bodyweight[0].w).toBe(70)
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(useUI.getState().toastMsg).toBe('Changes could not be saved on this device. Keep the app open and try again.')
  h.storage.commit=originalCommit
  await act(async()=>{button('Save & start workout').click();await h.store.getState().flushLocal()})
  expect(done).toHaveBeenCalledExactlyOnceWith(70)
})
it('dismissal while the write is pending cancels late success effects',async()=>{
  const done=vi.fn();await save({required:true,onDone:done})
  act(()=>useUI.getState().closeAll())
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect(done).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).not.toBe('Weight saved')
})
it('an owner transition while saving cancels late workout start',async()=>{
  const done=vi.fn();await save({required:true,onDone:done})
  await act(async()=>{const switching=h.auth('b');gate.resolve();await switching})
  expect(done).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).not.toBe('Weight saved')
  expect(h.store.getState().user.uid).toBe('b')
})
