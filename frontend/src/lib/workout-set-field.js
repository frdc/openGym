import { cascadeWeight } from './history.js'
import { setSideField, WEIGHT_ORIGIN_MANUAL } from './workout-model.js'

// Shared by phone number fields and Wear edits; all other set metadata survives.
export function setWorkoutField(entry, index, field, value, side = null) {
  if (side) entry.sets[index] = setSideField(entry.sets[index], side, field, value)
  else if (value == null) delete entry.sets[index][field]
  else entry.sets[index][field] = value
  if (field === 'sec') delete entry.sets[index].planSec
  if (field === 'w') {
    const set = side ? entry.sets[index].sides[side] : entry.sets[index]
    set.weightOrigin = WEIGHT_ORIGIN_MANUAL
    entry.sets = cascadeWeight(entry.sets, index, value, side)
  }
}
