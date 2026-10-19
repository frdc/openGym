import { projectWearCurrent } from './wear-protocol.js'
import { nextOpenSet } from './workout-keys.js'
import { bestWeightForEntry, supersetUnits } from './history.js'
import { isWarmupRow, toggleSide } from './workout-model.js'
import { nextUnfinishedUnit, restAfterSet, restSecFor, supersetFlowStep, warmupRestSecFor } from './supersetFlow.js'
import { pyramidRestFor } from './pyramid.js'
import { setWorkoutField } from './workout-set-field.js'
import { buildHeartRate } from './heart-rate.js'
import { REST_MAX } from './duration.js'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const rowAt = (S, step) => S.active.entries[step.entryIdx].sets[step.setIdx]
const setAt = (S, step) => step.side ? rowAt(S, step).sides[step.side] : rowAt(S, step)
const token = s => typeof s === 'string' && s.length > 0 && s.length <= 100
const eventId = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const actions = ['start', 'pause-effort', 'resume-effort', 'complete', 'edit-set', 'pause', 'resume', 'plus15', 'skip', 'cancel-effort']
const eventKeys = ['seq', 'id', 'action', 'at', 'step', 'field', 'value', 'unit', 'heart']
export const standaloneTimerSignature = timer => JSON.stringify(timer ? { timerToken: timer.timerToken, endsAt: timer.paused ? 0 : timer.endsAt, paused: !!timer.paused, leftMs: timer.paused ? timer.leftMs : 0 } : null)

// Sorted keys make the checkpoint independent of serialization/property order. The
// hash is a change detector; authorization comes only from the private session token.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().filter(k => k !== 'heartRate' && !k.startsWith('_')).map(k => [k, canonical(value[k])]))
}
function fingerprint(S) {
  const text = JSON.stringify(canonical({ unit: S.unit || 'kg', restSec: S.restSec || 0, cur: S.active.cur || 0, phoneTimer: standaloneTimerSignature(S.active._wearStandaloneTimer?.timer), entries: S.active.entries.map(e => ({ id: e.id, sg: e.sg, target: e.target, sets: e.sets })) }))
  let a = 2166136261, b = 2246822507
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909) }
  return `v1:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}
function usable(S, sessionId) { return token(sessionId) && S.active && !S.active.backfill && !S.active.editingWorkoutId && Array.isArray(S.active.entries) }

// The bridge calls this only for an observed phone timer mutation. Persisting the
// seed makes even a first offline pause replayable after the phone restarts.
export function reconcileStandaloneTimer(S, timer, sessionId, now = Date.now()) {
  if (!usable(S, sessionId)) return S
  const previous = S.active._wearStandaloneTimer?.sessionId === sessionId ? S.active._wearStandaloneTimer.timer : null
  if (standaloneTimerSignature(previous) === standaloneTimerSignature(timer) || !timer && previous && !previous.paused && previous.endsAt <= now) return S
  const next = structuredClone(S)
  next.active._wearStandaloneTimer = { sessionId, timer: timer ? { timerToken: timer.timerToken, endsAt: timer.paused ? 0 : timer.endsAt, leftMs: timer.leftMs, paused: !!timer.paused, ready: false } : null }
  return next
}

function completeSet(S, step, at) {
  const entry = S.active.entries[step.entryIdx]
  if (step.side) entry.sets[step.setIdx] = toggleSide(rowAt(S, step), step.side)
  else rowAt(S, step).done = true
  const row = rowAt(S, step)
  if (at != null) row.at = at
  if (!row.done) return 0
  delete row.planSec
  if (entry.sets.every(s => s.done)) entry.topW = bestWeightForEntry(entry) || null
  const units = supersetUnits(S.active.entries), unit = units.find(u => u.includes(step.entryIdx)) || [step.entryIdx]
  const unitDone = unit.every(i => S.active.entries[i].sets.every(s => s.done))
  const nextUnit = unitDone ? nextUnfinishedUnit(S.active.entries, units, step.entryIdx) : null
  const nextWarmup = nextUnit?.some(i => S.active.entries[i].sets.some(s => isWarmupRow(s) && !s.done))
  const rest = warmupRestSecFor(entry, step.setIdx, restSecFor(S.active.entries, unit, S.restSec, { idx: step.entryIdx, sec: pyramidRestFor(entry.target, entry.sets, step.setIdx) }))
  if (unit.length === 1) return !nextWarmup && restAfterSet({ unitDone, lastUnit: unitDone && !nextUnit }) ? rest : 0
  const flow = supersetFlowStep(S.active.entries, unit, step.entryIdx)
  if (flow.nextIdx != null) S.active.cur = flow.nextIdx
  return flow.unitDone ? nextUnit && !nextWarmup ? rest : 0 : flow.roundDone ? rest : 0
}

function projectSteps(S, sessionId) {
  const work = { unit: S.unit, restSec: S.restSec, active: structuredClone(S.active) }, steps = []
  let next
  while ((next = nextOpenSet(work.active.entries, work.active.cur))) {
    if (steps.length >= 200) return null
    const current = projectWearCurrent(work, next, true)
    const row = rowAt(work, current), set = setAt(work, current)
    const step = { ...current, warmup: isWarmupRow(row), manualLoad: set.weightOrigin === 'manual' }
    step.restAfterSec = completeSet(work, step)
    steps.push(step)
  }
  return steps
}

function refreshSteps(S, steps) {
  return steps.map(step => {
    const set = setAt(S, step)
    return { ...step, ...projectWearCurrent(S, { idx: step.entryIdx, i: step.setIdx, side: step.side }, true), manualLoad: set.weightOrigin === 'manual' }
  })
}

export function projectStandalone(S, sessionId) {
  if (!usable(S, sessionId)) return null
  const baseline = fingerprint(S), checkpoint = S.active._wearStandalone
  if (checkpoint?.sessionId === sessionId && checkpoint.fingerprint === baseline) return {
    v: 1, sessionId, baseline: checkpoint.baseline, steps: refreshSteps(S, checkpoint.steps), cursor: checkpoint.cursor,
    ack: { streamId: checkpoint.streamId, seq: checkpoint.events.length }, runtime: structuredClone(checkpoint.runtime),
  }
  const steps = projectSteps(S, sessionId)
  const timer = S.active._wearStandaloneTimer?.sessionId === sessionId ? S.active._wearStandaloneTimer.timer : null
  return steps ? { v: 1, sessionId, baseline, steps, cursor: 0, ack: null, runtime: { effort: null, timer: structuredClone(timer) } } : null
}

export function validateStandaloneCommand(command) {
  if (!command || command.v !== 1 || command.action !== 'standalone-sync' || !token(command.requestId) || !token(command.contextToken) || !token(command.streamId) || !token(command.baseline) || !Array.isArray(command.events) || command.events.length < 1 || command.events.length > 64) return 'invalid-command'
  try { if (new TextEncoder().encode(JSON.stringify(command)).length > 65536) return 'invalid-command' } catch { return 'invalid-command' }
  let previous = null
  for (const e of command.events) {
    if (!e || Object.keys(e).some(k => !eventKeys.includes(k)) || !Number.isInteger(e.seq) || e.seq < 1 || e.seq > 1024 || !eventId(e.id) || !actions.includes(e.action) || !Number.isSafeInteger(e.at) || e.at <= 0 || !Number.isInteger(e.step) || e.step < 0 || e.step > 200) return 'invalid-event'
    if (previous && (e.seq !== previous.seq + 1 || e.at < previous.at)) return 'invalid-event'
    if (e.action === 'edit-set') {
      if (!['r', 'w'].includes(e.field) || !Number.isFinite(e.value) || e.value < 0 || e.value > 10000 || e.field === 'r' && !Number.isInteger(e.value) || e.field === 'w' && !['kg', 'lb'].includes(e.unit)) return 'invalid-event'
    } else if (e.field != null || e.value != null || e.unit != null) return 'invalid-event'
    if (e.heart != null && (e.action !== 'start' || typeof e.heart !== 'boolean')) return 'invalid-event'
    previous = e
  }
  return command.requestId === command.events.at(-1).id ? null : 'invalid-command'
}

function updateHeart(S, checkpoint, e) {
  const records = checkpoint.hearts
  if (e.action === 'start') {
    for (const b of Object.values(records)) if (!b.closed) {
      b.closed = true; b.recoveryEndMs = Math.max(b.effortEndMs || 0, e.at - b.startedAt); b.endReason = 'next-set'
      const row = setAt(S, b.target)
      if (row.heartRate?.startedAt === b.startedAt) row.heartRate = buildHeartRate({ ...row.heartRate, effortEndMs: b.effortEndMs, recoveryEndMs: b.recoveryEndMs, endReason: b.endReason })
    }
    if (e.heart) {
      const target = checkpoint.steps[e.step], row = setAt(S, target)
      records[e.id] = { target: { entryIdx: target.entryIdx, setIdx: target.setIdx, side: target.side }, startedAt: e.at, effortEndMs: null, closed: false, ...(row.heartRate ? { previousHeartRate: row.heartRate } : {}) }
      row.heartRate = buildHeartRate({ startedAt: e.at })
    }
  } else if (['complete', 'cancel-effort'].includes(e.action)) {
    const b = Object.values(records).find(b => !b.closed && b.effortEndMs === null)
    if (!b) return
    const row = setAt(S, b.target)
    if (e.action === 'cancel-effort') {
      b.invalid = true; b.closed = true
      if (b.previousHeartRate) row.heartRate = b.previousHeartRate
      else delete row.heartRate
    } else {
      b.effortEndMs = e.at - b.startedAt; delete b.previousHeartRate
      row.heartRate = buildHeartRate({ ...row.heartRate, effortEndMs: b.effortEndMs })
    }
  }
}

function replay(S, checkpoint, e) {
  if (e.step !== checkpoint.cursor) fail('stale-target')
  const runtime = checkpoint.runtime, effort = runtime.effort, timer = runtime.timer, step = checkpoint.steps[e.step]
  const left = timer ? Math.max(0, timer.paused ? timer.leftMs : timer.endsAt - e.at) : 0
  if (['start', 'complete', 'edit-set', 'pause-effort', 'resume-effort', 'cancel-effort'].includes(e.action) && (!step || !step.canComplete)) fail('unsupported-set')
  if (e.action === 'start') {
    if (effort) fail('effort-active')
    runtime.effort = { startedAt: e.at, elapsedMs: 0, paused: false, resumedAt: e.at, token: e.id, heart: e.heart === true }; runtime.timer = null
  } else if (e.action === 'pause-effort') {
    if (!effort || effort.paused) fail('stale-effort')
    effort.elapsedMs += e.at - effort.resumedAt; effort.paused = true; effort.resumedAt = 0
  } else if (e.action === 'resume-effort') {
    if (!effort || !effort.paused) fail('stale-effort')
    effort.paused = false; effort.resumedAt = e.at
  } else if (e.action === 'cancel-effort') {
    if (!effort) fail('stale-effort')
    runtime.effort = null
  } else if (e.action === 'complete') {
    if (!effort) fail('stale-effort')
    if (setAt(S, step).done) fail('state-conflict')
    completeSet(S, step, e.at); checkpoint.cursor++
    runtime.effort = null
    runtime.timer = step.restAfterSec > 0 ? { timerToken: e.id, endsAt: e.at + step.restAfterSec * 1000, leftMs: step.restAfterSec * 1000, paused: false, ready: false } : null
  } else if (e.action === 'edit-set') {
    if (e.field === 'w' && e.unit !== (S.unit === 'lb' ? 'lb' : 'kg')) fail('stale-unit')
    setWorkoutField(S.active.entries[step.entryIdx], step.setIdx, e.field, e.value, step.side)
  } else {
    if (!timer) fail('stale-timer')
    if (e.action === 'pause') {
      if (timer.paused || !left) fail('stale-timer')
      timer.leftMs = left; timer.paused = true; timer.endsAt = 0
    } else if (e.action === 'resume') {
      if (!timer.paused || !left) fail('stale-timer')
      timer.endsAt = e.at + left; timer.paused = false
    } else if (e.action === 'plus15') {
      timer.leftMs = Math.min(REST_MAX * 1000, left + 15000); timer.ready = false
      if (!timer.paused) timer.endsAt = e.at + timer.leftMs
    } else runtime.timer = null
  }
  updateHeart(S, checkpoint, e)
}

export function applyStandalone(S, command, sessionId) {
  const error = validateStandaloneCommand(command)
  if (error) fail(error)
  if (!usable(S, sessionId) || command.contextToken !== sessionId) fail('stale-context')
  const current = fingerprint(S)
  let previous = S.active._wearStandalone
  if (previous && previous.sessionId !== sessionId) fail('stale-context')
  // A watch that explicitly discards conflicted work can prepare the phone's new
  // sequence. A different stream cannot take over an unchanged baseline.
  if (previous && previous.streamId !== command.streamId && previous.fingerprint !== current && command.baseline === current) previous = null
  if (previous && previous.streamId !== command.streamId) fail('stream-conflict')
  if (previous && previous.baseline !== command.baseline) fail('baseline-conflict')
  if (previous && previous.fingerprint !== current) fail('state-conflict')
  const projection = previous ? null : projectStandalone(S, sessionId)
  if (!previous && (!projection || projection.baseline !== command.baseline)) fail('baseline-conflict')
  const work = structuredClone(S), checkpoint = previous ? work.active._wearStandalone : {
    v: 1, sessionId, streamId: command.streamId, baseline: command.baseline, steps: projection.steps, cursor: 0, runtime: projection.runtime, events: [], hearts: {},
  }
  let changed = false
  for (const e of command.events) {
    const old = checkpoint.events[e.seq - 1]
    if (old) { if (JSON.stringify(canonical(old)) !== JSON.stringify(canonical(e))) fail('event-conflict'); continue }
    if (e.seq !== checkpoint.events.length + 1 || checkpoint.events.some(old => old.id === e.id) || e.at < (checkpoint.events.at(-1)?.at || 0)) fail('event-conflict')
    replay(work, checkpoint, e)
    checkpoint.events.push(structuredClone(e)); changed = true
  }
  if (!changed) return S
  work.active._wearStandaloneTimer = { sessionId, timer: structuredClone(checkpoint.runtime.timer) }
  checkpoint.fingerprint = fingerprint(work); work.active._wearStandalone = checkpoint
  return work
}
