// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { stepWeight } from './lib/progression.js'

// A weighted machine exercise: double progression adds the two rep steppers and the
// Epley deload stepper, four in one row (QA C6).
const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function renderConfig(cfg) {
  const onSave = vi.fn()
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', ...cfg }, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const row = [...host.querySelectorAll('.cfgrow')].find(r => r.querySelector('.stp-l')?.textContent.startsWith('Step'))
  return { host, row, onSave }
}

describe('exercise configuration progression row', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('marks the four-stepper double-progression row so it can wrap into pairs on phones', () => {
    const { row } = renderConfig({ prog: 'double' })
    expect(row.querySelectorAll('.stp-w')).toHaveLength(4)
    expect(row.classList.contains('cfgrow-4')).toBe(true)
  })

  it('leaves the shorter rows alone', () => {
    // linear on a weighted exercise: Step + Deload, two steppers
    const linear = renderConfig({ prog: 'linear' })
    expect(linear.row.querySelectorAll('.stp-w')).toHaveLength(2)
    expect(linear.row.classList.contains('cfgrow-4')).toBe(false)
    // double on a body-weight exercise: no Epley deload, three steppers
    const bw = renderConfig({ prog: 'double', weight: 0, bodyweight: true })
    expect(bw.row.querySelectorAll('.stp-w')).toHaveLength(3)
    expect(bw.row.classList.contains('cfgrow-4')).toBe(false)
  })

  it('allows configuring the machine increment without automatic progression', () => {
    const { host, row, onSave } = renderConfig({ prog: 'off', weight: 11.8, inc: 6.8 })
    expect(row).toBeDefined()
    expect(row.querySelector('input.num').value).toBe('6.8')
    expect(row.querySelectorAll('.stp-w')).toHaveLength(1)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
    expect(onSave.mock.calls[0][0]).toMatchObject({ weight: 11.8, inc: 6.8, prog: 'off' })
    expect(stepWeight(11.8, onSave.mock.calls[0][0].inc, 1)).toBe(18.6)
    expect(stepWeight(18.6, onSave.mock.calls[0][0].inc, 1)).toBe(25.4)
  })
})
