/* Retained pure merge/add-back and backup metadata regressions from the retired server parity file. */
import { describe, expect, it } from 'vitest'

import { highestStamp, mergeDeletions, mergeEdits, mergeStates, stampChange, stampEntry, stampEdits, stampRestore } from './sync-merge.js'

const clone = v => JSON.parse(JSON.stringify(v))
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }

describe('a removal and an add-back with the same stamp', () => {
  // QA round 2 (2026-10-06): two phones lifted their clocks from one highest stamp, so one's Undo
  // (-H-2) and the other's removal (+H-2) tied, and the first argument won: the device (local
  // first) and the server (stored first) kept opposite records.
  const H = 1_800_000_000_000
  it('merges the same in either order, on both sides: the add-back wins', () => {
    const a = { routines: { R: -(H + 2) } }, b = { routines: { R: H + 2 } }
    for (const f of [mergeDeletions]) {
      expect(f(a, b)).toEqual({ routines: { R: -(H + 2) } })
      expect(f(b, a)).toEqual({ routines: { R: -(H + 2) } })
    }
  })
  it('the routine put back with Undo is kept whichever phone merges first', () => {
    const R = { id: 'R', name: 'Push', ex: [], _ts: H - 10 }
    const base = { _ts: H, unit: 'kg', workouts: [], routines: [R], week: { 1: ['R'] } }
    const A = { ...clone(base), routines: [{ ...R, _ts: H + 2 }], deleted: { routines: { R: -(H + 2) } } }
    const B = { ...clone(base), routines: [], week: {}, deleted: { routines: { R: H + 2 } } }
    const ab = mergeStates(A, B), ba = mergeStates(B, A)
    expect(ab.deleted).toEqual(ba.deleted)
    expect(ab.routines.map(r => r.id)).toEqual(['R'])
    expect(ba.routines.map(r => r.id)).toEqual(['R'])
  })
})

describe('the write ids are no setting', () => {
  it('neither a change nor a restored backup stamps them', () => {
    const prev = { _ts: 1, _wid: 'a', _wids: ['x'], restSec: 90 }
    const next = { ...clone(prev), _wid: 'b', _wids: ['x', 'a'] }
    expect(stampEdits(prev, next, 5).edited).toBeUndefined()
    expect(Object.keys(stampRestore({ _wid: 'b', _wids: ['a'], restSec: 60 }, [], 9).edited)).not.toContain('_wid')
  })
})

