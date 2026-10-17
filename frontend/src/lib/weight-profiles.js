import { isSideSet, isWarmupRow, syncSideAggregate } from './workout-model.js'

export const WEIGHT_PROFILE_LIMIT = 50
export const DEFAULT_WEIGHT_PROFILES = {
  'step-5-kg': { id: 'step-5-kg', name: '5 / 5 kg', unit: 'kg', start: 0, step: 5 },
  'step-53-kg': { id: 'step-53-kg', name: '5.3 / 5.3 kg', unit: 'kg', start: 0, step: 5.3 },
  'movement-kg': { id: 'movement-kg', name: 'Movement', unit: 'kg', start: 11.8, step: 6.8 },
}
const round = n => Math.round(n * 100) / 100
export function normalizeWeightProfile(profile) {
  if (!profile || profile.deleted || typeof profile.id !== 'string' || !profile.id || profile.id.length > 128 || typeof profile.name !== 'string') return null
  const name = profile.name.trim().slice(0, 80)
  if (!name || !['kg', 'lb'].includes(profile.unit) || typeof profile.start !== 'number' || typeof profile.step !== 'number' || !Number.isFinite(profile.start) || !Number.isFinite(profile.step) || profile.start < 0 || profile.start > 10000 || profile.step < 0.01 || profile.step > 10000) return null
  return { id: profile.id, name, unit: profile.unit, start: round(profile.start), step: round(profile.step) }
}
export function availableWeightProfiles(S) {
  return Object.values({ ...DEFAULT_WEIGHT_PROFILES, ...(S?.weightProfiles || {}) }).map(normalizeWeightProfile).filter(Boolean).slice(0, WEIGHT_PROFILE_LIMIT)
}
export function weightProfileGrid(cfg, unit = 'kg') {
  const profile = normalizeWeightProfile(cfg?.weightProfile)
  if (!profile) return null
  const factor = profile.unit === unit ? 1 : unit === 'lb' ? 2.2046226218 : 1 / 2.2046226218
  return { start: round(profile.start * factor), step: Math.max(0.01, round(profile.step * factor)) }
}
export function withWeightProfile(cfg, profile, unit) {
  const next = { ...cfg }
  const valid = normalizeWeightProfile(profile)
  if (!valid) { delete next.weightProfile; return next }
  next.weightProfile = valid
  const grid = weightProfileGrid(next, unit)
  if (!(Number(next.weight) > 0) && grid.start > 0) next.weight = grid.start
  return next
}
export function stepProfileWeight(value, cfg, unit, direction) {
  const grid = weightProfileGrid(cfg, unit)
  if (!grid) return null
  const v = Math.max(0, Number(value) || 0), { start, step } = grid
  if (v < start - 0.001) return direction > 0 ? start : 0
  const index = (v - start) / step
  const next = direction > 0 ? Math.floor(index + 1e-7) + 1 : Math.ceil(index - 1e-7) - 1
  return next < 0 ? 0 : Math.max(0, round(start + next * step))
}
export function floorProfileWeight(value, cfg, unit) {
  const grid = weightProfileGrid(cfg, unit)
  if (!grid) return null
  if (value < grid.start) return 0
  return round(grid.start + Math.floor((value - grid.start) / grid.step + 1e-7) * grid.step)
}
export function convertProfileWeight(value, cfg, from, to) {
  const source = weightProfileGrid(cfg, from), destination = weightProfileGrid(cfg, to)
  if (!source || !destination) return null
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (!v) return 0
  const index = Math.round((v - source.start) / source.step)
  if (index >= 0 && Math.abs(v - (source.start + index * source.step)) <= 0.011) return round(destination.start + index * destination.step)
  return round(v * (to === 'lb' ? 2.2046226218 : 1 / 2.2046226218))
}
export function applyEntryWeightProfile(entry, profile, unit) {
  const target = withWeightProfile(entry.target || {}, profile, unit)
  const start = weightProfileGrid(target, unit)?.start || 0
  const initialize = row => row.done || Number(row.w) > 0 || !start ? { ...row } : { ...row, w: start }
  return { ...entry, target, ...(entry.planned ? { planned: withWeightProfile(entry.planned, profile, unit) } : {}),
    sets: (entry.sets || []).map(row => isWarmupRow(row) ? row : isSideSet(row)
      ? syncSideAggregate({ ...row, sides: { L: initialize(row.sides.L), R: initialize(row.sides.R) } }) : initialize(row)) }
}
