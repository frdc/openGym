import { describe, it, expect } from 'vitest'
import { projectStandalone, applyStandalone, reconcileStandaloneTimer } from './wear-standalone.js'
import { makeSideSet } from './workout-model.js'

const session = 'session-token'
const fixture = () => ({ unit: 'kg', restSec: 90, active: { id: 'workout', cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ r: 10, w: 60, done: false }, { r: 10, w: 60, done: false }] }] } })
const event = (seq, action, step = 0, patch = {}) => ({ seq, id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, action, at: 100000 + seq * 1000, step, ...patch })
const command = (S, events, patch = {}) => ({ v: 1, action: 'standalone-sync', requestId: events.at(-1).id, contextToken: session, streamId: 'stream', baseline: projectStandalone(S, session).baseline, events, ...patch })

describe('standalone projection', () => {
  it('projects every remaining side and superset round with phone rest rules without changing state', () => {
    const S = fixture(), first = S.active.entries[0]
    first.sg = 'pair'; first.target.restSec = 120
    first.sets = [makeSideSet({ r: 10, w: 60 }), makeSideSet({ r: 10, w: 60 })]
    S.active.entries.push({ id: '0026', sg: 'pair', sets: [{ r: 8, w: 20 }, { r: 8, w: 20 }] })
    const before = structuredClone(S), result = projectStandalone(S, session)
    expect(result.steps.map(s => [s.entryIdx, s.setIdx, s.side, s.restAfterSec])).toEqual([
      [0, 0, 'L', 0], [0, 0, 'R', 0], [1, 0, null, 120],
      [0, 1, 'L', 0], [0, 1, 'R', 0], [1, 1, null, 0],
    ])
    expect(S).toEqual(before)
    expect(result).toMatchObject({ v: 1, sessionId: session, cursor: 0, ack: null, runtime: { effort: null, timer: null } })
  })
  it('honors warmup rest, the last warmup into work, and no rest before the next warmup', () => {
    const S = fixture(); S.active.entries[0].target = { warmupRestSec: 30, restSec: 120 }
    S.active.entries[0].sets = [{ r: 10, warmup: true }, { r: 10, warmup: true }, { r: 10 }]
    S.active.entries.push({ id: '0026', sets: [{ r: 8, warmup: true }, { r: 8 }] })
    expect(projectStandalone(S, session).steps.map(s => s.restAfterSec)).toEqual([30, 120, 0, 90, 0])
    S.restSec = 0; delete S.active.entries[0].target.restSec; delete S.active.entries[0].target.warmupRestSec
    expect(projectStandalone(S, session).steps.every(s => s.restAfterSec === 0)).toBe(true)
  })
  it('keeps unsupported steps visible and refuses excessive or historical workouts', () => {
    const S = fixture(); S.active.entries[0].sets[1].type = 'dropset'
    expect(projectStandalone(S, session).steps.map(s => s.canComplete)).toEqual([true, false])
    S.active.entries[0].sets = Array.from({ length: 201 }, () => ({ r: 8 }))
    expect(projectStandalone(S, session)).toBeNull()
    S.active.backfill = true; expect(projectStandalone(S, session)).toBeNull()
  })
})

describe('standalone import', () => {
  it('acknowledges an already saved batch after adding an exercise without reapplying or losing that exercise', () => {
    const S = fixture(), batch = command(S, [event(1, 'start'), event(2, 'complete')])
    const applied = applyStandalone(S, batch, session)
    applied.active.entries.push({ id: '0026', sets: [{ r: 12, w: 20, done: false }] })
    expect(applyStandalone(applied, batch, session)).toBe(applied)
    expect(applied.active.entries[1].sets[0]).toMatchObject({ r: 12, done: false })
    const receipt = projectStandalone(applied, session).receipt
    expect(receipt).toEqual({ streamId: 'stream', baseline: batch.baseline, seq: 2, requestId: event(2, 'complete').id })
  })
  it('persists a phone rest seed so an offline pause can replay against it', () => {
    const S = fixture(), timer = { timerToken: 'phone-rest', endsAt: 160000, leftMs: 90000, paused: false, ready: false }
    const seeded = reconcileStandaloneTimer(S, timer, session, 100000)
    expect(S.active._wearStandaloneTimer).toBeUndefined()
    expect(projectStandalone(seeded, session).runtime.timer).toEqual(timer)
    const applied = applyStandalone(seeded, command(seeded, [event(1, 'pause')]), session)
    expect(projectStandalone(applied, session)).toMatchObject({ ack: { seq: 1 }, runtime: { timer: { paused: true, leftMs: 59000 } } })
    const continued = applyStandalone(applied, command(applied, [event(2, 'resume')]), session)
    expect(projectStandalone(continued, session).runtime.timer).toMatchObject({ paused: false, endsAt: 161000 })
  })
  it('changes the baseline for phone timer edits while ignoring countdown ticks and natural expiry', () => {
    const S = fixture(), timer = { timerToken: 'phone-rest', endsAt: 160000, leftMs: 90000, paused: false, ready: false }
    const seeded = reconcileStandaloneTimer(S, timer, session, 100000)
    expect(reconcileStandaloneTimer(seeded, { ...timer, leftMs: 85000 }, session, 105000)).toBe(seeded)
    expect(reconcileStandaloneTimer(seeded, { ...timer, leftMs: 0, ready: true }, session, 170000)).toBe(seeded)
    expect(reconcileStandaloneTimer(seeded, null, session, 170000)).toBe(seeded)
    const pending = command(seeded, [event(1, 'pause')])
    const skipped = reconcileStandaloneTimer(seeded, null, session, 110000)
    expect(projectStandalone(skipped, session).baseline).not.toBe(pending.baseline)
    expect(() => applyStandalone(skipped, pending, session)).toThrow('baseline-conflict')
    const changed = reconcileStandaloneTimer(seeded, { ...timer, endsAt: 175000, leftMs: 105000 }, session, 110000)
    expect(() => applyStandalone(changed, pending, session)).toThrow('baseline-conflict')
  })
  it('caps extended rest at the phone timer maximum', () => {
    const S = fixture(); S.restSec = 900
    const applied = applyStandalone(S, command(S, [event(1, 'start'), event(2, 'complete'), event(3, 'plus15', 1)]), session)
    expect(applied.active._wearStandalone.runtime.timer).toMatchObject({ leftMs: 900000, endsAt: 1003000 })
  })
  it('replays edits, effort pauses, completions and rest once across a restart', () => {
    const S = fixture(), events = [event(1, 'start'), event(2, 'edit-set', 0, { field: 'w', value: 62.5, unit: 'kg' }), event(3, 'pause-effort'), event(4, 'resume-effort'), event(5, 'complete'), event(6, 'pause', 1), event(7, 'plus15', 1)]
    const batch = command(S, events), applied = applyStandalone(S, batch, session)
    expect(S.active.entries[0].sets[0].done).toBe(false)
    expect(applied.active.entries[0].sets).toMatchObject([{ done: true, w: 62.5, at: 105000 }, { done: false, w: 62.5 }])
    expect(applied.active._wearStandalone).toMatchObject({ cursor: 1, runtime: { effort: null, timer: { timerToken: events[4].id, paused: true, leftMs: 104000 } } })
    const restarted = JSON.parse(JSON.stringify(applied))
    expect(applyStandalone(restarted, batch, session)).toBe(restarted)
    expect(projectStandalone(restarted, session)).toMatchObject({ cursor: 1, baseline: batch.baseline, ack: { streamId: 'stream', seq: 7 } })
    expect(projectStandalone(restarted, session).steps[1].loadValue).toBe(62.5)
  })
  it('rejects changed phone state, sessions, streams and reused event identities atomically', () => {
    const S = fixture(), batch = command(S, [event(1, 'start'), event(2, 'complete')])
    const applied = applyStandalone(S, batch, session), before = structuredClone(applied)
    for (const bad of [
      { ...batch, events: [event(2, 'complete', 0, { at: 999999 })] },
      { ...batch, streamId: 'other' },
      { ...batch, events: [event(4, 'start', 1)] },
      { ...batch, contextToken: 'wrong' },
    ]) expect(() => applyStandalone(applied, bad, session)).toThrow()
    expect(applied).toEqual(before)
    const modified = structuredClone(applied); modified.active.entries[0].sets[1].r = 12
    expect(() => applyStandalone(modified, { ...batch, requestId: event(3, 'start', 1).id, events: [event(3, 'start', 1)] }, session)).toThrow('state-conflict')
    expect(() => applyStandalone(S, batch, 'replacement')).toThrow('stale-context')
  })
  it('requires an effort for completion and preserves earlier steps when a later event is invalid', () => {
    const S = fixture(), before = structuredClone(S)
    expect(() => applyStandalone(S, command(S, [event(1, 'complete')]), session)).toThrow()
    expect(() => applyStandalone(S, command(S, [event(1, 'start'), event(2, 'edit-set', 0, { field: 'r', value: 1.5 })]), session)).toThrow()
    expect(S).toEqual(before)
  })
  it('refreshes edited display values without changing original step indexes', () => {
    const S = fixture(), applied = applyStandalone(S, command(S, [event(1, 'edit-set', 0, { field: 'r', value: 12 }), event(2, 'edit-set', 0, { field: 'w', value: 62.5, unit: 'kg' })]), session)
    const projected = projectStandalone(applied, session)
    expect(projected.steps[0]).toMatchObject({ setIdx: 0, repsValue: 12, loadValue: 62.5 })
    expect(projected.steps[0].repsLabel).toContain('12')
    expect(projected.steps[1].loadLabel).toContain('62.5')
  })
  it('permits a new stream only against a fresh baseline after phone changes', () => {
    const S = fixture(), applied = applyStandalone(S, command(S, [event(1, 'start'), event(2, 'complete')]), session)
    applied.active.entries[0].sets[1].r = 12
    const fresh = projectStandalone(applied, session)
    expect(fresh.ack).toBeNull()
    const batch = command(applied, [event(1, 'start')], { streamId: 'new-stream' })
    const resumed = applyStandalone(applied, batch, session)
    expect(resumed.active._wearStandalone.cursor).toBe(0)
    expect(resumed.active._wearStandalone.steps[0].setIdx).toBe(1)
  })
  it('rejects gaps, oversized batches, changed ids, stale units and attempts to pass unsupported work', () => {
    const S = fixture()
    for (const events of [
      [event(1, 'start'), event(3, 'complete')],
      [event(1, 'start'), event(2, 'complete', 0, { id: event(1, 'start').id })],
      [event(1, 'start', 0, { id: '__proto__', heart: true })],
      [event(1, 'edit-set', 0, { field: 'w', value: 62.5, unit: 'lb' })],
      Array.from({ length: 65 }, (_, i) => event(i + 1, 'edit-set', 0, { field: 'r', value: 10 })),
    ]) expect(() => applyStandalone(S, command(S, events), session)).toThrow()
    S.active.entries[0].sets[0].type = 'dropset'
    expect(() => applyStandalone(S, command(S, [event(1, 'start')]), session)).toThrow('unsupported-set')
  })
  it('ignores heart metadata in conflict detection and retains each side completion', () => {
    const S = fixture(); S.active.entries[0].sets = [makeSideSet({ r: 8, w: 20 })]
    const batch = command(S, [event(1, 'start', 0, { heart: true }), event(2, 'complete')])
    const applied = applyStandalone(S, batch, session)
    expect(applied.active.entries[0].sets[0]).toMatchObject({ done: false, sides: { L: { done: true }, R: { done: false } } })
    applied.active.entries[0].sets[0].sides.L.heartRate = { startedAt: 101000, points: [[1, 90]] }
    const next = applyStandalone(applied, { ...batch, requestId: event(4, 'complete', 1).id, events: [event(3, 'start', 1), event(4, 'complete', 1)] }, session)
    expect(next.active.entries[0].sets[0].done).toBe(true)
    expect(next.active._wearStandalone.cursor).toBe(2)
  })
})
