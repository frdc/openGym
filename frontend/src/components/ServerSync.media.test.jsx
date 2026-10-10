// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const fixture = vi.hoisted(() => ({ value: null }))
vi.mock('../store/useStore.js', async importOriginal => {
  const actual = await importOriginal()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  fixture.value = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: fixture.value.useStore }
})
import { OwedSheet } from './ServerSync.jsx'
import { runtime } from '../store/cloud-test-runtime.js'
import { useStore } from '../store/useStore.js'
let host, root, rt
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  rt = await runtime({ cloud: true }); await rt.auth('A')
  await fixture.value.attach(rt.store)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); await fixture.value.close() })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
describe('backup choices alongside account-local media', () => {
  it('offers the ZIP and JSON backups without claiming local photos await upload', async () => {
    const zip = vi.fn(), json = vi.fn()
    act(() => root.render(<OwedSheet count={0} exportBackup={json} exportBackupZip={zip} done={() => {}} close={() => {}} />))
    expect(host.textContent).toContain('0 pending changes')
    expect(host.textContent).not.toContain('waiting to upload')
    act(() => button('Export with photos & videos (.zip)').click())
    act(() => button('Export backup (JSON)').click())
    expect(zip).toHaveBeenCalledOnce(); expect(json).toHaveBeenCalledOnce()
  })
  it('Try again uses the actual account sync/sign-out without a media transport', async () => {
    const done = vi.fn()
    act(() => root.render(<OwedSheet count={0} exportBackup={() => {}} done={done} close={() => {}} />))
    await act(async () => { button('Try again').click(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(done).toHaveBeenCalledOnce()
    expect(useStore.getState().user).toBeNull()
  })
  it('rejects stale ZIP/JSON actions after switching to B', async () => {
    const zip = vi.fn(), json = vi.fn()
    act(() => root.render(<OwedSheet count={2} exportBackup={json} exportBackupZip={zip} done={() => {}} close={() => {}} />))
    await act(async () => rt.auth('B'))
    act(() => button('Export with photos & videos (.zip)').click())
    act(() => button('Export backup (JSON)').click())
    expect(zip).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled()
  })
})
