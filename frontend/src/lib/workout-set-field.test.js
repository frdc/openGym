import { expect, it } from 'vitest'
import { setWorkoutField } from './workout-set-field.js'
import { makeSideSet, toggleSide } from './workout-model.js'

it('phone and watch weight corrections inherit without changing measured set metadata', () => {
  const entry = { sets: [{ r: 8, w: 20, done: false, at: 123, heartRate: { token: 'capture' } }, { r: 8, w: 20 }, { r: 8, w: 25, weightOrigin: 'manual' }, { r: 8, w: 20, done: true }] }
  setWorkoutField(entry, 0, 'w', 22.5)
  expect(entry.sets.map(s => s.w)).toEqual([22.5, 22.5, 25, 20])
  expect(entry.sets[0]).toMatchObject({ weightOrigin: 'manual', r: 8, done: false, at: 123, heartRate: { token: 'capture' } })
  setWorkoutField(entry, 0, 'r', 0)
  expect(entry.sets.map(s => s.r)).toEqual([0, 8, 8, 8])
})
it('edits only the selected side, keeps aggregates and inherits its following loads', () => {
  const entry = { sets: [makeSideSet({ r: 8, w: 20 }), makeSideSet({ r: 8, w: 20 })] }
  entry.sets[0].sides.L.heartRate = { token: 'capture' }
  entry.sets[0].sides.L.at = 123
  setWorkoutField(entry, 0, 'w', 30, 'L')
  expect(entry.sets[0].sides.L).toMatchObject({ w: 30, weightOrigin: 'manual', at: 123, heartRate: { token: 'capture' }, done: false })
  expect(entry.sets[1].sides.L.w).toBe(30)
  expect(entry.sets.map(s => s.sides.R.w)).toEqual([20, 20])
  setWorkoutField(entry, 0, 'r', 6, 'L')
  expect(entry.sets[0].r).toBe(10)
  expect(entry.sets[0].sides.R.r).toBe(4)
  entry.sets[0] = toggleSide(entry.sets[0], 'L')
  expect(entry.sets[0].sides.L).toMatchObject({ done: true, at: 123, heartRate: { token: 'capture' } })
})
