// @vitest-environment happy-dom

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = (await original())
  const { createUIStoreFixture } = (await import('../store/ui-test-runtime.js'))
  uiRuntime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: uiRuntime.fixture.useStore }
})
afterEach(async () => { await uiRuntime.fixture.close(); })
beforeEach(() => uiRuntime.fixture.begin())
afterEach(async () => { await uiRuntime.fixture.flush(); })
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutSettings } from './WorkoutSettingsSheet.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sound = vi.hoisted(() => ({ canVibrate: true, iPhone: false }))
vi.mock('../lib/sound.js', () => ({
  unlock: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(),
  vibrateSupported: () => sound.canVibrate, appleTouchDevice: () => sound.iPhone,
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => true }))
const navTo = vi.hoisted(() => vi.fn())
vi.mock('../lib/nav.js', async importOriginal => {
  const real = (await importOriginal())
  real.setNav(navTo)
  return real
})

let host, root, originalS, close

beforeEach(async () => {
  originalS = useStore.getState().S
  ;await uiRuntime.fixture.applySnapshot({ S: {
    ...originalS, restSec: 90, sound: false, vibrate: true, timerFlash: false, keepAwake: true,
    workoutView: 'cards', effort: 'none', gifSize: 'full',
    active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [], workoutView: 'list' },
  } });
  useUI.setState({ sheets: [] })
  sound.canVibrate = true; sound.iPhone = false
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { await root.render(<WorkoutSettings close={close} />); await uiRuntime.fixture.flush(); })
})

afterEach(async () => {
  await act(async () => { await root.render(null); await uiRuntime.fixture.flush(); })
  useUI.setState({ sheets: [] })

  host.remove()
  navTo.mockReset()
})

const row = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const S = () => useStore.getState().S

describe('the in-workout settings sheet', () => {
  it('has the rows people change at the gym, then All settings', () => {
    expect([...host.querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual([
      'Rest timer', 'Play a sound', 'Vibrate', 'Flash the screen', 'Keep screen awake',
      'Layout', 'Effort per set', 'Swipe actions', 'Exercise animations', 'All settings',
    ])
    expect(row('Rest timer').querySelector('.lrow-v').textContent).toBe('1:30')
    expect(row('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(row('Exercise animations').querySelector('.lrow-s')).toBeNull()
  })

  it('writes the same fields as Settings', async () => {
    await act(async () => { await row('Play a sound').querySelector('[role=switch]').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { await row('Vibrate').querySelector('[role=switch]').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { await row('Flash the screen').querySelector('[role=switch]').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { await row('Keep screen awake').querySelector('[role=switch]').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { await [...row('Effort per set').querySelectorAll('button')].find(b => b.textContent === 'RIR').click(); await uiRuntime.fixture.flush(); })
    await act(async () => { await [...row('Exercise animations').querySelectorAll('button')].find(b => b.textContent === 'Small').click(); await uiRuntime.fixture.flush(); })
    expect(S()).toMatchObject({ sound: true, vibrate: false, timerFlash: true, keepAwake: false, effort: 'rir', gifSize: 'mini' })
  })

  it('shows this session’s layout, and a pick here is saved and replaces it', async () => {
    expect(row('Layout').querySelector('button.on').textContent).toBe('List')
    await act(async () => { await [...row('Layout').querySelectorAll('button')].find(b => b.textContent === 'Compact').click(); await uiRuntime.fixture.flush(); })
    expect(S().workoutView).toBe('compact')
    expect(S().active.workoutView).toBeUndefined()
  })

  it('sets the rest timer on the wheel, 0:00 being off', async () => {
    await act(async () => { await row('Rest timer').click(); await uiRuntime.fixture.flush(); })
    const sheet = useUI.getState().sheets.at(-1)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const r = createRoot(el)
    await act(async () => { await r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
    expect(el.querySelector('h3').textContent).toBe('Rest timer')
    expect(el.querySelector('.dw-read').textContent).toBe('1:30')
    await act(async () => { await [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').click(); await uiRuntime.fixture.flush(); })
    expect(S().restSec).toBe(90)
    act(() => r.unmount()); el.remove()
  })

  it('greys Vibrate out on an iPhone and says why', async () => {
    sound.canVibrate = false; sound.iPhone = true
    await act(async () => { await root.render(<WorkoutSettings close={close} key="iphone" />); await uiRuntime.fixture.flush(); })
    expect(row('Vibrate').classList.contains('dis')).toBe(true)
    expect(row('Vibrate').querySelector('.lrow-s').textContent).toBe('Not on iPhone')
    expect(row('Vibrate').querySelector('[role=switch]').disabled).toBe(true)
  })

  it('goes to Settings → Workout from All settings, closing the sheet', async () => {
    await act(async () => { await row('All settings').click(); await uiRuntime.fixture.flush(); })
    expect(close).toHaveBeenCalled()
    expect(navTo).toHaveBeenCalledWith('/settings/workout')
  })

  // The sheet's own history entry used to stay behind: back from Settings went to the workout, and
  // the next back landed on the same workout again and seemed to do nothing.
  it('Settings takes the sheet\'s history entry instead of leaving it behind', async () => {
    history.pushState({ openGymSheet: true }, '')
    await act(async () => { await row('All settings').click(); await uiRuntime.fixture.flush(); })
    expect(navTo).toHaveBeenCalledWith('/settings/workout', { replace: true })
    history.replaceState(null, '')
  })
})
