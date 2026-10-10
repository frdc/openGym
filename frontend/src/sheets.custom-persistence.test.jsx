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
import { customExSheet, goalSheet, workoutDateSheet, workoutDurationSheet, equipmentProfileSheet, exerciseNoteSheet, sessionNoteSheet, renameWorkoutSheet } from './sheets.jsx'
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

const type = (selector, value) => act(() => { const el = host.querySelector(selector); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
async function openCustom(edit, done) {
  const existing = { id: 'c-original', n: 'Private row', bp: 'back', eq: 'barbell', custom: true }
  if (edit) { h.storage.commit=originalCommit; h.store.getState().update(s=>{s.customEx=[existing]}); await h.store.getState().flushLocal(); h.storage.commit=async(...args)=>{await gate.promise;return originalCommit(...args)} }
  act(()=>customExSheet(edit ? existing : null, done))
  type('input.input', 'Private exercise')
  if (!edit) act(()=>{button('back').click();button('barbell').click()})
}
const clickSave = async edit => act(async()=>{button(edit?'Save':'Create exercise').click();await Promise.resolve()})
it.each([false,true])('custom exercise edit=%s waits for durability and completes once',async edit=>{
  const done=vi.fn();await openCustom(edit,done);await clickSave(edit)
  expect(done).not.toHaveBeenCalled();expect(useUI.getState().sheets).toHaveLength(1)
  expect(button(edit?'Save':'Create exercise').disabled).toBe(true)
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect(done).toHaveBeenCalledTimes(1)
  expect((await h.saved()).state.customEx).toHaveLength(1)
  expect(useUI.getState().sheets).toHaveLength(0)
})
it.each([false,true])('custom exercise edit=%s retains draft after persistent failure and retries without duplicate ID',async edit=>{
  const done=vi.fn();await openCustom(edit,done)
  h.storage.commit=async()=>{await gate.promise;throw Object.assign(new Error('quota'),{code:'storage-full'})}
  await clickSave(edit);await act(async()=>{gate.resolve();await h.store.getState().flushLocal().catch(()=>{})})
  const id=h.store.getState().S.customEx[0].id
  expect(done).not.toHaveBeenCalled();expect(useUI.getState().sheets).toHaveLength(1)
  expect(host.querySelector('input.input').value).toBe('Private exercise')
  expect(useUI.getState().toastMsg).toContain('Changes could not be saved')
  h.storage.commit=originalCommit
  await act(async()=>{button(edit?'Save':'Create exercise').click();await h.store.getState().flushLocal()})
  expect((await h.saved()).state.customEx.map(e=>e.id)).toEqual([id]);expect(done).toHaveBeenCalledTimes(1)
})
it.each(['cancel','unmount','owner'])('custom exercise suppresses success after %s',async change=>{
  const done=vi.fn();await openCustom(false,done);await clickSave(false)
  if(change==='cancel')act(()=>useUI.getState().closeAll())
  if(change==='unmount')act(()=>root.render(null))
  await act(async()=>{const switching=change==='owner'?h.auth('b'):null;gate.resolve();await switching;await h.store.getState().flushLocal()})
  expect(done).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).not.toContain('created')
})
it('goal Save waits for local confirmation before closing and reporting success',async()=>{
  act(()=>goalSheet());await act(async()=>{button('Save goal').click();await Promise.resolve()})
  expect(useUI.getState().sheets).toHaveLength(1);expect(useUI.getState().toastMsg).not.toContain('Goal set:')
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect(useUI.getState().sheets).toHaveLength(0);expect(useUI.getState().toastMsg).toContain('Goal set:')
})

it.each(['date','duration','equipment','exercise-note','session-note','rename'])('%s Save keeps its editor until durable confirmation', async kind => {
  const w={id:'w',d:'2026-01-01',start:new Date('2026-01-01T10:00:00').getTime(),end:new Date('2026-01-01T11:00:00').getTime(),entries:[]}
  h.storage.commit=originalCommit
  h.store.getState().update(s=>{s.workouts=[w];s.active={id:'active',name:'Draft',entries:[{id:'0025',sets:[]}]}})
  await h.store.getState().flushLocal()
  h.storage.commit=async(...args)=>{await gate.promise;return originalCommit(...args)}
  const done=vi.fn()
  act(()=>{
    if(kind==='date')workoutDateSheet(w,done)
    if(kind==='duration')workoutDurationSheet(w,done)
    if(kind==='equipment')equipmentProfileSheet()
    if(kind==='exercise-note')exerciseNoteSheet(0)
    if(kind==='session-note')sessionNoteSheet()
    if(kind==='rename')renameWorkoutSheet()
  })
  if(kind==='date')type('input[type="date"]','2026-01-02')
  if(kind==='duration')type('input','30')
  if(kind==='equipment')type('input','Home')
  if(kind.endsWith('note'))type('textarea','Retained note')
  if(kind==='rename')type('input','Renamed')
  await act(async()=>{button('Save').click();await Promise.resolve()})
  expect(useUI.getState().sheets).toHaveLength(1);expect(done).not.toHaveBeenCalled()
  await act(async()=>{gate.resolve();await h.store.getState().flushLocal()})
  expect(useUI.getState().sheets).toHaveLength(0)
})
