// @vitest-environment happy-dom
// Issue #239: the local "rest over" alert ignored the Push switch in Settings. Every rest asked
// for the notification permission on its own, and once granted it fired with the switch off —
// a page cannot give a permission back. "On" is this browser holding a push subscription.

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('./useStore.js', async original => {
  const actual = (await original())
  const { createUIStoreFixture } = (await import('./ui-test-runtime.js'))
  uiRuntime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: uiRuntime.fixture.useStore }
})

afterEach(async () => { await uiRuntime.fixture.close(); })
beforeEach(async () => { uiRuntime.fixture.begin(); await uiRuntime.fixture.prepare({ active: { id: 'timer-fixture', entries: [] } }); })
afterEach(async () => { await uiRuntime.fixture.flush(); })
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

let showNotification, requestPermission, subscription, originalSettings
const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}
const runOut = async () => {
  useUI.getState().startRest(2)
  hide(true)
  await vi.advanceTimersByTimeAsync(3000)
}

beforeEach(async () => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  await uiRuntime.fixture.applySnapshot({ S: { ...originalSettings, sound: false }, user: null })
  useUI.setState({ timer: null })
  showNotification = vi.fn()
  requestPermission = vi.fn(async () => 'granted')
  subscription = null
  globalThis.Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission })
  window.Notification = globalThis.Notification
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification, pushManager: { getSubscription: async () => subscription } }) },
  })
})
afterEach(() => {
  useUI.getState().stopRest()
  hide(false)

  delete globalThis.Notification
  vi.useRealTimers()
})

describe('the local rest-over alert follows browser permission', () => {
  it('stays silent when browser permission is denied', async () => {
    globalThis.Notification.permission = 'denied'
    await runOut()
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('fires once with granted permission without repeating the title', async () => {
    subscription = { endpoint: 'https://push.example/x' }
    await runOut()
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0]
    expect(title).toBe('Rest’s over. Next set!')
    expect(opts.tag).toBe('rest-timer')
    expect(opts.body).toBeUndefined()
  })

  it('never asks for permission by itself', async () => {
    globalThis.Notification.permission = 'default'
    await runOut()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
  })
})
