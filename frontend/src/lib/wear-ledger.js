import { applyStandalone, projectStandalone, standaloneTimerSignature, validateStandaloneCommand } from './wear-standalone.js'
import { bestWeightForEntry, workoutVolume } from './history.js'
import { stampWorkout } from './sync-merge.js'
import { buildHeartRate } from './heart-rate.js'
import { isSideSet, syncSideAggregate } from './workout-model.js'

const copy = value => structuredClone(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const own = (value, key) => !!value && Object.hasOwn(value, key)
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])) : value
const same = (a,b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b))
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const checkSize = sessions => {
  if (Object.values(sessions).reduce((n,s)=>n+Object.keys(s.records || {}).length,0)>1024 || new TextEncoder().encode(JSON.stringify(sessions)).length>16*1024*1024) fail('wear-ledger-full')
}

/** Stable record identity, never an authorization token. Copies with duplicate IDs
 * are ambiguous: replace every copy rather than choosing the first as original. */
export function identifyWearTargets(S) {
  if (!S.active || !Array.isArray(S.active.entries)) return S
  const objects = S.active.entries.flatMap(entry => [entry, ...(entry.sets || [])])
  const counts = new Map()
  for (const object of objects) if (typeof object.logId === 'string' && object.logId) counts.set(object.logId, (counts.get(object.logId) || 0) + 1)
  if (objects.every(object => counts.get(object.logId) === 1)) return S
  const next = structuredClone(S)
  for (const object of next.active.entries.flatMap(entry => [entry, ...(entry.sets || [])])) {
    if (counts.get(object.logId) !== 1) object.logId = crypto.randomUUID()
  }
  return next
}

export function prepareWearLedger(S, sessionId, sessions = {}) {
  const identified = identifyWearTargets(S), projection = projectStandalone(identified, sessionId)
  if (!projection) return { S, updates:null, projection:null }
  const previous = own(sessions,sessionId) ? sessions[sessionId] : null
  if (previous && (previous.workoutId!==identified.active.id || previous.start!==identified.active.start)) fail('stale-context')
  if (own(previous?.records,projection.baseline)) return { S:identified, updates:null, projection }
  const base = { unit:identified.unit || 'kg', restSec:identified.restSec || 0, active:copy(identified.active) }
  const next = { ...(previous || { v:1,workoutId:base.active.id,start:base.active.start,records:{} }),
    records:{ ...previous?.records, [projection.baseline]:{ base,phoneEntry:base.active.entries[base.active.cur || 0]?.logId, phoneTimer:standaloneTimerSignature(base.active._wearStandaloneTimer?.timer) } } }
  const updates = { [sessionId]:next }
  checkSize({ ...sessions,...updates })
  return { S:identified, updates, projection }
}

/** Advertise only opaque sessions owned by the loaded archive. No account IDs. */
export function wearSyncProjection(sessions = {},hint=null) {
  const records=Object.entries(sessions).flatMap(([sessionId,s])=>Object.entries(s.records || {}).map(([baseline,r])=>({sessionId,baseline,r})))
  const selected=records.slice(-96)
  const requested=records.find(r=>r.sessionId===hint?.sessionId && r.baseline===hint?.baseline)
  if(requested && !selected.includes(requested)) selected.push(requested)
  const grouped=new Map(),receipts=[]
  for(const {sessionId,baseline,r} of selected) {
    if(!grouped.has(sessionId)) grouped.set(sessionId,[])
    grouped.get(sessionId).push(baseline)
    const cp=r.replay?.active?._wearStandalone,last=cp?.events.at(-1)
    if(last) receipts.push({sessionId,baseline,streamId:cp.streamId,seq:last.seq,requestId:last.id})
  }
  return {v:2,sessions:[...grouped].map(([sessionId,baselines])=>({sessionId,baselines})),receipts}
}

function targetAt(workout, entryId, setId, exerciseId) {
  const entries=(workout.entries || []).map((entry,entryIdx)=>({entry,entryIdx})).filter(x=>x.entry.logId===entryId)
  if (entries.length!==1 || entries[0].entry.id!==exerciseId) fail('target-conflict')
  const {entry,entryIdx}=entries[0], sets=(entry.sets || []).map((set,setIdx)=>({set,setIdx})).filter(x=>x.set.logId===setId)
  if (sets.length!==1) fail('target-conflict')
  return {entry,entryIdx,...sets[0]}
}

function mergeValue(before,after,current) {
  if (same(before,after)) return copy(current)
  if (same(current,before) || same(current,after)) return copy(after)
  if (plain(before) && plain(after) && plain(current)) return mergeSet(before,after,current)
  fail('field-conflict')
}
function mergeSet(before,after,current) {
  const out=copy(current)
  const sides=isSideSet(before) && isSideSet(after) && isSideSet(current)
  for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if (sides && ['w','r','done','rpe','rir'].includes(key)) continue
    if (sides && key==='at') { out.at=Math.max(current.at || 0,after.at || 0) || undefined; continue }
    // A phone-completed set keeps its own completion time; the watch's capture
    // has its independent effort boundary and still belongs to this same set.
    if (key==='at' && current.done && after.done && !before.done) { if (out.at==null) out.at=after.at; continue }
    if (key==='heartRate' && !same(before[key],after[key]) && current[key] && after[key]
        && current[key].startedAt===after[key].startedAt) {
      const measured=current[key], planned=after[key]
      // Final sensor data may have arrived before a later journal batch closes
      // its recovery. A replay cannot extend/replace that confirmed capture.
      if (measured.recoveryEndMs!=null && (planned.recoveryEndMs==null || planned.recoveryEndMs>=measured.recoveryEndMs)) { out[key]=copy(measured); continue }
      const effortEndMs=planned.effortEndMs ?? measured.effortEndMs, recoveryEndMs=planned.recoveryEndMs ?? measured.recoveryEndMs
      const effortSafe=effortEndMs===measured.effortEndMs || measured.effortEndMs==null && measured.points.every(p=>p[0]<=effortEndMs)
      const recoverySafe=effortEndMs===measured.effortEndMs && (recoveryEndMs==null || measured.points.every(p=>p[0]<=recoveryEndMs))
      out[key]=buildHeartRate({...measured,effortEndMs,recoveryEndMs,endReason:planned.endReason || measured.endReason,
        effort:effortSafe ? measured.effort : null,recovery:recoverySafe ? measured.recovery : null})
      continue
    }
    const value=mergeValue(before[key],after[key],current[key])
    if (value===undefined) delete out[key]; else out[key]=value
  }
  return sides ? syncSideAggregate(out) : out
}

function adoptedCheckpoint(checkpoint,prepared,workout) {
  const adopted=copy(checkpoint)
  adopted.steps=adopted.steps.map(step=>{
    const entry=prepared.entries[step.entryIdx],set=entry.sets[step.setIdx]
    try {const target=targetAt(workout,entry.logId,set.logId,entry.id);return {...step,entryIdx:target.entryIdx,setIdx:target.setIdx}}
    catch {return null} // A removed future step cannot become an unrelated UI rest target.
  })
  for (const binding of Object.values(adopted.hearts || {})) {
    const entry=prepared.entries[binding.target.entryIdx], set=entry.sets[binding.target.setIdx]
    const mapped=targetAt(workout,entry.logId,set.logId,entry.id)
    binding.target={entryIdx:mapped.entryIdx,setIdx:mapped.setIdx,side:binding.target.side,entryLogId:entry.logId,setLogId:set.logId}
  }
  return adopted
}

/** Replay on the immutable prepared copy, then reconcile only changed targets.
 * The caller commits S and updates together in the owner's local transaction. */
export function applyWearLedger(S,sessions,command,currentSessionId,nodeId) {
  const invalid=validateStandaloneCommand(command); if (invalid) fail(invalid)
  const session=own(sessions,command.contextToken) ? sessions[command.contextToken] : null
  if (!session) fail('stale-context')
  const record=own(session.records,command.baseline) ? session.records[command.baseline] : null
  if (!record) fail('baseline-conflict')
  const prior=record.replay || record.base, previous=prior.active._wearStandalone
  if (previous?.nodeId && previous.nodeId!==nodeId) fail('stream-conflict')
  if ((S.unit || 'kg')!==(record.base.unit || 'kg')) fail('stale-unit')
  const active=currentSessionId===command.contextToken && S.active?.id===session.workoutId && S.active?.start===session.start
  const candidates=active ? [S.active] : (S.workouts || []).filter(w=>w.id===session.workoutId && w.start===session.start)
  if (candidates.length!==1) fail('stale-target')
  const replayed=applyStandalone(prior,command,command.contextToken)
  const checkpoint=copy(replayed.active._wearStandalone); checkpoint.nodeId=nodeId
  if (replayed===prior) return { S,updates:null,checkpoint:adoptedCheckpoint(checkpoint,prior.active,candidates[0]),workoutId:session.workoutId,workoutStart:session.start,activeRuntime:false }
  replayed.active._wearStandalone=checkpoint
  const next=copy(S), workout=active ? next.active : next.workouts.find(w=>w.id===session.workoutId && w.start===session.start)
  for (const [ei,baseEntry] of prior.active.entries.entries()) {
    for (const [si,before] of baseEntry.sets.entries()) {
      const after=replayed.active.entries[ei].sets[si]
      if (same(before,after)) continue
      const target=targetAt(workout,baseEntry.logId,before.logId,baseEntry.id)
      target.entry.sets[target.setIdx]=mergeSet(before,after,target.set)
    }
  }
  for (const entry of workout.entries) entry.topW=bestWeightForEntry(entry) || null
  const expectedEntry=record.phoneEntry ?? record.base.active.entries[record.base.active.cur || 0]?.logId
  const nextEntry=replayed.active.entries[replayed.active.cur || 0]?.logId
  const nextPositions=workout.entries.map((e,i)=>({e,i})).filter(x=>x.e.logId===nextEntry)
  const activeRuntime=active && nextPositions.length===1 && S.active.entries[S.active.cur || 0]?.logId===expectedEntry && standaloneTimerSignature(S.active._wearStandaloneTimer?.timer)===record.phoneTimer
  if (active) {
    delete workout._wearStandalone
    if (activeRuntime) {
      workout.cur=nextPositions[0].i
      workout._wearStandaloneTimer={sessionId:command.contextToken,timer:copy(checkpoint.runtime.timer)}
    }
  } else { workout.vol=workoutVolume(workout); stampWorkout(workout) }
  // Heart adoption locates the merged target, even after reordering or finish.
  const adopted=adoptedCheckpoint(checkpoint,replayed.active,workout)
  const updates={ [command.contextToken]:{...session,records:{...session.records,[command.baseline]:{...record,replay:replayed,checkpoint:adopted,
    phoneEntry:activeRuntime ? workout.entries[workout.cur || 0]?.logId : expectedEntry,
    phoneTimer:activeRuntime ? standaloneTimerSignature(workout._wearStandaloneTimer?.timer) : record.phoneTimer}}} }
  checkSize({...sessions,...updates})
  return {S:next,updates,checkpoint:adopted,workoutId:session.workoutId,workoutStart:session.start,activeRuntime}
}
