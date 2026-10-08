import { describe, it, expect } from 'vitest'
import * as jobs from './sync-jobs.js'
import * as codec from './codec.js'
import { fixtureState, fakeRemote } from './test-fixtures.js'
import { makeOwner } from './model.js'
const owner = makeOwner('demo-opengym', 'jobs')
const control = { schemaVersion: 1, generation: 1, dataRevision: 0, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
const profile = state => ({ control, documents: codec.encodeState(state, control).documents })

describe('durable job protocol', () => {
  it('bounds parts by IDs and bytes while keeping the parent independent of source size', () => {
    const payloads = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`workouts/w${i}`, { payload: 'x'.repeat(100000) }]))
    const job = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'import', opId: 'import-1', paths: Object.keys(payloads), options: { sourceVersion: 1, targetVersion: 1 }, payloads })
    expect(job.parts.every(p => p.paths.length <= 20 && p.paths.reduce((n, key) => n + JSON.stringify(payloads[key]).length, 0) < 800000)).toBe(true)
    const manifest = jobs.jobManifest(job)
    expect(JSON.stringify(manifest).length).toBeLessThan(1000)
    expect(manifest).not.toHaveProperty('paths')
    expect(manifest).not.toHaveProperty('payloads')
  })
  it('uses deliberate gym rounding once, preserves plates and marks version together', () => {
    const source = profile(fixtureState({ exWeights: { e: 20.1 }, bodyweight: [{ d: '2026-10-08', w: 78.6 }], plates: { kg: { 20: 2 } } }))
    const job = jobs.planUnitJob({ profile: source, ownerKey: owner.ownerKey, to: 'lb', convert: true, opId: 'unit-1' })
    const path = Object.keys(source.documents).find(p => p.startsWith('exerciseState/'))
    const converted = jobs.transformUnitRecord(path, source.documents[path], job)
    expect(converted.payload.exWeights).toBe(44.5)
    expect(converted).toMatchObject({ dataUnit: 'lb', unitVersion: 2 })
    expect(jobs.transformUnitRecord(path, converted, job)).toEqual(converted)
    expect(job.parts.flatMap(p => p.paths)).not.toContain('plates/kg')
  })
  it('normalizes old queued values through retained conversion and relabel jobs in order only once', () => {
    const before = fixtureState({ targetW: 78.6 }), after = fixtureState({ targetW: 79 })
    let operation = codec.prepareOperation(before, after, { ownerKey: owner.ownerKey, generation: 1, unitVersion: 1, opId: 'edit', unitProvenance: 'confirmed' })
    operation.unitProvenance = 'confirmed'
    const a = jobs.planUnitJob({ profile: profile(before), ownerKey: owner.ownerKey, to: 'lb', opId: 'u1' })
    const b = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'unit', opId: 'u2', paths: [], options: { from: 'lb', to: 'kg', convert: false, sourceVersion: 2, targetVersion: 3 } })
    const normalized = jobs.normalizeOperation(operation, [b, a], 3)
    expect(normalized.payloads['settings/targetW']).toMatchObject({ payload: { value: 174.2 }, dataUnit: 'kg', unitVersion: 3 })
    expect(jobs.normalizeOperation(normalized, [a, b], 3)).toEqual(normalized)
    expect(() => jobs.normalizeOperation({ ...operation, unitProvenance: 'unproven' }, [a, b], 3)).toThrow('unit-provenance-unknown')
  })
  it('validates fake reset arguments before accepting replay', async () => {
    const remote = fakeRemote({ control: { ...control, generation: 2, lastResetOpId: 'r' }, documents: {} })
    await expect(remote.commitReset(owner, { opId: 'r', baseGeneration: 999, nextGeneration: 2 })).rejects.toMatchObject({ code: 'invalid-reset' })
  })
})

import { createSyncBridge } from './sync-bridge.js'
import { fakeStorage } from './test-fixtures.js'
import { makeEnvelope } from './model.js'
import { stampChange } from '../sync-merge.js'
const setupBridge = (state = fixtureState(), remote = fakeRemote(profile(state))) => {
  const storage = fakeStorage({ [owner.ownerKey]: { ...makeEnvelope(owner, state), lastConfirmedControl: control } })
  let n = 0
  const bridge = createSyncBridge({ storage, remote, newId: () => `job-${++n}` })
  return { bridge, remote, storage }
}
const bind = async bridge => { await bridge.bindAuth({ owner, user: { uid: owner.uid }, authEpoch: 1 }); await bridge.syncNow() }

describe('bridge durable jobs', () => {
  it('persists immutable reset intent before sending and ignores an old-generation late ACK in the same auth epoch', async () => {
    const { bridge, remote, storage } = setupBridge()
    await bind(bridge)
    let release, started
    const gate = new Promise(r => { release = r }), ready = new Promise(r => { started = r }), original = remote.commitOperation
    remote.commitOperation = async (...args) => { const result = await original(...args); started(); await gate; return result }
    const previous = (await storage.read(owner.ownerKey)).state, next = { ...previous, targetW: 99 }
    next._ts = stampChange(previous, next, 100)
    await bridge.recordChange({ previous, next, scheduleRemote: false })
    const sending = bridge.syncNow(); await ready
    const reset = remote.commitReset
    remote.commitReset = async (o, request) => {
      const saved = await storage.read(owner.ownerKey)
      expect(saved.pendingJobs.find(j => j.kind === 'reset').reset).toEqual(request)
      return reset(o, request)
    }
    await bridge.reset()
    release(); await sending
    const saved = await storage.read(owner.ownerKey)
    expect(saved.cloudGeneration).toBe(2)
    expect(saved.lastConfirmedControl.generation).toBe(2)
    expect(saved.state.targetW).toBe(fixtureState().targetW)
    expect(saved.recoveryCopies.length).toBeGreaterThan(0)
    await bridge.unbindAuth()
  })
  it('retains import source through interruption, restores active and legacy IDs, and resumes without duplication', async () => {
    const state = fixtureState({ active: { id: 'running', entries: [] } }), { bridge, remote, storage } = setupBridge(state)
    await bind(bridge)
    const original = remote.commitJobPart; let parts = 0
    remote.commitJobPart = async (...args) => { if (++parts === 2) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); return original(...args) }
    const backup = fixtureState({ workouts: Array.from({ length: 43 }, (_, i) => ({ d: '2026-10-08', start: i, entries: [] })) })
    await bridge.importBackup(backup, { mode: 'replace' })
    expect((await storage.read(owner.ownerKey)).pendingJobs[0].source.workouts).toHaveLength(43)
    await bridge.unbindAuth()
    const reload = createSyncBridge({ storage, remote }); await bind(reload)
    expect((await storage.read(owner.ownerKey)).pendingJobs).toEqual([])
    expect((await storage.read(owner.ownerKey)).state.active.id).toBe('running')
    expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).workouts).toHaveLength(43)
    await reload.unbindAuth()
  })
  it('labels edits made after local projection with target version and never converts them twice', async () => {
    const { bridge, remote, storage } = setupBridge(fixtureState({ targetW: 79 }))
    await bind(bridge)
    remote.failNext(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    await bridge.changeUnit('lb')
    const saved = await storage.read(owner.ownerKey), next = { ...saved.state, targetW: 180 }
    next._ts = stampChange(saved.state, next, 100)
    await bridge.recordChange({ previous: saved.state, next, scheduleRemote: false })
    expect((await storage.read(owner.ownerKey)).pendingOperations.at(-1).unitVersion).toBe(2)
    await bridge.syncNow()
    expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(180)
    await bridge.unbindAuth()
  })
})

import { stampRestore, stampReplace } from '../sync-merge.js'
it('explicit cloud restore preserves the complete deletion set while resurrecting only imported IDs', () => {
  const deleted = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`w${i}`, i + 1]))
  const restored = fixtureState({ workouts: [{ id: 'w0', entries: [] }] })
  stampRestore(restored, [{ deleted: { workouts: deleted } }], 5000, { retainAllDeletions: true })
  expect(Object.keys(restored.deleted.workouts)).toHaveLength(2500)
  expect(restored.deleted.workouts.w0).toBe(-5000)
  stampReplace(restored, [{ workouts: Array.from({ length: 2501 }, (_, i) => ({ id: `old${i}`, entries: [] })) }], 5001, { retainAllDeletions: true })
  expect(Object.keys(restored.deleted.workouts)).toHaveLength(5001)
})
it('blocks unproven first-sync numeric edits at a higher server version without applying historical relabel jobs', async () => {
  const remote = fakeRemote(profile(fixtureState({ targetW: 70 })))
  const unitJob = jobs.planUnitJob({ profile: await remote.readProfileFromServer(owner), ownerKey: owner.ownerKey, to: 'lb', convert: false, opId: 'old-relabel' })
  await remote.beginJob(owner, unitJob)
  for (const part of unitJob.parts) await remote.commitJobPart(owner, unitJob, part)
  await remote.finishJob(owner, unitJob)
  const storage = fakeStorage(), bridge = createSyncBridge({ storage, remote })
  await bridge.hydrate(owner)
  const previous = fixtureState(), next = fixtureState({ targetW: 80 })
  next._ts = stampChange(previous, next, 100)
  await bridge.recordChange({ previous, next, scheduleRemote: false })
  await bind(bridge)
  const saved = await storage.read(owner.ownerKey)
  expect(saved.pendingOperations[0]).toMatchObject({ blockedReason: 'unit-provenance-unknown', unitVersion: 1 })
  expect(saved.pendingOperations[0].payloads['settings/targetW']).toMatchObject({ dataUnit: 'kg', payload: { value: 80 } })
  expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(70)
  await bridge.unbindAuth()
})

it('unit jobs carry a compact last-part marker for atomic bounded progress', () => {
  const job = jobs.planUnitJob({ profile: profile(fixtureState()), ownerKey: owner.ownerKey, to: 'lb', opId: 'marker' })
  expect(jobs.jobManifest(job).lastPartId).toBe(null)
})
it('replace reconciles records observed after the preview instead of deleting late arrivals', async () => {
  const initial = fixtureState({ workouts: [{ id: 'old', d: '2026-10-08', entries: [] }] })
  const { bridge, remote, storage } = setupBridge(initial)
  await bind(bridge)
  const preview = { state: structuredClone(initial), rev: 0 }
  const later = fixtureState({ workouts: [...initial.workouts, { id: 'late', d: '2026-10-08', entries: [] }] })
  remote.replaceProfile({ ...profile(later), control: { ...control, dataRevision: 1 } })
  await bridge.readRemote()
  await bridge.importBackup(fixtureState(), { mode: 'replace', mergeWith: preview })
  expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).workouts.map(w => w.id)).toEqual(['late'])
  expect((await storage.read(owner.ownerKey)).state.workouts.map(w => w.id)).toEqual(['late'])
  await bridge.unbindAuth()
})

it('reports a paused job as unsynced even with no ordinary operation', async () => {
  const { bridge, remote } = setupBridge()
  await bind(bridge)
  remote.failNext(Object.assign(new Error('denied'), { code: 'permission-denied' }))
  await bridge.changeUnit('lb')
  expect(bridge.getUnsynced().count).toBeGreaterThan(0)
  expect(bridge.getUnsynced().blocked).toBeGreaterThan(0)
  await bridge.unbindAuth()
})
it('reconciles a confirmed offline queue through completed conversion and relabel history', async () => {
  const initial = fixtureState({ targetW: 79 }), { bridge, remote, storage } = setupBridge(initial)
  await bridge.hydrate(owner)
  const next = fixtureState({ targetW: 80 }); next._ts = stampChange(initial, next, 100)
  await bridge.recordChange({ previous: initial, next, scheduleRemote: false })
  for (const [to, convert, opId] of [['lb', true, 'chain1'], ['kg', false, 'chain2']]) {
    const job = jobs.planUnitJob({ profile: await remote.readProfileFromServer(owner), ownerKey: owner.ownerKey, to, convert, opId })
    await remote.beginJob(owner, job)
    for (const part of job.parts) await remote.commitJobPart(owner, job, part)
    await remote.finishJob(owner, job)
  }
  await bind(bridge)
  expect((await storage.read(owner.ownerKey)).pendingOperations).toEqual([])
  expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(176.4)
  await bridge.syncNow()
  expect((await storage.read(owner.ownerKey)).state.targetW).toBe(176.4)
  await bridge.unbindAuth()
})

it('imports a different backup unit through a conversion prelude without converting the backup or active twice', async () => {
  const initial = fixtureState({ exWeights: { e: 20.1 }, active: { id: 'active', entries: [{ id: 'e', sets: [{ w: 20.1, r: 2 }] }] } })
  const { bridge, remote, storage } = setupBridge(initial)
  await bind(bridge)
  await bridge.importBackup(fixtureState({ unit: 'lb', exWeights: { e: 50 } }), { mode: 'replace' })
  const state = (await storage.read(owner.ownerKey)).state
  expect(state.unit).toBe('lb')
  expect(state.active.entries[0].sets[0].w).toBe(44.5)
  expect(codec.decodeState((await remote.readProfileFromServer(owner)).documents).exWeights.e).toBe(50)
  await bridge.unbindAuth()
})

it('keeps an oversized import fully recoverable and identifies its exact blocked record', async () => {
  const { bridge, storage } = setupBridge()
  await bind(bridge)
  const note = 'x'.repeat(930000)
  await bridge.importBackup(fixtureState({ workouts: [{ id: 'huge', d: '2026-10-08', entries: [], note }] }), { mode: 'replace' })
  const job = (await storage.read(owner.ownerKey)).pendingJobs[0]
  expect(job.blockedReason).toMatch(/^document-too-large:workouts\//)
  expect(job.source.workouts[0].note).toBe(note)
  expect(job.payloads[job.blockedReason.slice('document-too-large:'.length)].payload.note).toBe(note)
  await bridge.unbindAuth()
})
it('unit transformation removes an old equipment default override instead of relabeling that default', () => {
  const source = profile(fixtureState({ unit: 'lb', barWeights: { '0025': 45 } }))
  const job = jobs.planUnitJob({ profile: source, ownerKey: owner.ownerKey, to: 'kg', opId: 'bars' })
  const path = Object.keys(source.documents).find(p => p.startsWith('exerciseState/'))
  expect(jobs.transformUnitRecord(path, source.documents[path], job).payload).not.toHaveProperty('barWeights')
})

it('a pending old-unit ACK cannot overwrite a projected unit before its migration starts', async () => {
  const { bridge, remote, storage } = setupBridge(fixtureState({ targetW: 79 }))
  await bind(bridge)
  let release, started
  const gate = new Promise(r => { release = r }), ready = new Promise(r => { started = r }), commit = remote.commitOperation
  remote.commitOperation = async (...args) => { const ack = await commit(...args); started(); await gate; return ack }
  const previous = (await storage.read(owner.ownerKey)).state, next = { ...previous, targetW: 80 }
  next._ts = stampChange(previous, next, 100)
  await bridge.recordChange({ previous, next, scheduleRemote: false })
  const sending = bridge.syncNow(); await ready
  const switching = bridge.changeUnit('lb')
  for (let i = 0; i < 30; i++) await Promise.resolve()
  expect((await storage.read(owner.ownerKey)).state.unit).toBe('lb')
  release(); await sending; await switching
  const saved = await storage.read(owner.ownerKey)
  expect(saved.state.targetW).toBe(176.4)
  expect(saved.state.unit).toBe('lb')
  expect(saved.pendingJobs).toEqual([])
  await bridge.unbindAuth()
})
it('an offline authenticated-owner reset remains pending across reload until server confirmation', async () => {
  const { bridge, remote, storage } = setupBridge(fixtureState({ targetW: 90 }))
  await bridge.hydrate(owner)
  await bridge.reset()
  expect((await storage.read(owner.ownerKey)).pendingJobs[0]).toMatchObject({ kind: 'reset', reset: { baseGeneration: 1, nextGeneration: 2 } })
  await bridge.unbindAuth()
  const reload = createSyncBridge({ storage, remote })
  await bind(reload)
  expect((await remote.readProfileFromServer(owner)).control.generation).toBe(2)
  expect((await storage.read(owner.ownerKey)).pendingJobs).toEqual([])
  await reload.unbindAuth()
})
it('part sizing accounts for large existing records as well as small replacement payloads', () => {
  const paths = Array.from({ length: 20 }, (_, i) => `routines/r${i}`)
  const payloads = Object.fromEntries(paths.map(p => [p, { payload: { id: p } }]))
  const referenceDocuments = Object.fromEntries(paths.map(p => [p, { payload: { note: 'x'.repeat(400000) } }]))
  const job = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'import', opId: 'bytes', paths, payloads, referenceDocuments, options: { sourceVersion: 1, targetVersion: 1 } })
  expect(job.parts.every(part => part.paths.length === 1)).toBe(true)
  expect(job.parts).toHaveLength(20)
})
