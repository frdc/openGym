import { expect, it } from 'vitest'
import { identifyWearTargets } from './wear-ledger.js'
import { projectStandalone } from './wear-standalone.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { makeEnvelope, makeOwner } from './cloud/model.js'
import { encodeState, mergeLocalDraft } from './cloud/codec.js'
import { DEF } from '../store/state-defaults.js'

const fixture = () => ({ ...structuredClone(DEF), active: { id: 'workout', start: 1000, cur: 0, entries: [{ id: '0025', sets: [{ r: 10, w: 60, done: false }, { r: 10, w: 60, done: false }] }] } })
it('assigns stable unique targets without changing the prepared v1 baseline', () => {
  const S = fixture(), baseline = projectStandalone(S, 'session').baseline
  const identified = identifyWearTargets(S)
  const entry = identified.active.entries[0]
  expect(new Set([entry.logId, ...entry.sets.map(s=>s.logId)]).size).toBe(3)
  expect(entry.logId).toMatch(/^[0-9a-f-]{36}$/)
  expect(identifyWearTargets(identified)).toBe(identified)
  expect(S.active.entries[0]).not.toHaveProperty('logId')
  expect(projectStandalone(identified, 'session').baseline).toBe(baseline)
})
it('keeps identity across reordering and refuses to choose an original among copied duplicate IDs', () => {
  const S = identifyWearTargets(fixture()), ids = S.active.entries[0].sets.map(s=>s.logId)
  S.active.entries[0].sets.reverse()
  expect(identifyWearTargets(S).active.entries[0].sets.map(s=>s.logId)).toEqual(ids.toReversed())
  S.active.entries[0].sets.push(structuredClone(S.active.entries[0].sets[0]))
  const next = identifyWearTargets(S)
  expect(next.active.entries[0].sets.filter(s=>s.logId===ids[1])).toHaveLength(0)
  expect(new Set(next.active.entries[0].sets.map(s=>s.logId)).size).toBe(3)
})
it('retains a watch-prepared entry and its identities when finished before offline work arrives', () => {
  const active = identifyWearTargets(fixture()).active
  const saved = buildCompletedWorkout(active, { end: 9000 })
  expect(saved.entries).toHaveLength(1)
  expect(saved.entries[0].logId).toBe(active.entries[0].logId)
  expect(saved.entries[0].sets.map(s=>s.logId)).toEqual(active.entries[0].sets.map(s=>s.logId))
})
it('commits private watch metadata beside the state and never projects it to cloud records', () => {
  const owner = makeOwner('demo-opengym', 'user'), previous = fixture()
  const initial = makeEnvelope(owner, previous)
  initial.localMetadata.wearSessions = { earlier: { workoutId: 'old' } }
  const next = structuredClone(previous); next.active.entries[0].sets[0].done = true
  const updates = { 'private-session': { workoutId: 'workout', receipt: 'private-receipt' } }
  const saved = mergeLocalDraft(initial, { previous, next, activeSessionToken: 'session', wearSessionUpdates: updates })
  expect(saved.state.active.entries[0].sets[0].done).toBe(true)
  expect(saved.localMetadata.wearSessions).toEqual({ earlier: { workoutId: 'old' }, ...updates })
  expect(initial.localMetadata.wearSessions).toEqual({ earlier: { workoutId: 'old' } })
  expect(JSON.stringify(encodeState(saved.state, { generation: 1, unitVersion: 1 }))).not.toContain('private-receipt')
})
