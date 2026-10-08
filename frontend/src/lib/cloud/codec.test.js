import { describe, it, expect } from 'vitest'
import { DEF } from '../../store/state-defaults.js'
import { fixtureState, fixtureEnvelope } from './test-fixtures.js'
import { makeOwner, makeEnvelope, FIELD_POLICY } from './model.js'
import { encodeState, decodeState, prepareOperation, mergeOperation, mergeLocalDraft, applyConfirmation } from './codec.js'
import { stampChange, mergeDeletions } from '../sync-merge.js'
import { editCompletedSession, saveWorkoutEdit } from '../session-edit.js'
import { EXIDX, isAssisted } from '../exercises.js'

const owner = makeOwner('demo-opengym', 'test-user')
const options = { ownerKey: owner.ownerKey, generation: 1, unitVersion: 1 }
const control = { schemaVersion: 1, generation: 1, dataRevision: 1, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
const encode = s => encodeState(s, options).documents
const decode = documents => decodeState(documents, { defaults: DEF, generation: 1 })
const change = (before, edit, opId = 'op-1') => {
  const after = structuredClone(before)
  edit(after)
  after._ts = stampChange(before, after, 100)
  return [after, prepareOperation(before, after, { ...options, kind: 'update', opId })]
}
const merge = (state, op) => mergeOperation(encode(state), op, { control, domainContext: { remoteProfile: { control, documents: encode(state) }, remoteState: state } })
const workout = (id, w) => ({ id, d: '2026-10-07', start: 1, end: 100, entries: [{ id: '0025', sets: [{ w, r: 5, done: true }], target: { mode: 'reps' } }] })

describe('granular cloud codec', () => {
  it('classifies defaults and restores every synchronized family and optional setting', () => {
    expect(Object.keys(DEF).filter(k => !(k in FIELD_POLICY))).toEqual([])
    const s = fixtureState({ accentCustom: '#123456', showRir: true, vibrate: false, classicChime: true,
      week: { 1: 'a' }, dayPlan: { '2026-10-08': ['a'] }, routines: [{ id: 'a', name: 'A', ex: [] }],
      workouts: [workout('w', 20)], bodyweight: [{ d: '2026-10-07', t: 4, w: 77.3 }],
      customEx: [{ id: 'c', n: 'Custom', eq: 'barbell' }], exWeights: { c: { w: 23, d: '2026-10-07' } },
      exNotes: { c: 'seat 4' }, favEx: ['c'], barWeights: { c: 10 }, loadKind: { c: { kind: 'single', _ts: 3 } },
      equipProfiles: [{ id: 'e', name: 'Home' }], gymCards: [{ id: 'g', value: '123' }],
      balanceOverrides: { 'a:b': { id: 'c', _ts: 2 } }, plates: { kg: { 20: 2, _ts: 4 } },
      rotation: { id: 'rot', sequence: ['a'] }, queue: { ids: ['a'] }, scheduleMode: 'rotation' })
    expect(decode(encode(s))).toMatchObject(s)
  })
  it('keys corrections by date and safely roundtrips arbitrary entity IDs', () => {
    const s = fixtureState({ routines: ['a/b', '..', 'ação🦾', '__proto__'].map(id => ({ id, ex: [] })), bodyweight: [{ d: '2026-10-07', t: 1, w: 80 }] })
    expect(Object.keys(encode(s))).toContain('bodyweight/2026-10-07')
    expect(Object.keys(encode(s)).filter(p => p.startsWith('routines/')).every(p => p.split('/').length === 2)).toBe(true)
    expect(decode(encode(s)).routines).toEqual(s.routines)
    const [, op] = change(s, n => { n.bodyweight[0] = { d: '2026-10-07', t: 2, w: 79 } })
    expect(op.paths).toEqual(['bodyweight/2026-10-07'])
    expect(decode({ ...encode(s), ...merge(s, op).documentsToWrite }).bodyweight).toEqual([{ d: '2026-10-07', t: 100, w: 79 }])
  })
  it('keeps media, device state and media stamps only in the local overlay', () => {
    const s = fixtureState({ active: { id: 'active' }, coach: { token: 'private' }, _rev: 55, resetIds: { workouts: ['old'] },
      customEx: [{ id: 'c', n: 'C', media: { hash: 'private-hash' }, img: 'file://private-photo', _f: { n: 5, media: 6, img: 7 }, _u: { media: { at: 6, base: 1 }, n: { at: 5, base: 1 } } }],
      workouts: [{ ...workout('w', 20), media: [{ hash: 'private-video' }] }] })
    const { documents, localOverlay } = encodeState(s, options)
    const wire = JSON.stringify(documents)
    for (const secret of ['private', '"active"', '_rev', 'resetIds', '"media"', '"img"']) expect(wire).not.toContain(secret)
    const back = decodeState(documents, { defaults: DEF, generation: 1, localOverlay })
    expect(back.active).toEqual(s.active)
    expect(back.coach).toEqual(s.coach)
    expect(back.customEx).toEqual(s.customEx)
    expect(back.workouts).toEqual(s.workouts)
  })
  it('retains stamps, Undo and document tombstones and excludes inactive generations', () => {
    const s = fixtureState({ edited: { sound: 9 }, undone: { sound: { at: 9, base: 2 } }, routines: [{ id: 'r', ex: [], _ts: 10, _f: { ex: 10 }, _u: { ex: { at: 10, base: 2 } } }], deleted: { workouts: { gone: 20 }, favEx: { c: 11 } } })
    expect(decode(encode(s))).toMatchObject(s)
    expect(Object.values(encode(s)).some(r => r.deletedAt === 20)).toBe(true)
    expect(decodeState(encode(s), { defaults: DEF, generation: 2 }).routines).toEqual([])
  })
  it('converts every numeric payload without gym rounding and preserves source documents', () => {
    const s = fixtureState({ targetW: 72.1234, bodyweight: [{ d: '2026-10-07', w: 72.1234, t: 1 }], exWeights: { x: { w: 12.345 } }, barWeights: { x: 12.345 }, routines: [{ id: 'r', ex: [{ weight: 12.345, inc: 1.234 }] }], workouts: [workout('w', 12.345)] })
    const docs = encode(s), frozen = structuredClone(docs)
    const lb = decodeState(docs, { defaults: DEF, generation: 1, displayUnit: 'lb' })
    expect(lb.bodyweight[0].w).toBeCloseTo(72.1234 * 2.2046226218, 10)
    expect(lb.routines[0].ex[0].weight).toBeCloseTo(12.345 * 2.2046226218, 10)
    expect(lb.workouts[0].entries[0].sets[0].w).toBeCloseTo(12.345 * 2.2046226218, 10)
    expect(decodeState(encode(lb), { defaults: DEF, generation: 1, displayUnit: 'kg' }).exWeights.x.w).toBeCloseTo(12.345, 10)
    expect(docs).toEqual(frozen)
  })
  it('sends only affected records and returns null for local-only changes', () => {
    const s = fixtureState({ workouts: Array.from({ length: 20 }, (_, i) => workout(`w${i}`, 20)) })
    const [, op] = change(s, n => { n.sound = false })
    expect(op.paths).toEqual(['settings/sound'])
    expect(Object.keys(op.payloads)).toEqual(op.paths)
    expect(JSON.stringify(op)).not.toContain('w19')
    expect(change(s, n => { n.active = { id: 'a' } })[1]).toBeNull()
  })
  it('keeps the lower assistance PR and lowers a corrected historical typo', () => {
    const assisted = Object.values(EXIDX).find(isAssisted).id
    const s = fixtureState({ exWeights: { [assisted]: { w: 40 } } })
    const [, op] = change(s, n => { n.exWeights[assisted] = { w: 20 } })
    expect(decode({ ...encode(s), ...merge(s, op).documentsToWrite }).exWeights[assisted].w).toBe(20)
    const before = fixtureState({ workouts: [workout('typo', 1000), workout('other', 80)], exWeights: { '0025': { w: 1000, d: '2026-10-07' } } })
    const [next, correction] = change(before, n => { editCompletedSession(n, 'typo'); n.active.entries[0].sets[0].w = 50; saveWorkoutEdit(n, 90) })
    expect(next.exWeights['0025'].w).toBe(80)
    const result = merge(before, correction)
    expect(decode({ ...encode(before), ...result.documentsToWrite }).exWeights['0025'].w).toBe(80)
    expect(merge(before, correction)).toEqual(result)
    expect(mergeOperation({ ...encode(before), ...result.documentsToWrite }, correction, { control, domainContext: { remoteProfile: { control, documents: { ...encode(before), ...result.documentsToWrite } }, remoteState: next } }).documentsToWrite).toEqual({})
  })
  it('blocks unsafe document sizes and nesting without losing the local payload', () => {
    const s = fixtureState()
    const [next, op] = change(s, n => { n.exNotes.x = 'é'.repeat(500000) })
    expect(op.blockedReason).toContain('document-too-large')
    expect(op.blockedReason).toContain('exerciseState/')
    expect(Object.values(op.payloads)[0].payload.exNotes).toBe(next.exNotes.x)
    let deep = {}; for (let i = 0; i < 24; i++) deep = { child: deep }
    expect(change(s, n => { n.wc = deep })[1].blockedReason).toContain('invalid-document')
  })
  it('refuses stale generation, unit versions and mismatched owners', () => {
    const [, op] = change(fixtureState(), n => { n.targetW = 80 })
    expect(() => mergeOperation({}, op, { control: { ...control, generation: 2 } })).toThrow(/generation/)
    expect(() => mergeOperation({}, op, { control: { ...control, unitVersion: 2 } })).toThrow(/unit/)
    const envelope = fixtureEnvelope()
    expect(() => applyConfirmation(envelope, { ownerKey: 'someone-else', opId: op.opId, control, documents: {} })).toThrow(/owner/)
  })
  it('merges stale tab drafts and applies old confirmations without clearing newer edits', () => {
    const previous = fixtureState(), [a, old] = change(previous, n => { n.sound = false }, 'op-old')
    let envelope = mergeLocalDraft(makeEnvelope(owner, previous), { previous, next: a, operation: old })
    const [b, newer] = change(a, n => { n.sound = true }, 'op-new')
    envelope = mergeLocalDraft(envelope, { previous: a, next: b, operation: newer })
    const [c, parallel] = change(previous, n => { n.workouts.push(workout('parallel', 20)) }, 'op-parallel')
    envelope = mergeLocalDraft(envelope, { previous, next: c, operation: parallel })
    envelope = applyConfirmation(envelope, { ownerKey: owner.ownerKey, opId: old.opId, control, documents: merge(previous, old).confirmedDocuments })
    expect(envelope.pendingOperations.map(x => x.opId)).toEqual(['op-new', 'op-parallel'])
    expect(envelope.state.sound).toBe(true)
    expect(envelope.state.workouts.map(w => w.id)).toEqual(['parallel'])
    expect(envelope.localRevision).toBe(4)
  })
  it('retains an unmigrated workout locally and blocks upload until a stable ID is assigned', () => {
    const legacy = { d: '2026-10-01', start: 20, entries: [] }
    const s = fixtureState({ workouts: [legacy] })
    const encoded = encodeState(s, options)
    expect(decodeState(encoded.documents, { defaults: DEF, generation: 1, localOverlay: encoded.localOverlay }).workouts).toEqual([legacy])
    const op = prepareOperation(fixtureState(), s, { ...options, kind: 'import', opId: 'legacy' })
    expect(op.blockedReason).toBe('invalid-document:workouts:missing-id')
    expect(() => merge(s, op)).toThrow(/missing-id/)
  })
  it('sends a new workout without inventing an exercise load, and deletes with a tombstone', () => {
    const before = fixtureState()
    const [next, op] = change(before, n => { n.workouts.push(workout('new', 20)) })
    expect(op.blockedReason).toBeNull()
    expect(decode({ ...encode(before), ...merge(before, op).documentsToWrite }).workouts).toEqual(next.workouts)
    const [removed, del] = change(next, n => { n.workouts = [] })
    const result = merge(next, del)
    const after = decode({ ...encode(next), ...result.documentsToWrite })
    expect(after.workouts).toEqual([])
    expect(after.deleted.workouts.new).toBe(removed.deleted.workouts.new)
    const stale = mergeOperation({ ...encode(next), ...result.documentsToWrite }, op, { control, domainContext: { remoteProfile: { control, documents: { ...encode(next), ...result.documentsToWrite } }, remoteState: removed } })
    expect(decode({ ...encode(next), ...result.documentsToWrite, ...stale.documentsToWrite }).workouts).toEqual([])
  })
  it('merges simultaneous field edits of the same routine without losing either edit', () => {
    const before = fixtureState({ routines: [{ id: 'r', name: 'Original', ex: [{ id: '0025', weight: 20 }] }] })
    const [, op] = change(before, n => { n.routines[0].name = 'Renamed' })
    const [remote] = change(before, n => { n.routines[0].ex[0].weight = 30 })
    const after = decode({ ...encode(remote), ...merge(remote, op).documentsToWrite })
    expect(after.routines[0]).toMatchObject({ name: 'Renamed', ex: [{ weight: 30 }] })
  })
  it('retains a blocked newer local payload when an earlier confirmation arrives', () => {
    const before = fixtureState()
    const [first, op] = change(before, n => { n.exNotes.x = 'first' }, 'first')
    let envelope = mergeLocalDraft(makeEnvelope(owner, before), { previous: before, next: first, operation: op })
    const [next, blocked] = change(first, n => { n.exNotes.x = '�'.repeat(500000) }, 'blocked')
    envelope = mergeLocalDraft(envelope, { previous: first, next, operation: blocked })
    const result = applyConfirmation(envelope, { ownerKey: owner.ownerKey, opId: op.opId, control, documents: merge(before, op).confirmedDocuments })
    expect(result.state.exNotes.x.length).toBe(500000)
    expect(result.pendingOperations[0].blockedReason).toContain('document-too-large')
  })
  it('retains the current local session and changed media through stale tab drafts', () => {
    const before = fixtureState({ workouts: [workout('w', 10)] })
    const current = fixtureEnvelope({ state: { ...before, active: { id: 'live' } } })
    const [next, op] = change(before, n => { n.workouts[0].media = [{ hash: 'mine' }] })
    const merged = mergeLocalDraft(current, { previous: before, next, operation: op })
    expect(merged.state.active).toEqual({ id: 'live' })
    expect(merged.state.workouts[0].media).toEqual([{ hash: 'mine' }])
  })

  it('uses custom assistance metadata from domain context without registering global exercises', () => {
    const before = fixtureState({ customEx: [{ id: 'custom-assist', n: 'Assistance', assisted: true }], exWeights: { 'custom-assist': { w: 20 } } })
    const [, op] = change(before, n => { n.exWeights['custom-assist'] = { w: 40 } })
    expect(decode({ ...encode(before), ...merge(before, op).documentsToWrite }).exWeights['custom-assist'].w).toBe(20)
    expect(EXIDX['custom-assist']).toBeUndefined()
  })
  it('normalizes mixed units before comparing PRs, with no serialization rounding', () => {
    const before = fixtureState({ exWeights: { '0025': { w: 20.1234 } } })
    const [, op] = change(before, n => { n.exWeights['0025'] = { w: 21.1234 } })
    const remote = fixtureState({ unit: 'lb', exWeights: { '0025': { w: 45 } } })
    const result = merge(remote, op)
    expect(decode({ ...encode(remote), ...result.documentsToWrite }).exWeights['0025'].w).toBeCloseTo(21.1234 * 2.2046226218, 10)
  })
  it('keeps no-ID recovery entries once during a local draft merge', () => {
    const before = fixtureState({ workouts: [{ d: '2026-10-01', start: 20, entries: [] }] })
    const [next, op] = change(before, n => { n.sound = false })
    const result = mergeLocalDraft(makeEnvelope(owner, before), { previous: before, next, operation: op })
    expect(result.state.workouts).toHaveLength(1)
    expect(result.pendingOperations[0].blockedReason).toContain('missing-id')
  })
  it('applies field removal stamps and later restoration while preserving a tombstone', () => {
    const before = fixtureState({ exNotes: { x: 'old' }, routines: [{ id: 'r', name: 'R', ex: [] }] })
    const [deleted, op] = change(before, n => { delete n.exNotes.x; n.routines = [] })
    const result = merge(before, op)
    expect(decode({ ...encode(before), ...result.documentsToWrite }).exNotes).toEqual({})
    const [restored, restore] = change(deleted, n => { n.routines = [{ id: 'r', name: 'Back', ex: [] }] })
    expect(decode({ ...encode(deleted), ...merge(deleted, restore).documentsToWrite }).routines[0].name).toBe('Back')
    expect(restored.deleted.routines.r).toBeLessThan(0)
  })

  it('does not revive an old record after more than 5000 unrelated remote tombstones', () => {
    const before = fixtureState({ routines: [{ id: 'old', name: 'Old', ex: [] }] })
    const [, op] = change(before, n => { n.routines[0].name = 'Offline' })
    const remote = fixtureState({ deleted: { routines: { old: 200, ...Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`other-${i}`, 300 + i])) } } })
    const result = merge(remote, op)
    expect(decode({ ...encode(remote), ...result.documentsToWrite }).routines).toEqual([])
    expect(Object.values(result.confirmedDocuments).find(r => r.payload.id === 'old').deletedAt).toBe(200)
  })
  it('keeps active and local media through a remote acknowledgement', () => {
    const before = fixtureState({ workouts: [workout('w', 10)] })
    const [next, op] = change(before, n => { n.sound = false })
    const envelope = fixtureEnvelope({ state: { ...next, active: { id: 'live' }, workouts: [{ ...next.workouts[0], media: [{ hash: 'local' }] }] }, pendingOperations: [op] })
    const result = applyConfirmation(envelope, { ownerKey: owner.ownerKey, opId: op.opId, control, documents: merge(before, op).confirmedDocuments })
    expect(result.state.active).toEqual({ id: 'live' })
    expect(result.state.workouts[0].media).toEqual([{ hash: 'local' }])
  })

  it('keeps local field removals and media removals from an actual edit', () => {
    const before = fixtureState({ coach: { token: 'local' }, customEx: [{ id: 'c', n: 'C', img: 'file://photo', _f: { n: 3, img: 4 } }] })
    const [next, op] = change(before, n => { delete n.coach; delete n.customEx[0].img })
    const result = mergeLocalDraft(makeEnvelope(owner, before), { previous: before, next, operation: op })
    expect(result.state.coach).toBeUndefined()
    expect(result.state.customEx[0].img).toBeUndefined()
    expect(result.state.customEx[0]._f.n).toBe(3)
  })

  it('preserves every affected tombstone in a large operation while legacy callers keep their cap', () => {
    const ids = Array.from({ length: 5002 }, (_, i) => `r-${i}`)
    const before = fixtureState({ routines: ids.map(id => ({ id, name: 'Original', ex: [] })) })
    const [, op] = change(before, n => { for (const r of n.routines) r.name = 'Offline' })
    const deletions = Object.fromEntries(ids.map((id, i) => [id, 200 + i]))
    const remote = fixtureState({ deleted: { routines: deletions } })
    const result = merge(remote, op)
    expect(decode({ ...encode(remote), ...result.documentsToWrite }).routines).toEqual([])
    expect(Object.values(result.confirmedDocuments).filter(r => r.deletedAt != null)).toHaveLength(5002)
    expect(mergeDeletions({ routines: deletions }, {}).routines['r-0']).toBeUndefined()
    expect(mergeDeletions({ routines: deletions }, {}).routines['r-5001']).toBe(5201)
  })
  it('does not treat legacy deletion-map eviction as an explicit restoration', () => {
    const before = fixtureState({ deleted: { routines: { old: 100 } } })
    const next = fixtureState({ sound: false, _ts: 200, edited: { sound: 200 } })
    const op = prepareOperation(before, next, { ...options, kind: 'update', opId: 'evicted' })
    const result = merge(before, op)
    const restored = decode({ ...encode(before), ...result.documentsToWrite })
    expect(restored.routines).toEqual([])
    expect(restored.deleted.routines.old).toBe(100)
  })

  it('corrects a remote kept load even when the editing device had no exerciseState record', () => {
    const before = fixtureState({ workouts: [workout('typo', 1000)] })
    const [, op] = change(before, n => { editCompletedSession(n, 'typo'); n.active.entries[0].sets[0].w = 50; saveWorkoutEdit(n, 90) })
    const remote = fixtureState({ ...before, exWeights: { '0025': { w: 1000, d: '2026-10-07' } }, exNotes: { '0025': 'remote note' }, favEx: ['0025'], barWeights: { '0025': 20 }, loadKind: { '0025': { kind: 'pairs', _ts: 5 } }, edited: { 'exNotes.0025': 5, 'barWeights.0025': 5 }, deleted: { favEx: { '0025': -5 } } })
    const result = merge(remote, op)
    const after = decode({ ...encode(remote), ...result.documentsToWrite })
    expect(after.exWeights['0025'].w).toBe(50)
    expect(after.exNotes['0025']).toBe('remote note')
    expect(after.favEx).toEqual(['0025'])
    expect(after.barWeights['0025']).toBe(20)
    expect(after.loadKind['0025']).toEqual({ kind: 'pairs', _ts: 5 })
    expect(after.deleted.favEx['0025']).toBe(-5)
  })

})
