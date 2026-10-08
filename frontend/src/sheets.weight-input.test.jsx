// @vitest-environment happy-dom

const uiRuntime = vi.hoisted(() => ({ fixture: null }))
vi.mock('./store/useStore.js', async original => {
  const actual = (await original())
  const { createUIStoreFixture } = (await import('./store/ui-test-runtime.js'))
  uiRuntime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: uiRuntime.fixture.useStore }
})
afterEach(async () => { await uiRuntime.fixture.close(); })
beforeEach(() => uiRuntime.fixture.begin())
afterEach(async () => { await uiRuntime.fixture.flush(); })
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet, goalSheet } from './sheets.jsx'

// The big weight read-out (body weight, goal, top weight after an exercise) used to be text:
// the only ways to a number were the slider, ±0.1 and the ±0.5/±1 chips, so 72.3 → 85.7 was a
// drag you then corrected tap by tap. It is a field now. These pin the two things that make
// typing into it usable — a half-typed value is not clamped back at you, and the controls
// around it carry on from what you typed — plus the ceiling: the slider stops at 300 kg, a
// typed weight does not.
const mounted = []

function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderBw() {
  bwSheet()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
  const input = host.querySelector('.bw-read input')
  const slider = host.querySelector('.sld')
  const button = label => [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === label)
  return { host, input, slider, button }
}

describe('weight read-out is a typable field', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    await uiRuntime.fixture.applySnapshot(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], targetW: null } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('shows the current weight in a decimal field with the unit beside it', async () => {
    const { input, host } = (await renderBw())
    expect(input).toBeTruthy()
    expect(input.value).toBe('70')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.getAttribute('aria-label')).toBe('Weight (kg)')
    expect(host.querySelector('.bw-read .u').textContent.trim()).toBe('kg')
  })

  it('keeps a half-typed value on screen instead of clamping it, and moves the slider with it', async () => {
    const { input, slider } = (await renderBw())
    await act(async () => { await type(input, ''); await uiRuntime.fixture.flush(); })
    expect(input.value).toBe('')

    await act(async () => { await type(input, '8'); await uiRuntime.fixture.flush(); })
    expect(input.value).toBe('8')

    await act(async () => { await type(input, '82,5'); await uiRuntime.fixture.flush(); })
    expect(input.value).toBe('82.5')
    expect(slider.getAttribute('aria-valuenow')).toBe('82.5')
  })

  it('steps on from the typed value and saves what ends up on screen', async () => {
    const { input, button } = (await renderBw())
    await act(async () => { await type(input, '82.5'); await uiRuntime.fixture.flush(); })
    await act(async () => { await button('Increase by 0.1').click(); await uiRuntime.fixture.flush(); })
    expect(input.value).toBe('82.6')

    await act(async () => { await button('Save').click(); await uiRuntime.fixture.flush(); })
    const bw = useStore.getState().S.bodyweight
    expect(bw).toHaveLength(1)
    expect(bw[0].w).toBe(82.6)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('lets a typed weight sit past the slider ceiling rather than cutting it off', async () => {
    const { input, slider, button } = (await renderBw())
    await act(async () => { await type(input, '320'); await uiRuntime.fixture.flush(); })
    expect(input.value).toBe('320')
    expect(slider.getAttribute('aria-valuenow')).toBe('300')

    await act(async () => { await button('Save').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.bodyweight[0].w).toBe(320)
  })

  // 9999 typed into the field saved, and the chart and goal lines read like it was real.
  it('refuses a typed weight no person has, says the limit, and keeps the sheet open', async () => {
    const toast = vi.fn()
    useUI.setState({ toast })
    const { input, button } = (await renderBw())
    await act(async () => { await type(input, '9999'); await uiRuntime.fixture.flush(); })
    await act(async () => { await button('Save').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.bodyweight).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(toast).toHaveBeenCalledWith('That looks too heavy. Keep it at 700 kg or less.')
  })

  it('the goal sheet refuses the same', async () => {
    const toast = vi.fn()
    useUI.setState({ toast })
    goalSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    await act(async () => { await root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))); await uiRuntime.fixture.flush(); })
    await act(async () => { await type(host.querySelector('.bw-read input'), '9999'); await uiRuntime.fixture.flush(); })
    await act(async () => { await [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save goal').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.targetW ?? null).toBe(null)
    expect(toast).toHaveBeenCalledWith('That looks too heavy. Keep it at 700 kg or less.')
  })

  it('still refuses to save an empty field', async () => {
    const { input, button } = (await renderBw())
    await act(async () => { await type(input, ''); await uiRuntime.fixture.flush(); })
    await act(async () => { await button('Save').click(); await uiRuntime.fixture.flush(); })
    expect(useStore.getState().S.bodyweight).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})
