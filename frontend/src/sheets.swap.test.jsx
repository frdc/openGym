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
import { LANGS, DERIVED_LOCALES } from './lib/i18n-core.js'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi , afterEach } from 'vitest'
import { swapActiveWorkoutExercise } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const clone = value => JSON.parse(JSON.stringify(value))
const ids = EXDB.slice(0, 3).map(exercise => exercise.id)

function entry(id, done = false) {
  return {
    id,
    target: { mode: 'reps', sets: 1, reps: 5, weight: 40 },
    sets: [{ w: 40, r: 5, done }]
  }
}

async function installActive() {
  const S = clone(DEF)
  S.active = {
    id: 'swap-test', d: '2026-08-27', start: Date.now(), routineId: null,
    name: 'Swap test', bw: null, cur: 1,
    entries: [entry(ids[0]), entry(ids[0]), entry(ids[1])]
  }
  await uiRuntime.fixture.applySnapshot({ S, user: null })
}

async function submitSwap(index, exercise, config) {
  swapActiveWorkoutExercise(index)
  const picker = useUI.getState().sheets.at(-1)
  const pickerView = picker.render(picker.close)
  await act(async () => { await pickerView.props.onPick(exercise); await uiRuntime.fixture.flush(); })
  const configSheet = useUI.getState().sheets.at(-1)
  const configView = configSheet.render(configSheet.close)
  await act(async () => { await configView.props.onSave(config); await uiRuntime.fixture.flush(); })
}

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
  await installActive()
})

describe('active exercise swap sheet flow', () => {
  it('invalidates a timed callback and replaces only the selected duplicate', async () => {
    const callback = vi.fn()
    useUI.getState().startWork(5, 'Hold', callback)

    await submitSwap(1, EXDB[2], { mode: 'reps', sets: 2, reps: 8, weight: 30, note: 'New target' })
    vi.advanceTimersByTime(10_000)

    const active = useStore.getState().S.active
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
    expect(active.entries.map(value => value.id)).toEqual([ids[0], ids[2], ids[1]])
    expect(active.entries[1].target).toMatchObject({ mode: 'reps', sets: 2, reps: 8, weight: 30, note: 'New target' })
    expect(active.entries[0].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.entries[2].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.cur).toBe(1)
  })
})

// A slot of a routine kept out of progression (rehab, deload) stays out when it is swapped,
// whether the replacement takes its place or, beside logged sets, goes in after it.
describe('swapping an exercise kept out of progression', () => {
  const install = async done => {
    const S = clone(DEF)
    S.routines = [{ id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [] }]
    S.active = {
      id: 'swap-noprog', d: '2026-08-27', start: Date.now(), routineIds: ['rehab'], name: 'Rehab', bw: null, cur: 0,
      entries: [{ ...entry(ids[0], done), rid: 'rehab', noProg: true }],
    }
    await uiRuntime.fixture.applySnapshot({ S, user: null })
  }

  it('keeps it out when the replacement takes the slot', async () => {
    await install(false)
    await submitSwap(0, EXDB[2], { mode: 'reps', sets: 1, reps: 12, weight: 10 })
    const [swapped] = useStore.getState().S.active.entries
    expect(swapped).toMatchObject({ id: ids[2], rid: 'rehab', noProg: true })
    expect(swapped.plan.kind).toBe('off')
  })

  it('keeps it out when the replacement goes in after logged sets', async () => {
    await install(true)
    await submitSwap(0, EXDB[2], { mode: 'reps', sets: 1, reps: 12, weight: 10 })
    const confirm = useUI.getState().sheets.at(-1)
    await act(async () => { await confirm.render(confirm.close).props.onConfirm(); await uiRuntime.fixture.flush(); })
    const entries = useStore.getState().S.active.entries
    expect(entries.map(e => e.id)).toEqual([ids[0], ids[2]])
    expect(entries[1]).toMatchObject({ rid: 'rehab', noProg: true })
    expect(entries[1].plan.kind).toBe('off')
  })
})

describe('active exercise swap locale coverage', () => {
  const required = [
    'Swap exercise',
    'Swap exercise?',
    'Logged sets stay with the original exercise. Choose where the replacement belongs.',
    'Keep replacement in this group',
    'Insert after this group',
    'Logged sets stay with the original exercise. The replacement will be inserted afterward.'
  ]
  const packs = import.meta.glob('./locales/*.js', { eager: true, import: 'default' })

  it('defines every new prompt in all twelve locale packs', () => {
    // Minus English (the source language) and minus any derived locale, which transforms its
    // base language's pack at load time instead of shipping one.
    const packed = Object.keys(LANGS).filter(code => code !== 'en' && !DERIVED_LOCALES[code])
    expect(Object.keys(packs)).toHaveLength(packed.length)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty(key))
    })
  })
})

// QA 1.3.9: the swap borrowed the routine editor's words — "Add exercise" over the picker and
// "Add to routine" on the confirm — while it changes only today's session.
describe('swap wording', () => {
  it('titles the picker as a swap and confirms into this workout', async () => {
    swapActiveWorkoutExercise(1)
    const picker = useUI.getState().sheets.at(-1)
    const pickerView = picker.render(picker.close)
    expect(pickerView.props.title).toBe('Swap exercise')
    await act(async () => { await pickerView.props.onPick(EXDB[2]); await uiRuntime.fixture.flush(); })
    const configSheet = useUI.getState().sheets.at(-1)
    const configView = configSheet.render(configSheet.close)
    expect(configView.props.saveLabel).toBe('Use in this workout')
  })
})
