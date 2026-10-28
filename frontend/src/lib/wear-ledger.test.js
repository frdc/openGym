import { expect, it } from 'vitest'
import { identifyWearTargets, prepareWearLedger, applyWearLedger, wearSyncProjection } from './wear-ledger.js'
import { projectStandalone } from './wear-standalone.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { makeEnvelope, makeOwner } from './cloud/model.js'
import { encodeState, mergeLocalDraft } from './cloud/codec.js'
import { DEF } from '../store/state-defaults.js'
import { makeSideSet, toggleSide } from './workout-model.js'

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

const started = (seq, action, step = 0, extra = {}) => ({ seq, id: `10000000-0000-4000-8000-${String(seq).padStart(12,'0')}`, action, at: 10000 + seq * 1000, step, ...extra })
const prepared = () => {
  const p = prepareWearLedger(fixture(), 'session', {})
  return { ...p, sessions: p.updates, command: { v: 1, action: 'standalone-sync', contextToken: 'session', streamId: 'stream', baseline: p.projection.baseline,
    requestId: started(2, 'complete').id, events: [started(1, 'start', 0, { heart: true }), started(2, 'complete')] } }
}
it('merges another set edit and later batches without changing the phone value', () => {
  const p = prepared(); p.S.active.entries[0].sets[1].r = 12
  const first = applyWearLedger(p.S, p.sessions, p.command, 'session', 'watch')
  expect(first.S.active.entries[0].sets.map(s=>[s.done,s.r])).toEqual([[true,10],[false,12]])
  const second = applyWearLedger(first.S, first.updates, { ...p.command, requestId: started(4,'complete',1).id, events: [started(3,'start',1),started(4,'complete',1)] }, 'session', 'watch')
  expect(second.S.active.entries[0].sets.map(s=>[s.done,s.r])).toEqual([[true,10],[true,12]])
  expect(wearSyncProjection(second.updates).receipts[0]).toMatchObject({ sessionId:'session',seq:4 })
})
it('imports into an unmarked finished workout while a new session and its rest remain untouched', () => {
  const p = prepared(), saved = buildCompletedWorkout(p.S.active, { end: 30000 })
  p.S.workouts = [saved]; p.S.active = { id:'new',start:40000,cur:0,entries:[],_wearStandaloneTimer:{timer:{timerToken:'new-rest'}} }
  const result = applyWearLedger(p.S, p.sessions, p.command, 'new-session', 'watch')
  expect(result.S.active).toEqual(p.S.active)
  expect(result.S.workouts[0].entries[0].sets[0]).toMatchObject({ done:true, heartRate:{ startedAt:11000 } })
  expect(result.activeRuntime).toBe(false)
  const duplicate = applyWearLedger(result.S, result.updates, p.command, 'new-session', 'watch')
  expect(duplicate.S).toBe(result.S)
})
it('uses unique target IDs through reordering and rejects removed or duplicated targets atomically', () => {
  const p = prepared(), firstId = p.S.active.entries[0].sets[0].logId
  p.S.active.entries[0].sets.reverse()
  const result = applyWearLedger(p.S, p.sessions, p.command, 'session', 'watch')
  expect(result.S.active.entries[0].sets.find(s=>s.logId===firstId).done).toBe(true)
  expect(result.S.active.entries[0].sets[0].done).toBe(false)
  for (const duplicate of [false,true]) {
    const bad = structuredClone(p.S)
    if (duplicate) bad.active.entries[0].sets.push(structuredClone(bad.active.entries[0].sets[1]))
    else bad.active.entries[0].sets.pop()
    const before = structuredClone(bad)
    expect(()=>applyWearLedger(bad,p.sessions,p.command,'session','watch')).toThrow('target-conflict')
    expect(bad).toEqual(before)
  }
})
it('keeps incompatible same-field edits, units and unknown sessions unacknowledged', () => {
  const p = prepared()
  p.S.active.entries[0].sets[0].w = 70
  const edit = { ...p.command, requestId: started(2,'edit-set').id, events:[started(1,'start'),started(2,'edit-set',0,{field:'w',value:65,unit:'kg'})] }
  expect(()=>applyWearLedger(p.S,p.sessions,edit,'session','watch')).toThrow('field-conflict')
  expect(()=>applyWearLedger(p.S,{},p.command,'session','watch')).toThrow('stale-context')
  p.S.unit='lb'
  expect(()=>applyWearLedger(p.S,p.sessions,p.command,'session','watch')).toThrow('stale-unit')
})
it('keeps an already completed phone set and existing curve while importing an independent later event', () => {
  const p=prepared(), first=applyWearLedger(p.S,p.sessions,p.command,'session','watch')
  first.S.active.entries[0].sets[0].heartRate={v:1,source:'galaxy-watch',startedAt:11000,effortEndMs:1000,recoveryEndMs:1500,endReason:'disabled',status:'complete',points:[[0,80],[1000,120],[1500,90]],effort:{count:2,mean:100,peak:120},recovery:{count:1,mean:90,peak:90},milestones:[]}
  const measurement=structuredClone(first.S.active.entries[0].sets[0].heartRate)
  first.S.active.entries[0].sets[1].done=true; first.S.active.entries[0].sets[1].at=90000
  const second=applyWearLedger(first.S,first.updates,{...p.command,requestId:started(4,'complete',1).id,events:[started(3,'start',1),started(4,'complete',1)]},'session','watch')
  expect(second.S.active.entries[0].sets[0].heartRate).toEqual(measurement)
  expect(second.S.active.entries[0].sets[1].at).toBe(90000)
})
it('combines independent left/right completions and rebuilds the aggregate row', () => {
  const S=fixture(); S.active.entries[0].sets=[makeSideSet({r:10,w:60})]
  const p=prepareWearLedger(S,'session',{})
  p.S.active.entries[0].sets[0]=toggleSide(p.S.active.entries[0].sets[0],'R')
  p.S.active.entries[0].sets[0].at=9000
  const command={v:1,action:'standalone-sync',contextToken:'session',streamId:'sides',baseline:p.projection.baseline,requestId:started(2,'complete').id,events:[started(1,'start'),started(2,'complete')]}
  const result=applyWearLedger(p.S,p.updates,command,'session','watch')
  expect(result.S.active.entries[0].sets[0]).toMatchObject({done:true,sides:{L:{done:true},R:{done:true}}})
})
it('keeps repeated exercises distinct after the entries are reordered', () => {
  const S=fixture(); S.active.entries.push(structuredClone(S.active.entries[0]))
  const p=prepareWearLedger(S,'session',{}), original=p.S.active.entries[0].logId
  p.S.active.entries.reverse()
  const command={v:1,action:'standalone-sync',contextToken:'session',streamId:'repeat',baseline:p.projection.baseline,requestId:started(2,'complete').id,events:[started(1,'start'),started(2,'complete')]}
  const result=applyWearLedger(p.S,p.updates,command,'session','watch')
  expect(result.S.active.entries.find(e=>e.logId===original).sets[0].done).toBe(true)
  expect(result.S.active.entries[0].sets[0].done).toBe(false)
})
