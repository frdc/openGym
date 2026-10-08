// @vitest-environment happy-dom
// #375: on silent, the end of a rest buzzed nowhere — the page's buzz and the notification
// channel's are both muted. With "Vibrate when the phone is on silent" on, the native alarm is
// told to buzz as an alarm, and the page's own end-of-rest buzz goes through alertBuzz (which
// App.jsx points at the native alarm buzz). A set tick stays an ordinary buzz.

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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/mobile.js', async importOriginal => ({ ...((await importOriginal())), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { armRestAlert } from '../lib/rest-alert.js'
import { alertBuzz, vibrate } from '../lib/sound.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useUI.setState({ timer: null, timerFlashId: 0 })
  for (const f of [armRestAlert, alertBuzz, vibrate]) f.mockClear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => {
  useUI.getState().stopRest()

  vi.useRealTimers()
})

const withSettings = async over => (await uiRuntime.fixture.applySnapshot({ S: { ...original, sound: false, ...over }, user: null }))

describe('vibrate on silent', () => {
  it('asks the native alarm for an alarm buzz only with the setting and Vibrate both on', async () => {
    await withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: true, alarmBuzz: true }))

    await withSettings({ vibrate: false, vibrateOnSilent: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: false, alarmBuzz: false }))

    await withSettings({ vibrate: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ alarmBuzz: false }))
  })

  it('the end of a rest seen on screen buzzes through alertBuzz', async () => {
    await withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(alertBuzz).toHaveBeenCalledWith([200, 100, 200])
    expect(vibrate).not.toHaveBeenCalledWith([200, 100, 200])
  })

  it('a hold that ends early only ticks, the ordinary way', async () => {
    await withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startWork(30, 'Plank', () => {})
    useUI.getState().finishWorkEarly()
    expect(vibrate).toHaveBeenCalledWith(30)
    expect(alertBuzz).not.toHaveBeenCalled()
  })

  it('is off for a profile that never chose', async () => {
    const { DEF } = (await import('./useStore.js'))
    expect(DEF.vibrateOnSilent).toBe(false)
  })
})
