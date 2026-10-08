// @vitest-environment happy-dom
// The tab bar is fixed on screen and re-renders on every store write — once a second for the
// whole of a rest. Its buttons must survive that: a component declared inside the render body is
// a new function each time, which React reads as a different type and rebuilds from scratch.

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
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/home' }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, originalUser

beforeEach(async () => {
  const store = useStore.getState()
  originalS = store.S
  originalUser = store.user
  await uiRuntime.fixture.applySnapshot({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()

})

const tabs = () => [...host.querySelectorAll('#tabbar button')]

describe('the tab bar across a store write', () => {
  it('keeps the very same buttons instead of rebuilding them every tick', async () => {
    await act(async () => { root.render(<TabBar onStart={() => {}} />); await uiRuntime.fixture.flush(); })
    const before = tabs()
    expect(before).toHaveLength(5)

    // What a rest does once a second: S is replaced, so everything reading it re-renders.
    await act(async () => { useStore.getState().update(s => { s.restSec = 91 }, false); await uiRuntime.fixture.flush(); })

    const after = tabs()
    expect(after).toHaveLength(before.length)
    after.forEach((el, i) => expect(el).toBe(before[i]))
  })

  it('still lights the tab for the route it is on, and follows a change of state', async () => {
    await act(async () => { root.render(<TabBar onStart={() => {}} />); await uiRuntime.fixture.flush(); })
    expect(tabs()[0].className).toBe('on')
    expect(tabs()[1].className).toBe('')
    expect(tabs()[2].className).toBe('start')

    await act(async () => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false); await uiRuntime.fixture.flush(); })
    expect(tabs()[2].className).toBe('start rec')
    expect(tabs()[0].className).toBe('on')
  })
})

// Settings → "Show connection status" off (#369, #330): a stuck sync shows as a dot on Home, the
// tab Settings opens from, and the tab's name says it.
describe('the connection dot on Home', () => {
  const home = () => tabs()[0]
  it('is there for a sync problem only while the banner is switched off', async () => {
    const original = useStore.getState().sync
    try {
      useStore.setState({ sync: { local: 'error', cloud: 'blocked' } })
      await act(async () => { root.render(<TabBar onStart={() => {}} />); await uiRuntime.fixture.flush(); })
      expect(home().querySelector('.tab-dot')).toBeNull()
      await act(async () => { useStore.getState().update(s => { s.connStatus = false }, false); await uiRuntime.fixture.flush(); })
      useStore.setState({ sync: { local: 'error', cloud: 'blocked' } })
      await act(async () => {})
      expect(home().querySelector('.tab-dot')).not.toBeNull()
      expect(home().getAttribute('aria-label')).toBe('Home, Connection problem')
      await act(async () => { useStore.setState({ sync: { local: 'saved', cloud: 'unconfigured' } }); await uiRuntime.fixture.flush(); })
      expect(home().querySelector('.tab-dot')).toBeNull()
      expect(home().getAttribute('aria-label')).toBeNull()
    } finally { await uiRuntime.fixture.applySnapshot({ sync: original }); }
  })
})

// v1.3.11 icon sweep: one icon per concept. Every tab carries its name under the icon, Start is a
// play button whether or not a session runs, and Exercises is the dumbbell (no more generic list).
describe('the tab icons and labels', () => {
  const icon = el => el.querySelector('svg')?.getAttribute('data-icon')
  const label = el => el.querySelector('span:last-child').textContent
  it('labels every tab and uses one icon per concept', async () => {
    await act(async () => { root.render(<TabBar onStart={() => {}} />); await uiRuntime.fixture.flush(); })
    expect(tabs().map(icon)).toEqual(['house', 'calendar', 'play', 'chart', 'dumbbell'])
    expect(tabs().map(label)).toEqual(['Home', 'Plan', 'Start', 'Stats', 'Exercises'])

    await act(async () => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false); await uiRuntime.fixture.flush(); })
    expect(icon(tabs()[2])).toBe('play')
    expect(label(tabs()[2])).toBe('Resume')
  })

  it('shows a minimized session’s running time, still named Resume', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 5, 18, 0, 0))
      await act(async () => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0, start: Date.now() - 754_000 } }, false); await uiRuntime.fixture.flush(); })
      await act(async () => { root.render(<TabBar onStart={() => {}} />); await uiRuntime.fixture.flush(); })
      const start = tabs()[2]
      expect(label(start)).toBe('12:34')
      expect(start.getAttribute('aria-label')).toBe('Resume')
      await act(async () => { vi.advanceTimersByTime(2000); await uiRuntime.fixture.flush(); })
      expect(label(start)).toBe('12:36')
      expect(tabs()[2]).toBe(start)   // the same button, only its text ticks

      // a past workout being edited has no clock running
      await act(async () => { useStore.getState().update(s => { s.active.editingWorkoutId = 'w1' }, false); await uiRuntime.fixture.flush(); })
      expect(label(tabs()[2])).toBe('Edit workout')
    } finally { vi.useRealTimers() }
  })
})
