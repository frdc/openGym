import { describe, it, expect } from 'vitest'
import { normalizeWeightProfile, weightProfileGrid, stepProfileWeight, withWeightProfile, applyEntryWeightProfile } from './weight-profiles.js'
import { weightIncrement, selectDeloadCandidate } from './progression.js'
import { projectWearState } from './wear-protocol.js'
import { buildPlannedEntry } from './session-start.js'

const movement = { id: 'movement', name: 'Movement', unit: 'kg', start: 11.8, step: 6.8 }
describe('saved weight profiles', () => {
  it('validates finite nonnegative starts, positive steps, names and units', () => {
    expect(normalizeWeightProfile(movement)).toEqual(movement)
    for (const patch of [{ step: 0 }, { step: Infinity }, { start: -1 }, { name: '' }, { unit: 'stone' }, { start: '' }, { step: null }]) {
      expect(normalizeWeightProfile({ ...movement, ...patch })).toBeNull()
    }
  })
  it('uses the stack origin, including an empty value and off-grid manual loads', () => {
    const cfg = withWeightProfile({}, movement, 'kg')
    expect(stepProfileWeight(0, cfg, 'kg', 1)).toBe(11.8)
    expect(stepProfileWeight(11.8, cfg, 'kg', 1)).toBe(18.6)
    expect(stepProfileWeight(18.6, cfg, 'kg', 1)).toBe(25.4)
    expect(stepProfileWeight(25.4, cfg, 'kg', -1)).toBe(18.6)
    expect(stepProfileWeight(11.8, cfg, 'kg', -1)).toBe(0)
    expect(stepProfileWeight(27, cfg, 'kg', 1)).toBe(32.2)
    expect(stepProfileWeight(27, cfg, 'kg', -1)).toBe(25.4)
  })
  it('keeps the original unit and avoids accumulating conversion error', () => {
    const cfg = withWeightProfile({}, movement, 'lb')
    expect(cfg.weightProfile).toEqual(movement)
    expect(weightProfileGrid(cfg, 'kg')).toEqual({ start: 11.8, step: 6.8 })
    expect(weightProfileGrid(cfg, 'lb').step).toBeCloseTo(14.99, 2)
    expect(weightIncrement(cfg, 'kg')).toBe(6.8)
  })
  it('freezes selection, supports removal, and keeps completed and nonempty set weights', () => {
    const entry = { target: { inc: 2.5 }, planned: { inc: 2.5 }, sets: [{ w: 40, done: true }, { w: 32.2, done: false }, { w: 0, done: false }] }
    const selected = applyEntryWeightProfile(entry, movement, 'kg')
    expect(selected.sets).toEqual([{ w: 40, done: true }, { w: 32.2, done: false }, { w: 11.8, done: false }])
    expect(selected.target).toMatchObject({ inc: 2.5, weightProfile: movement })
    expect(selected.planned.weightProfile).toEqual(movement)
    expect(entry.target.inc).toBe(2.5)
    movement.name = 'Changed'; expect(selected.target.weightProfile.name).toBe('Movement'); movement.name = 'Movement'
    expect(withWeightProfile(selected.target, null, 'kg').weightProfile).toBeUndefined()
    expect(withWeightProfile(selected.target, null, 'kg').inc).toBe(2.5)
  })
  it('publishes the machine grid to the watch', () => {
    const entry = applyEntryWeightProfile({ id: '0025', target: { mode: 'reps' }, sets: [{ w: 11.8, r: 10, done: false }] }, movement, 'kg')
    const state = projectWearState({ S: { unit: 'kg', active: { cur: 0, entries: [entry] } }, ready: true, contextToken: 'context' })
    expect(state.current).toMatchObject({ loadStep: 6.8, loadStart: 11.8 })
  })
  it('deloads onto actual stack values instead of multiples from zero', () => {
    const result = selectDeloadCandidate({ currentWeight: 52.6, targetWeight: 52.6, targetReps: 10, step: 6.8, start: 11.8 })
    expect(result.weight).toBe(45.8)
  })
  it('seeds planned warmups using available machine weights', () => {
    const cfg = withWeightProfile({ id: '0025', mode: 'reps', sets: 3, reps: 10, weight: 52.6, warmupSets: 1, prog: 'off' }, movement, 'kg')
    const entry = buildPlannedEntry({ unit: 'kg', workouts: [] }, cfg)
    expect(entry.sets[0].w).toBe(25.4)
    expect(entry.sets[1].w).toBe(52.6)
  })
})
