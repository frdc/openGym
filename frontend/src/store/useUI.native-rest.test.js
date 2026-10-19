// @vitest-environment happy-dom
// The Android rest notification (#296) and the bar in the app are one rest. The locked-phone bug
// it fixes: the WebView countdown never reaches zero, so the only alert that can fire is the one
// armed when the rest starts — the end must not cancel it, Skip and Dismiss must. And whatever
// moves the rest on one side (a pause, a resume, ±15 s) must leave the other in the same place.
// The native side is mocked at lib/rest-alert.js; MOBILE is on, so useUI takes the app's path.

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

const h = vi.hoisted(() => ({ native: null }))
vi.mock('../lib/mobile.js', async importOriginal => ({ ...((await importOriginal())), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(cb => { h.native = cb }),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
let api
beforeEach(() => { api = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected timer transport')) })
afterEach(() => { api.mockRestore() })
import { armRestAlert, disarmRestAlert, holdRestAlert } from '../lib/rest-alert.js'
import { beep, chime } from '../lib/sound.js'

const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}
const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer').map(([, o]) => JSON.parse(o.body).seconds)
// What the notification's buttons send (RestTimerService.emit).
const fromNotification = (type, leftSec, totalSec, paused = false) =>
  h.native({ timerToken: useUI.getState().timer?.timerToken, type, leftMs: leftSec * 1000, totalMs: totalSec * 1000, endsAt: paused ? 0 : Date.now() + leftSec * 1000, paused })

let originalSettings
beforeEach(async () => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  await uiRuntime.fixture.applySnapshot({ S: { ...originalSettings, sound: true, timerFlash: false }, user: null })
  useUI.setState({ timer: null, timerFlashId: 0 })
  for (const f of [armRestAlert, holdRestAlert, disarmRestAlert, beep, chime, api]) f.mockClear()
  hide(false)
})
afterEach(() => {
  useUI.getState().stopRest()

  hide(false)
  vi.useRealTimers()
})

describe('the rest the app starts, pauses and ends', () => {
  it('clears rest for a first watch start with no completed set owner', () => {
    useUI.getState().startRest(90)
    useUI.getState().importWearRest(null, null)
    expect(useUI.getState().timer).toBeNull()
  })

  it('imports watch rest using its absolute deadline instead of restarting the break', () => {
    const endsAt = Date.now() + 45000
    useUI.getState().importWearRest({ timerToken: 'watch-rest', endsAt, leftMs: 90000, paused: false, ready: false }, { entryIdx: 2, setIdx: 1 })
    expect(useUI.getState().timer).toMatchObject({ timerToken: 'watch-rest', endsAt, left: 45, forIdx: 2, forSet: 1 })
    expect(armRestAlert).toHaveBeenLastCalledWith(endsAt, expect.objectContaining({ timerToken: 'watch-rest' }))
    vi.advanceTimersByTime(15000)
    expect(useUI.getState().timer.left).toBe(30)
  })

  it('restores a paused watch rest without allowing its time to elapse', () => {
    useUI.getState().importWearRest({ timerToken: 'watch-paused', endsAt: 0, leftMs: 32500, paused: true, ready: false })
    expect(useUI.getState().timer).toMatchObject({ paused: true, left: 32.5 })
    vi.advanceTimersByTime(60000)
    expect(useUI.getState().timer.left).toBe(32.5)
    useUI.getState().resumeRest()
    expect(useUI.getState().timer.endsAt).toBe(Date.now() + 32500)
  })

  it('does not alert or reopen rest that expired while the phone was off', () => {
    useUI.getState().startRest(90)
    chime.mockClear(); armRestAlert.mockClear()
    useUI.getState().importWearRest({ timerToken: 'old-watch-rest', endsAt: Date.now() - 10000, leftMs: 90000, paused: false, ready: false })
    expect(useUI.getState().timer).toBeNull()
    expect(chime).not.toHaveBeenCalled()
    expect(armRestAlert).not.toHaveBeenCalled()
  })

  it('arms when the rest starts and rearms when time is added, with the whole rest', () => {
    useUI.getState().startRest(90)
    const first = armRestAlert.mock.calls.at(-1)[0]
    useUI.getState().addRest(15)
    const second = armRestAlert.mock.calls.at(-1)[0]
    expect(second - first).toBe(15_000)
    expect(armRestAlert).toHaveBeenLastCalledWith(second, expect.objectContaining({ totalSec: 105, sound: true }))
  })

  it('holds the notification when paused in the app and books the new end on resume', () => {
    useUI.getState().startRest(90)
    vi.advanceTimersByTime(30_000)
    const disarms = disarmRestAlert.mock.calls.length
    useUI.getState().pauseRest()
    expect(holdRestAlert).toHaveBeenLastCalledWith(60, 90, expect.any(String))
    expect(disarmRestAlert.mock.calls.length).toBe(disarms)   // the notification stays, paused

    useUI.getState().addRest(15)   // time added while paused: held again at the new figure
    expect(holdRestAlert).toHaveBeenLastCalledWith(75, 105, expect.any(String))

    vi.advanceTimersByTime(5 * 60_000)
    const arms = armRestAlert.mock.calls.length
    useUI.getState().resumeRest()
    expect(armRestAlert.mock.calls.length).toBe(arms + 1)
    expect(armRestAlert).toHaveBeenLastCalledWith(Date.now() + 75_000, expect.objectContaining({ totalSec: 105 }))
  })

  it('keeps the alarm when the countdown ends, including while the app is hidden', () => {
    useUI.getState().startRest(90)
    const armed = disarmRestAlert.mock.calls.length
    hide(true)
    vi.setSystemTime(Date.now() + 91_000)
    hide(false)   // reopening catches up; the alarm armed at the start must still be pending
    expect(disarmRestAlert.mock.calls.length).toBe(armed)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
    expect(chime).not.toHaveBeenCalled()
  })

  it('still chimes in the app when the rest finishes on screen, and keeps the alarm', async () => {
    await uiRuntime.fixture.applySnapshot({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(1)
    const armed = disarmRestAlert.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(chime).toHaveBeenCalledTimes(1)
    expect(useUI.getState().timerFlashId).toBe(1)
    expect(disarmRestAlert.mock.calls.length).toBe(armed)
  })

  it('takes the notification down on Skip, and on Dismiss once it is Ready', () => {
    useUI.getState().startRest(90)
    const armed = disarmRestAlert.mock.calls.length
    useUI.getState().stopRest()
    expect(disarmRestAlert.mock.calls.length).toBe(armed + 1)

    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer.ready).toBe(true)
    const ready = disarmRestAlert.mock.calls.length
    useUI.getState().stopRest()
    expect(disarmRestAlert.mock.calls.length).toBe(ready + 1)
  })

  it('plays the last-seconds ticks', () => {
    useUI.getState().startRest(5)
    vi.advanceTimersByTime(3000)
    expect(beep).toHaveBeenCalled()
  })

  it('still schedules an alert when sound is off', async () => {
    await uiRuntime.fixture.applySnapshot({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(90)
    expect(armRestAlert).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ sound: false }))
  })

  // Settings → Vibrate off buzzed at the end of every rest the phone was locked for: the page's own
  // buzz was off, but the alarm it armed was never told (Android QA, v1.3.9).
  it('tells the alarm whether the end may buzz', async () => {
    useUI.getState().startRest(90)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: true }))
    useUI.getState().stopRest()
    await uiRuntime.fixture.applySnapshot({ S: { ...useStore.getState().S, vibrate: false } })
    useUI.getState().startRest(90)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: false }))
  })
})

describe('the server push in the Android app', () => {
  it('is not booked while the alarm is', async () => {
    useStore.setState({ user: { id: 'u1' } })
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)
    expect(pushes()).toEqual([])
  })

  it('stands in when the alarm could not be scheduled, for that rest only', async () => {
    useStore.setState({ user: { id: 'u1' } })
    armRestAlert.mockResolvedValueOnce(false)
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)
    expect(pushes()).toEqual([])

    api.mockClear()
    armRestAlert.mockResolvedValueOnce(false)
    useUI.getState().startRest(60)
    useUI.getState().stopRest()   // skipped before the schedule came back
    await vi.advanceTimersByTimeAsync(0)
    expect(pushes()).toEqual([])
  })
})

describe('the notification’s own buttons', () => {
  it('Pause holds the bar in the app, and Resume runs it out from the notification’s end', () => {
    useUI.getState().startRest(90, 2)
    vi.advanceTimersByTime(10_000)
    fromNotification('pause', 80, 90, true)
    expect(useUI.getState().timer).toMatchObject({ left: 80, total: 90, paused: true, forIdx: 2 })

    vi.advanceTimersByTime(5 * 60_000)   // held: nothing counts, nothing ends
    expect(useUI.getState().timer).toMatchObject({ left: 80, paused: true })
    expect(chime).not.toHaveBeenCalled()

    fromNotification('pause', 80, 90)
    expect(useUI.getState().timer.paused).toBeUndefined()
    vi.advanceTimersByTime(79_000)
    expect(useUI.getState().timer).toMatchObject({ left: 1 })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true, forIdx: 2 })
    // The app made none of these changes, so it sends none of them back.
    expect(holdRestAlert).not.toHaveBeenCalled()
    expect(armRestAlert).toHaveBeenCalledTimes(1)
  })

  it('±15 s moves the end the app counts to', () => {
    useUI.getState().startRest(60)
    vi.advanceTimersByTime(20_000)
    fromNotification('adjust', 55, 75)
    expect(useUI.getState().timer).toMatchObject({ left: 55, total: 75 })
    vi.advanceTimersByTime(54_000)
    expect(useUI.getState().timer).toMatchObject({ left: 1 })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer.ready).toBe(true)
  })

  it('+15 s on a rest the app already called Ready opens it again', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1500)
    expect(useUI.getState().timer.ready).toBe(true)
    fromNotification('adjust', 15, 16)
    expect(useUI.getState().timer).toMatchObject({ left: 15, total: 16 })
    expect(useUI.getState().timer.ready).toBeUndefined()
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().timer.left).toBe(13)
  })

  it('a pause in the last half second still holds a second, so the bar does not end under it', () => {
    useUI.getState().startRest(10)
    vi.advanceTimersByTime(9_600)
    h.native({ timerToken: useUI.getState().timer?.timerToken, type: 'pause', leftMs: 400, totalMs: 10_000, endsAt: 0, paused: true })
    vi.advanceTimersByTime(5_000)
    expect(useUI.getState().timer).toMatchObject({ left: 1, paused: true })
  })

  it('Skip ends the rest in the app', () => {
    useUI.getState().startRest(90)
    h.native({ timerToken: useUI.getState().timer?.timerToken, type: 'skip' })
    expect(useUI.getState().timer).toBe(null)
  })
})
