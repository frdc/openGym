import { describe, it, expect } from 'vitest'
import { DEF } from '../store/state-defaults.js'
import { encodeState, decodeState, prepareOperation, mergeOperation } from './cloud/codec.js'
import { makeOwner } from './cloud/model.js'
import { mergeStates, stampChange, localExtras } from './sync-merge.js'
import { convertStateUnit } from './units.js'
import { withWeightProfile, stepProfileWeight } from './weight-profiles.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'

const profile = (id, step = 5.3, _ts = 10) => ({ id, name: id, unit: 'kg', start: 0, step, _ts })
const options = { ownerKey: makeOwner('demo-opengym', 'test-user').ownerKey, generation: 1, unitVersion: 1 }
const encode = S => encodeState(S, options).documents
const state = weightProfiles => ({ ...structuredClone(DEF), weightProfiles })
describe('weight profile persistence', () => {
  it('includes saved profiles in the signed-out setup summary, excluding deleted profiles', () => {
    expect(localExtras(state({ a: profile('a'), gone: { deleted: true, _ts: 20 } }), state({}))).toMatchObject({ setup: 1 })
  })
  it('preserves stack positions through a unit switch and a round trip', () => {
    const machine = { id: 'movement', name: 'Movement', unit: 'kg', start: 11.8, step: 6.8 }
    const target = withWeightProfile({ mode: 'reps', weight: 11.8 }, machine, 'kg')
    const S = { ...state({}), active: { entries: [{ id: '0025', target, sets: [{ w: 11.8, r: 10, done: false }] }] } }
    const lb = convertStateUnit(S, 'lb')
    expect(lb.active.entries[0].sets[0].w).toBe(26.01)
    expect(stepProfileWeight(lb.active.entries[0].sets[0].w, target, 'lb', 1)).toBe(41)
    const kg = convertStateUnit(lb, 'kg')
    expect(kg.active.entries[0].sets[0].w).toBe(11.8)
    expect(stepProfileWeight(kg.active.entries[0].sets[0].w, target, 'kg', 1)).toBe(18.6)
  })
  it('shares the selected snapshot and converts the initial stack position on import', () => {
    const machine = { id: 'movement', name: 'Movement', unit: 'kg', start: 11.8, step: 6.8 }
    const cfg = withWeightProfile({ id: '0025', mode: 'reps', sets: 3, reps: 10, weight: 11.8, inc: 2.5 }, machine, 'kg')
    const S = { ...state({}), routines: [{ id: 'r', name: 'Machine', ex: [cfg] }] }
    const plan = buildPlanBundle(S, 'Machine')
    expect(plan.routines[0].ex[0].weightProfile).toEqual(machine)
    const imported = parsePlan(JSON.stringify(plan), 'lb').routines[0].ex[0]
    expect(imported.weightProfile).toEqual(machine)
    expect(imported.weight).toBe(26.01)
  })
  it('projects cloud history and routine weights onto the same converted profile grid', () => {
    const machine = { id: 'movement', name: 'Movement', unit: 'kg', start: 11.8, step: 6.8 }
    const target = withWeightProfile({ id: '0025', mode: 'reps', weight: 11.8 }, machine, 'kg')
    const S = { ...state({}), routines: [{ id: 'r', ex: [target] }], workouts: [{ id: 'w', d: '2026-10-13', start: 1, end: 2, entries: [{ id: '0025', target, sets: [{ w: 11.8, r: 10, done: true }] }] }] }
    const lb = decodeState(encode(S), { defaults: DEF, generation: 1, displayUnit: 'lb' })
    expect(lb.routines[0].ex[0].weight).toBe(26.01)
    expect(lb.workouts[0].entries[0].sets[0].w).toBe(26.01)
    expect(stepProfileWeight(lb.workouts[0].entries[0].sets[0].w, target, 'lb', -1)).toBe(0)
  })
  it('roundtrips profiles as owner-scoped settings without relabelling native units', () => {
    const S = state({ a: profile('a') })
    const documents = encode(S)
    expect(documents['settings/weightProfiles'].payload.value.a).toEqual(profile('a'))
    expect(documents['settings/weightProfiles'].dataUnit).toBeNull()
    expect(decodeState(documents, { defaults: DEF, generation: 1 }).weightProfiles).toEqual(S.weightProfiles)
    expect(convertStateUnit(S, 'lb').weightProfiles).toEqual(S.weightProfiles)
  })
  it('merges independent offline additions and retains a newer deletion tombstone', () => {
    const a = { ...state({ a: profile('a'), removed: { deleted: true, _ts: 30 } }), _ts: 30 }
    const b = { ...state({ b: profile('b'), removed: profile('removed', 5, 10) }), _ts: 40 }
    const merged = mergeStates(a, b)
    expect(merged.weightProfiles.a).toEqual(profile('a'))
    expect(merged.weightProfiles.b).toEqual(profile('b'))
    expect(merged.weightProfiles.removed).toEqual({ deleted: true, _ts: 30 })
  })
  it('merges granular cloud changes in the same settings document', () => {
    const before = state({}), local = state({ a: profile('a') }), remote = state({ b: profile('b') })
    local._ts = stampChange(before, local, 50)
    const op = prepareOperation(before, local, { ...options, opId: 'profile-add', kind: 'update' })
    const control = { schemaVersion: 1, generation: 1, dataRevision: 1, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
    const result = mergeOperation(encode(remote), op, { control, domainContext: { remoteProfile: { control, documents: encode(remote) }, remoteState: remote } })
    // Inspect the returned map in the same way other codec tests do.
    expect(result.documentsToWrite['settings/weightProfiles'].payload.value).toHaveProperty('a')
    expect(result.documentsToWrite['settings/weightProfiles'].payload.value).toHaveProperty('b')
  })
})
