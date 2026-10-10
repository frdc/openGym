import { describe, it, expect } from 'vitest'
import { projectWearState, validateWearCommand } from './wear-protocol.js'
import { makeSideSet } from './workout-model.js'

const input = () => ({ ready: true, contextToken: 'context', revision: 2, S: { unit: 'lb', active: { cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ r: 10, w: 60, done: false }] }] } } })
const command = (state, action = 'complete') => ({ v: 1, requestId: 'request', contextToken: state.contextToken, revision: state.revision, action, target: action === 'complete' ? { entryIdx: state.current.entryIdx, setIdx: state.current.setIdx, side: state.current.side } : { timerToken: state.timer.timerToken } })
describe('Wear protocol', () => {
  it('projects editable numeric values and rejects invalid edits', () => {
    const state = projectWearState({ ...input(), editingReady: true })
    expect(state.current).toMatchObject({ repsValue: 10, loadValue: 60, loadUnit: 'lb', repsStep: 1, canEdit: true })
    expect(state.current.loadStep).toBeGreaterThan(0)
    const edit = { ...command(state), action: 'edit-set', field: 'w', value: 0, unit: 'lb' }
    expect(validateWearCommand(edit, state)).toBeNull()
    for (const patch of [{ unit: 'kg' }, { value: -1 }, { value: Infinity }, { value: 10001 }, { field: 'r', value: 1.5 }, { field: 'sec' }]) expect(validateWearCommand({ ...edit, ...patch }, state)).not.toBeNull()
    expect(projectWearState(input()).current.canEdit).toBe(false)
  })
  it('is inactive without a ready owner or workout', () => {
    expect(projectWearState({ ...input(), ready: false }).active).toBe(false)
    expect(projectWearState({ ...input(), S: {} }).current).toBeNull()
  })
  it('projects planned values and never transports identity or history', () => {
    const state = projectWearState(input())
    expect(state.current.loadLabel).toContain('lb')
    expect(state.current.repsLabel).toContain('10')
    expect(state.current.canComplete).toBe(true)
    expect(Object.keys(state)).not.toContain('S')
    expect(validateWearCommand(command(state), state)).toBeNull()
  })
  it('rejects old contexts, revisions, targets and malformed commands', () => {
    const state = projectWearState(input()), c = command(state)
    for (const bad of [null, {}, { ...c, action: 'delete' }, { ...c, contextToken: 'old' }, { ...c, revision: 1 }, { ...c, target: { entryIdx: 1, setIdx: 0 } }, { ...c, requestId: '' }]) expect(validateWearCommand(bad, state)).not.toBeNull()
  })
  it('does not tick a timed or complex series with one tap', () => {
    const timed = input(); timed.S.active.entries[0].target.mode = 'time'
    expect(projectWearState(timed).current.canComplete).toBe(false)
    const complex = input(); complex.S.active.entries[0].sets[0].drops = [{ r: 5, w: 30 }]
    expect(projectWearState(complex).current.canComplete).toBe(false)
  })
  it('honours row mode and special type even when their arrays are empty', () => {
    const data = input(); data.S.active.entries[0].sets[0].mode = 'time'
    expect(projectWearState(data).current.canComplete).toBe(false)
    delete data.S.active.entries[0].sets[0].mode; data.S.active.entries[0].sets[0].type = 'dropset'
    expect(projectWearState(data).current.canComplete).toBe(false)
  })
  it('uses the next superset member and each unfinished side', () => {
    const data = input(), entry = data.S.active.entries[0]
    entry.sg = 'g'; entry.sets[0].done = true
    data.S.active.entries.push({ ...entry, id: '0026', sets: [makeSideSet({ r: 8, w: 20 })] })
    const state = projectWearState(data)
    expect(state.current.entryIdx).toBe(1)
    expect(state.current.side).toBe('L')
    data.S.active.entries[1].sets[0].sides.L.done = true
    expect(projectWearState(data).current.side).toBe('R')
    data.S.active.entries[1].sets[0].sides.R.mode = 'time'
    expect(projectWearState(data).current.canComplete).toBe(false)
  })
  it('rejects an expired timer token and projects paused duration', () => {
    const state = projectWearState({ ...input(), now: 1000, timer: { timerToken: 't', endsAt: 9000, total: 8, left: 4, paused: true } })
    expect(state.timer.leftMs).toBe(4000)
    expect(validateWearCommand({ ...command(state, 'skip'), target: { timerToken: 'old' } }, state)).not.toBeNull()
  })
})
