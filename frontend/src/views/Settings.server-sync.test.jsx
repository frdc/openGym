// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ServerSyncSection, OwedSheet, leaveServer, syncNowWithToast } from '../components/ServerSync.jsx'
const h = vi.hoisted(() => ({ fixture: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  h.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: h.fixture.useStore }
})
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(async () => false), menuSheet: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, onUser
beforeEach(async () => {
  await h.fixture.prepare({}, { authFactory: input => { onUser = input.onUser; return { ready: Promise.resolve(null), stop() {}, signOut: () => onUser(null) } } })
  useUI.setState({ sheets: [], toastMsg: '' }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); await h.fixture.close() })
const mount = element => act(() => root.render(element))
const click = async text => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text).click() })
it('names the confirmed Firebase account and separates device saving from cloud state', async () => {
  await onUser({ uid: 'a', email: 'a@example.com', displayName: 'Ada' })
  useStore.setState({ sync: { local: 'saved', cloud: 'synced' } }); mount(<ServerSyncSection />)
  expect(host.textContent).toContain('Ada'); expect(host.textContent).toContain('All synced'); expect(host.textContent).toContain('Saved on this device')
})
it('names blocked cloud paths and pending count without exposing provider internals', () => {
  useStore.setState({ sync: { local: 'saved', cloud: 'blocked', pendingCount: 2, cloudError: { path: 'workouts/abc', message: 'private-token' } } })
  mount(<ServerSyncSection />); expect(host.textContent).toContain('workouts/abc'); expect(host.textContent).toContain('Review pending changes'); expect(host.textContent).not.toContain('private-token')
})
it('offers recoverable unknown copies while keeping their raw source internal', async () => {
  await h.fixture.prepare({}, { legacyReader: { read: async () => [{ sourceId: 'legacy-node', state: { workouts: [], coach: { secret: 'private' } } }] } })
  mount(<ServerSyncSection />); expect(host.textContent).toContain('Recoverable local copy'); expect(host.textContent).not.toContain('private')
})
it('signs out a confirmed account with no pending edits', async () => {
  await onUser({ uid: 'a' }); const done = vi.fn()
  await leaveServer('signout', { done }); expect(done).toHaveBeenCalledOnce(); expect(useStore.getState().user).toBeNull()
})
it('offers export, retry, and explicit signout for pending local changes', async () => {
  await onUser({ uid: 'a' }); useStore.getState().update(s => { s.sound = !s.sound }, false); await h.fixture.flush()
  const done = vi.fn(), exportBackup = vi.fn(), exportBackupZip = vi.fn()
  await leaveServer('signout', { done, exportBackup, exportBackupZip }); expect(done).not.toHaveBeenCalled()
  const sheet = useUI.getState().sheets.at(-1); mount(sheet.render(() => {}))
  expect(host.textContent).toContain('pending changes'); await click('Export backup (JSON)'); expect(exportBackup).toHaveBeenCalledOnce()
  await click('Export with photos & videos (.zip)'); expect(exportBackupZip).toHaveBeenCalledOnce()
  await click('Sign out anyway'); expect(done).toHaveBeenCalledOnce(); expect(useStore.getState().user).toBeNull()
})
it('a failed local departure says nothing was removed and never calls completion', async () => {
  const done = vi.fn(); useStore.setState({ signOut: vi.fn(async () => { throw new Error('storage-full') }) })
  mount(<OwedSheet count={2} done={done} close={() => {}} exportBackup={() => {}} />)
  await click('Sign out anyway'); expect(done).not.toHaveBeenCalled(); expect(host.textContent).toContain('Nothing was removed.')
})
it('suppresses a late departure result after the sheet unmounts', async () => {
  let resolve; const done = vi.fn(); useStore.setState({ signOut: () => new Promise(r => { resolve = r }) })
  mount(<OwedSheet count={1} done={done} close={() => {}} exportBackup={() => {}} />)
  await click('Try again'); act(() => root.render(null)); await act(async () => { resolve({ owed: false }) }); expect(done).not.toHaveBeenCalled()
})
it('retries local durability before cloud sync', async () => {
  const calls = []
  useStore.setState({ sync: { local: 'error', cloud: 'pending' }, retryLocal: async () => { calls.push('local') }, syncNow: async () => { calls.push('cloud') } })
  await syncNowWithToast(); expect(calls).toEqual(['local', 'cloud'])
})

it('does not continue a local retry into B cloud sync after an owner change', async () => {
  await onUser({ uid: 'a' }); let release
  const retryLocal = () => new Promise(resolve => { release = resolve }), syncNow = vi.fn()
  useStore.setState({ sync: { local: 'error', cloud: 'pending' }, retryLocal, syncNow })
  const retry = syncNowWithToast(); await onUser({ uid: 'b' }); release(); await retry
  expect(syncNow).not.toHaveBeenCalled(); expect(useUI.getState().toastMsg).toBe('')
})
it('an old departure sheet cannot export the new account backup', async () => {
  await onUser({ uid: 'a' }); const exportBackup = vi.fn()
  mount(<OwedSheet count={1} done={() => {}} close={() => {}} exportBackup={exportBackup} />)
  await act(async () => { await onUser({ uid: 'b' }) }); await click('Export backup (JSON)')
  expect(exportBackup).not.toHaveBeenCalled()
})
