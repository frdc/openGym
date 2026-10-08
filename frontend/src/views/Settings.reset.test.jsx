// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Reset awaits durable storage and keeps callbacks bound to the account that opened it.
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, coachLocal: null, epoch: 1 }
  state.replaceState = vi.fn()
  state.resetEverything = vi.fn()
  state.confirmSheet = vi.fn()
  state.forgetCoach = vi.fn(() => Promise.resolve({ ok: true }))
  state.api = vi.fn(() => Promise.resolve({ ok: true }))
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S, getContext: () => ({ ownerKey: state.user?.uid || 'guest', epoch: state.epoch }),
    user: state.user,
    coachLocal: state.coachLocal,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: state.replaceState, resetEverything: state.resetEverything, setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.epoch = 1
  mocks.user = null
  mocks.coachLocal = null
  mocks.replaceState.mockClear()
  mocks.resetEverything.mockClear()
  mocks.confirmSheet.mockClear()
  mocks.forgetCoach.mockClear()
  mocks.api.mockClear()
  mocks.toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="data" />))
const resetRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Reset everything'))
const openDialog = () => {
  act(() => { resetRow().click() })
  expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
  return mocks.confirmSheet.mock.calls[0][0]
}
const serverForgetCalls = () => mocks.api.mock.calls.filter(([path]) => path === '/api/coach/forget')

describe('Settings — reset everything', () => {
  it.each([null, { uid: 'u1', email: 'ana@example.com' }])('awaits the reset for %s before reporting success without any Coach calls', async user => {
    mocks.user = user
    let finish; mocks.resetEverything.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    mount(); const dialog = openDialog()
    expect(dialog.title).toBe('Reset everything?')
    expect(dialog.message).toContain('This cannot be undone.')
    const resetting = dialog.onConfirm()
    expect(mocks.resetEverything).toHaveBeenCalledOnce(); expect(mocks.toast).not.toHaveBeenCalled()
    await act(async () => { finish(); await resetting })
    expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.forgetCoach).not.toHaveBeenCalled(); expect(mocks.toast).toHaveBeenCalledWith('All data reset')
  })
  it('does not run a reset confirmed after an account transition', async () => {
    mocks.user = { uid: 'A' }; mount(); const dialog = openDialog()
    mocks.user = { uid: 'B' }; mocks.epoch++
    await dialog.onConfirm()
    expect(mocks.resetEverything).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled()
  })
  it.each(['owner', 'unmount'])('ignores completion after %s changes', async transition => {
    mocks.user = { uid: 'A' }
    let finish; mocks.resetEverything.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    mount(); const resetting = openDialog().onConfirm()
    if (transition === 'owner') { mocks.user = { uid: 'B' }; mocks.epoch++ }
    else act(() => root.render(null))
    await act(async () => { finish(); await resetting })
    expect(mocks.toast).not.toHaveBeenCalled()
  })
  it('retains the local copy and never reports success when durable reset fails', async () => {
    mocks.resetEverything.mockRejectedValueOnce(new Error('storage-full'))
    mount(); const dialog = openDialog(); await expect(dialog.onConfirm()).rejects.toThrow('storage-full')
    expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled()
  })
})

describe('Settings — footer', () => {
  it('links the source code to its home on GitHub, on About & updates', () => {
    act(() => root.render(<Settings page="about" />))
    const link = [...host.querySelectorAll('a')].find(a => a.textContent === 'Source code')
    expect(link.getAttribute('href')).toBe('https://github.com/DuarteSantos8/openGym')
  })
})
