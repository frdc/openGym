import { nextOpenSet } from './workout-keys.js'
import { exOr } from './exercises.js'
import { modeOf, setLabel } from './history.js'
import { exerciseNameText, fmtNum } from './format.js'
import { modeForSet, setType } from './workout-model.js'
import { weightIncrement } from './progression.js'
import { weightProfileGrid } from './weight-profiles.js'

export function projectWearState({ S = {}, timer, contextToken, revision = 0, ready = false, editingReady = false, now = Date.now() } = {}) {
  const active = !!(ready && contextToken && S.active && !S.active.editingWorkoutId)
  const next = active ? nextOpenSet(S.active.entries, S.active.cur) : null
  let current = null
  if (next) {
    const entry = S.active.entries[next.idx], row = entry.sets[next.i]
    const set = next.side ? row.sides[next.side] : row
    current = {
      entryIdx: next.idx, setIdx: next.i, side: next.side || null,
      name: exerciseNameText(exOr(entry.id)),
      setLabel: `${next.i + 1}/${entry.sets.length}${next.side ? ' · ' + next.side : ''}`,
      repsLabel: setLabel(entry.id, set, entry.target),
      loadLabel: set.w != null ? `${fmtNum(set.w)} ${S.unit || 'kg'}` : '',
      repsValue: Number.isFinite(set.r) ? set.r : null,
      loadValue: Number.isFinite(set.w) ? set.w : null,
      loadUnit: S.unit === 'lb' ? 'lb' : 'kg',
      loadStep: weightIncrement({ ...entry.target, id: entry.id }, S.unit === 'lb' ? 'lb' : 'kg'),
      ...(weightProfileGrid(entry.target, S.unit)?.start != null ? { loadStart: weightProfileGrid(entry.target, S.unit).start } : {}),
      repsStep: 1,
      canComplete: modeOf({ ...entry.target, id: entry.id }) === 'reps' && modeForSet(row, entry.target) === 'reps' && modeForSet(set, entry.target) === 'reps' && setType(row) === 'straight' && setType(set) === 'straight' && !row.drops?.length && !row.clusters?.length && !set.drops?.length && !set.clusters?.length,
    }
    current.canEdit = current.canComplete && editingReady
  }
  return {
    v: 1, contextToken: contextToken || '', revision, active, current,
    vibrate: S.vibrate !== false,
    lang: S.lang || 'en',
    timer: active && timer ? { timerToken: timer.timerToken, endsAt: timer.endsAt || 0, leftMs: timer.paused ? Math.max(0, timer.left * 1000) : Math.max(0, (timer.endsAt || now) - now), paused: !!timer.paused, ready: !!timer.ready } : null,
  }
}

export function validateWearCommand(command, state) {
  if (!command || command.v !== 1 || typeof command.requestId !== 'string' || !command.requestId || command.requestId.length > 100) return 'invalid-command'
  if (!state?.active || command.contextToken !== state.contextToken) return 'stale-context'
  if (command.revision !== state.revision) return 'stale-revision'
  const target = command.target
  if (['complete', 'heart-start', 'edit-set'].includes(command.action)) {
    const cur = state.current
    if (!(command.action === 'edit-set' ? cur?.canEdit : cur?.canComplete)) return 'unsupported-set'
    if (!target || target.entryIdx !== cur.entryIdx || target.setIdx !== cur.setIdx || (target.side || null) !== cur.side) return 'stale-target'
    if (command.action === 'edit-set') {
      if (!['r', 'w'].includes(command.field) || !Number.isFinite(command.value) || command.value < 0 || command.value > 10000 || command.field === 'r' && !Number.isInteger(command.value)) return 'invalid-command'
      if (command.field === 'w' && command.unit !== cur.loadUnit) return 'stale-unit'
    }
  } else if (command.action === 'heart-cancel') {
    if (!state.heartCapture) return 'stale-target'
  } else {
    if (!['pause', 'resume', 'plus15', 'skip'].includes(command.action)) return 'invalid-command'
    if (!state.timer || state.timer.ready || target?.timerToken !== state.timer.timerToken) return 'stale-timer'
    if (command.action === 'pause' && state.timer.paused || command.action === 'resume' && !state.timer.paused) return 'stale-timer'
  }
  return null
}
