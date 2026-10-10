import { it, expect } from 'vitest'
import { buildHeartRate } from './heart-rate.js'
it('separates effort from recovery and uses real nearest milestone samples', () => {
  const m = buildHeartRate({ startedAt: 1000, effortEndMs: 10000, recoveryEndMs: 75000, points: [[0,100],[10000,150],[39000,120],[71000,110]] })
  expect(m.effort).toEqual({ count: 2, mean: 125, peak: 150 })
  expect(m.recovery.count).toBe(2)
  expect(m.milestones).toEqual([{ seconds:30, atMs:39000, bpm:120, delta:30 }, { seconds:60, atMs:71000, bpm:110, delta:40 }])
})
it('never invents zero readings or recovery outside the boundary', () => {
  expect(buildHeartRate({ startedAt:1, effortEndMs:10, recoveryEndMs:20, points:[[21,180]] }).status).toBe('empty')
})
it('bounds plotted points while computing all-sample statistics', () => {
  const m = buildHeartRate({ startedAt:1, effortEndMs:999, recoveryEndMs:1000, points:Array.from({length:1000},(_,i)=>[i,i===333?200:100]) })
  expect(m.points.length).toBeLessThanOrEqual(300)
  expect(m.points).toContainEqual([333,200]); expect(m.effort.count).toBe(1000)
  expect(m.points[0]).toEqual([0,100]);expect(m.points.at(-1)).toEqual([999,100])
})
it('rejects equal-count summary values that disagree with real samples',()=>{
  expect(()=>buildHeartRate({startedAt:1,effortEndMs:1000,points:[[0,100],[1000,150]],effort:{count:2,mean:25,peak:250}})).toThrow('invalid-heart-summary')
})
