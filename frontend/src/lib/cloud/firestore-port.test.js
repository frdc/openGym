import * as jobs from './sync-jobs.js'
import { describe, it, expect } from 'vitest'
import { createFirestorePort } from './firestore-port.js'
import * as codec from './codec.js'
import { fixtureState, fakeRemote } from './test-fixtures.js'
import { makeOwner } from './model.js'
import { stampChange } from '../sync-merge.js'
import { createSyncBridge } from './sync-bridge.js'
import { createFsStorage } from './offline-fs.js'
import { fakeFilesystem } from './test-fixtures.js'

const owner = makeOwner('demo-opengym', 'A')
const initialControl = () => ({ schemaVersion: 1, generation: 1, dataRevision: 0, unitVersion: 1, activeUnitJob: null, lastResetOpId: null })
const root = 'users/A/apps/opengym'
function harness(control = initialControl()) {
  const rows = new Map(control ? [[root, control]] : []), commits = []
  let failure, onQuery, retries = 0, queryCount = 0, listener
  const snap = path => ({ id: path.split('/').at(-1), exists: () => rows.has(path), data: () => structuredClone(rows.get(path)), metadata: { fromCache: false, hasPendingWrites: false } })
  const sdk = {
    doc: (_, path) => path, collection: (_, path) => path,
    where: (...args) => ({ where: args }), orderBy: () => ({}), documentId: () => '__name__', limit: n => ({ limit: n }), startAfter: s => ({ after: s.id }),
    query: (path, ...constraints) => ({ path, constraints }),
    async getDocFromServer(path) { if (failure) throw failure; return snap(path) },
    async getDocsFromServer({ path, constraints }) {
      if (failure) throw failure
      queryCount++; onQuery?.(queryCount)
      const generation = constraints.find(c => c.where)?.where[2], after = constraints.find(c => c.after)?.after || '', n = constraints.find(c => c.limit)?.limit || Infinity
      const docs = [...rows.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1 && (generation === undefined || rows.get(p).generation === generation) && p.split('/').at(-1) > after).sort().slice(0, n).map(snap)
      return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } }
    },
    async runTransaction(_, callback) {
      const execute = async save => { const writes = []; let writing = false; const result = await callback({
        async get(path) { if (writing) throw new Error('read-after-write'); return snap(path) },
        delete(path) { writing = true; writes.push([path, undefined]) },
        set(path, data) { writing = true; writes.push([path, structuredClone(data)]) },
      }); if (save) { for (const [p, d] of writes) (d === undefined ? rows.delete(p) : rows.set(p, d)); commits.push(writes) } return result }
      for (let n = 0; n < retries; n++) await execute(false)
      return execute(true)
    },
    onSnapshot(_, options, next, error) { listener = { next, error }; return () => {} },
  }
  const client = { app: { options: { projectId: owner.projectId } }, auth: { app: { options: { projectId: owner.projectId } }, currentUser: { uid: owner.uid } }, db: { app: { options: { projectId: owner.projectId } } } }
  return { rows, commits, client, sdk, remote: createFirestorePort({ client, codec, sdk }), fail(error) { failure = error }, onQuery(fn) { onQuery = fn }, retry(n) { retries = n }, get queryCount() { return queryCount }, emit() { listener.next(snap(root)) } }
}
function operation() {
  const before = fixtureState(), after = fixtureState({ workouts: [{ id: 'w1', d: '2026-10-07', entries: [{ id: '0025', sets: [{ w: 20, r: 5, done: true }] }] }], queue: { ids: ['r'] } })
  after._ts = stampChange(before, after, 100)
  return codec.prepareOperation(before, after, { ownerKey: owner.ownerKey, opId: 'op-1', generation: 1, unitVersion: 1, kind: 'finish-workout' })
}
const context = profile => ({ expectedControl: profile.control, domainContext: { remoteProfile: profile, remoteState: codec.decodeState(profile.documents) } })

describe('blocked import isolation through the actual port and native envelope backend', () => {
  for (const kind of ['invalid-path', 'document-too-large']) it(`${kind} retains its source across reopen while independent writes progress`, async () => {
    const h = harness(), filesystem = fakeFilesystem()
    let storage = createFsStorage(filesystem), status, bridge
    async function open() {
      bridge = createSyncBridge({ storage, remote: h.remote, onStatus: value => { status = value } })
      await bridge.bindAuth({ owner, user: { uid: owner.uid }, authEpoch: 1 }); await bridge.syncNow()
    }
    await open()
    const badId = kind === 'invalid-path' ? 'b'.repeat(1126) : 'huge'
    const backup = fixtureState({ routines: [{ id: 'neighbor', name: 'Retained neighbor', ex: [] }], workouts: [{ id: badId, d: '2026-10-08', entries: [], note: kind === 'document-too-large' ? 'x'.repeat(930000) : 'Retained full source' }] })
    await bridge.importBackup(backup, { mode: 'merge' })
    const imported = await storage.read(owner.ownerKey), jobId = imported.pendingJobs[0].jobId
    const path = `workouts/${Buffer.from(badId).toString('base64url')}`
    async function edit(change) {
      const previous = (await storage.read(owner.ownerKey)).state, next = structuredClone(previous)
      change(next); next._ts = stampChange(previous, next, Date.now())
      await bridge.recordChange({ previous, next, scheduleRemote: false })
    }
    // A write overlap and an explicitly injected read dependency must both wait.
    await edit(s => { s.routines[0].name = 'Pending dependent edit' })
    await edit(s => { s.accentCustom = '#123456' })
    await storage.commit(owner.ownerKey, value => ({ ...value, pendingOperations: value.pendingOperations.map(op => op.paths.includes('settings/accentCustom') ? { ...op, readPaths: ['routines/bmVpZ2hib3I'] } : op) }))
    await edit(s => { s.accentCustom = '#abcdef' }) // Must not overtake the preceding blocked read.
    await edit(s => { s.bodyweight.push({ d: '2026-10-08', w: 83.2 }); s.classicChime = true })
    const footprint = imported.pendingJobs[0].parts.flatMap(part => part.paths)
    expect(footprint).not.toContain('settings/accentCustom')
    expect(footprint).not.toContain('settings/classicChime')
    expect(footprint).not.toContain('bodyweight/2026-10-08')
    await bridge.syncNow()
    expect(h.rows.get(`${root}/bodyweight/2026-10-08`)?.payload.w).toBe(83.2)
    expect(h.rows.get(`${root}/settings/classicChime`)?.payload.value).toBe(true)
    expect(h.rows.has(`${root}/settings/accentCustom`)).toBe(false)
    expect(status).toMatchObject({ local: 'saved', cloud: 'blocked', cloudError: { code: kind, path } })
    let saved = await storage.read(owner.ownerKey)
    expect(saved.pendingOperations).toHaveLength(3)
    expect(saved.pendingJobs[0]).toMatchObject({ jobId, status: 'blocked', blockedReason: `${kind}:${path}` })
    expect(saved.pendingJobs[0].source.workouts[0]).toMatchObject(backup.workouts[0])
    expect(saved.pendingJobs[0].parts.every(part => part.status === 'pending')).toBe(true)
    const retained = structuredClone(saved.pendingJobs[0]), debt = saved.pendingOperations.map(op => op.opId)
    await bridge.unbindAuth(); storage = createFsStorage(filesystem); await open()
    saved = await storage.read(owner.ownerKey)
    expect(saved.pendingJobs[0]).toEqual(retained)
    expect(saved.pendingOperations.map(op => op.opId)).toEqual(debt)
    expect(status.cloud).toBe('blocked')
    expect(h.rows.get(`${root}/bodyweight/2026-10-08`)?.payload.w).toBe(83.2)
    await bridge.unbindAuth()
  // The near-limit source is repeatedly encoded and persisted through recovery slots.
  // Allow slower CI runners to finish without relaxing any of the isolation assertions.
  }, kind === 'document-too-large' ? 30000 : 5000)
  for (const code of ['invalid-document', 'invalid-control', 'invalid-job', 'permission-denied', 'unavailable', 'generation-mismatch', 'unit-job-active']) it(`does not isolate an unattributed ${code} from remote job processing`, async () => {
    const h = harness(), storage = createFsStorage(fakeFilesystem())
    let status
    const bridge = createSyncBridge({ storage, remote: h.remote, onStatus: value => { status = value } })
    await bridge.bindAuth({ owner, user: { uid: owner.uid }, authEpoch: 1 }); await bridge.syncNow()
    h.remote.beginJob = async () => { throw Object.assign(new Error(`${code}:routines/bmVpZ2hib3I`), { code, path: 'routines/bmVpZ2hib3I' }) }
    await bridge.importBackup(fixtureState({ routines: [{ id: 'neighbor', name: 'Source', ex: [] }] }), { mode: 'merge' })
    const previous = (await storage.read(owner.ownerKey)).state, next = { ...previous, bodyweight: [{ d: '2026-10-08', w: 83.2 }] }
    next._ts = stampChange(previous, next, Date.now())
    await bridge.recordChange({ previous, next, scheduleRemote: false }); await bridge.syncNow()
    const saved = await storage.read(owner.ownerKey)
    expect(saved.pendingJobs[0].blockedReason).toBeUndefined()
    expect(saved.pendingOperations).toHaveLength(1)
    expect(h.rows.has(`${root}/bodyweight/2026-10-08`)).toBe(false)
    expect(status.cloudError.code).toBe(code)
    await bridge.unbindAuth()
  })
  it('never attributes malformed remote records to the import source even at the same path', async () => {
    const h = harness(), state = fixtureState({ routines: [{ id: 'neighbor', name: 'Valid local source', ex: [] }] })
    const encoded = codec.encodeState(state, initialControl())
    const job = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'import', opId: 'corrupt-remote', paths: ['routines/bmVpZ2hib3I'], payloads: encoded.documents, options: { sourceVersion: 1, targetVersion: 1 } })
    await h.remote.beginJob(owner, job)
    h.rows.set(`${root}/routines/bmVpZ2hib3I`, { ...encoded.documents['routines/bmVpZ2hib3I'], payload: null })
    const error = await h.remote.commitJobPart(owner, job, job.parts[0]).catch(value => value)
    expect(error).toMatchObject({ code: 'invalid-document', path: 'routines/bmVpZ2hib3I' })
    expect(error.importSource).toBeUndefined()
  })
})

describe('isolated Firestore transport', () => {
  it('never initializes control after an unavailable server read', async () => {
    const h = harness(null); h.fail(Object.assign(new Error('offline'), { code: 'unavailable' }))
    await expect(h.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'unavailable' })
    expect(h.commits).toHaveLength(0)
  })
  it('initializes only confirmed missing control and never overwrites existing control', async () => {
    const h = harness(null), profile = await h.remote.readProfileFromServer(owner)
    expect(profile).toEqual({ control: initialControl(), documents: {} })
    expect(h.commits.flat().map(([p]) => p)).toEqual([root])
  })
  it('retries a changing query and rejects a continuously changing revision', async () => {
    const h = harness(); h.onQuery(n => { if (n === 1) h.rows.get(root).dataRevision++ })
    expect((await h.remote.readProfileFromServer(owner)).control.dataRevision).toBe(1)
    expect(h.queryCount).toBeGreaterThan(12)
    const unstable = harness(); unstable.onQuery(() => unstable.rows.get(root).dataRevision++)
    await expect(unstable.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'refresh-required' })
  })
  it('rejects unsupported and corrupt remote data instead of treating it as empty', async () => {
    for (const bad of [{ schemaVersion: 2 }, { ...codec.encodeState(fixtureState(), initialControl()).documents['settings/unit'], payload: null }]) {
      const h = harness(); h.rows.set(root + '/settings/unit', { generation: 1, ...bad })
      await expect(h.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'invalid-document' })
      expect(h.commits).toHaveLength(0)
    }
    const h = harness({ ...initialControl(), schemaVersion: 2 })
    await expect(h.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'invalid-control' })
  })
  it('requires current domain history revision before committing', async () => {
    const h = harness(), profile = await h.remote.readProfileFromServer(owner)
    h.rows.get(root).dataRevision++
    await expect(h.remote.commitOperation(owner, operation(), context(profile))).rejects.toMatchObject({ code: 'refresh-required' })
    expect(h.commits).toHaveLength(0)
  })
  it('commits workout, progression and plan atomically; retry/replay never duplicates', async () => {
    const h = harness(), profile = await h.remote.readProfileFromServer(owner); h.retry(2)
    const result = await h.remote.commitOperation(owner, operation(), context(profile))
    expect(result.control.dataRevision).toBe(1)
    expect(h.commits[0].map(([p]) => p)).toEqual(expect.arrayContaining([root, root + '/workouts/dzE', root + '/exerciseState/MDAyNQ', root + '/plans/main']))
    expect(h.commits.flat().every(([p]) => p === root || p.startsWith(root + '/'))).toBe(true)
    const before = h.queryCount, fresh = await h.remote.readProfileFromServer(owner)
    expect(h.queryCount).toBe(before)
    const replay = await h.remote.commitOperation(owner, operation(), context(fresh))
    expect(replay.control.dataRevision).toBe(1)
    expect(h.commits.at(-1)).toEqual([])
    expect(codec.decodeState(fresh.documents).workouts).toHaveLength(1)
  })
  it('refuses wrong auth identity, project, owner key, unsafe paths and oversized documents', async () => {
    const h = harness(), profile = await h.remote.readProfileFromServer(owner)
    for (const badOwner of [makeOwner('demo-opengym', 'B'), makeOwner('other-project', 'A'), { ...owner, ownerKey: 'forged' }]) await expect(h.remote.readProfileFromServer(badOwner)).rejects.toMatchObject({ code: 'owner-mismatch' })
    for (const path of ['../evil', 'workouts/a/b', 'jobs/a', 'settings/active', 'plans/other']) {
      const op = operation(); op.paths.push(path); op.payloads[path] = op.payloads['plans/main']
      await expect(h.remote.commitOperation(owner, op, context(profile))).rejects.toMatchObject({ code: 'invalid-path' })
    }
    const op = operation(); op.payloads['plans/main'].payload.queue = 'x'.repeat(930000)
    await expect(h.remote.commitOperation(owner, op, context(profile))).rejects.toMatchObject({ code: 'document-too-large' })
    expect(h.commits).toHaveLength(0)
  })
  it('resets generation atomically and only accepts replay of the same reset', async () => {
    const h = harness(), reset = { opId: 'reset-1', baseGeneration: 1, nextGeneration: 2 }
    expect(await h.remote.commitReset(owner, reset)).toMatchObject({ generation: 2, dataRevision: 1, lastResetOpId: 'reset-1' })
    expect(await h.remote.commitReset(owner, reset)).toMatchObject({ generation: 2, dataRevision: 1 })
    await expect(h.remote.commitReset(owner, { ...reset, opId: 'different' })).rejects.toMatchObject({ code: 'generation-mismatch' })
  })
  it('suppresses late control callbacks after unsubscribe or auth changes', () => {
    const h = harness(), events = [], errors = []
    const stop = h.remote.watchControl(owner, c => events.push(c), e => errors.push(e))
    h.emit(); stop(); h.emit()
    expect(events).toHaveLength(1)
    h.remote.watchControl(owner, c => events.push(c), e => errors.push(e)); h.client.auth.currentUser = { uid: 'B' }; h.emit()
    expect(events).toHaveLength(1); expect(errors[0].code).toBe('owner-mismatch')
  })
})

describe('transport boundary regressions', () => {
  it('reads every page and refreshes after another device changes control', async () => {
    const h = harness(), record = codec.encodeState(fixtureState({ routines: [{ id: 'r', ex: [] }] }), initialControl()).documents['routines/cg']
    for (let i = 0; i < 205; i++) h.rows.set(`${root}/routines/id${String(i).padStart(3, '0')}`, { ...record, payload: { id: `r${i}`, ex: [] } })
    const first = await h.remote.readProfileFromServer(owner)
    expect(Object.keys(first.documents)).toHaveLength(205)
    h.rows.set(root + '/routines/remote', { ...record, payload: { id: 'other-device', ex: [] } }); h.rows.get(root).dataRevision++
    const second = await h.remote.readProfileFromServer(owner)
    expect(Object.keys(second.documents)).toHaveLength(206)
    expect(second.control.dataRevision).toBe(1)
  })
  it('rejects malformed singleton payloads rather than decoding silently to defaults', async () => {
    for (const payload of [{ value: 'stone' }, { value: 'kg', unknown: true }]) {
      const h = harness(), rec = codec.encodeState(fixtureState(), initialControl()).documents['settings/unit']
      h.rows.set(root + '/settings/unit', { ...rec, payload })
      await expect(h.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'invalid-document' })
    }
  })
  it('refuses a client whose Auth or Firestore belongs to another project', async () => {
    for (const key of ['auth', 'db']) {
      const h = harness(); h.client[key].app = { options: { projectId: 'different-project' } }
      await expect(h.remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'owner-mismatch' })
    }
  })
  it('rejects deeply nested pending records with the affected path', async () => {
    const h = harness(), profile = await h.remote.readProfileFromServer(owner), op = operation()
    let nested = {}; for (let i = 0; i < 22; i++) nested = { child: nested }
    op.payloads['plans/main'].payload.queue = nested
    await expect(h.remote.commitOperation(owner, op, context(profile))).rejects.toMatchObject({ code: 'invalid-document', path: 'plans/main' })
    expect(h.commits).toHaveLength(0)
  })
})

describe('coordinator remote double contract', () => {
  it('supports the default codec, revisions, failures, retries and deliberately late callbacks', async () => {
    const remote = fakeRemote({ control: initialControl(), documents: {} }), events = []
    const profile = await remote.readProfileFromServer(owner)
    remote.repeatTransaction(3); remote.delayCallbacks()
    const stop = remote.watchControl(owner, c => events.push(c), () => {})
    const result = await remote.commitOperation(owner, operation(), context(profile))
    expect(result.control.dataRevision).toBe(1)
    expect(remote.transactions).toHaveLength(1)
    stop(); remote.deliverCallbacks(); expect(events).toHaveLength(1)
    remote.failNext(Object.assign(new Error('offline'), { code: 'unavailable' }))
    await expect(remote.readProfileFromServer(owner)).rejects.toMatchObject({ code: 'unavailable' })
    const fresh = await remote.readProfileFromServer(owner)
    const replay = await remote.commitOperation(owner, operation(), context(fresh))
    expect(replay.control.dataRevision).toBe(1)
    await expect(remote.readProfileFromServer(makeOwner('demo-opengym', 'B'))).rejects.toMatchObject({ code: 'owner-mismatch' })
  })
})


it('preserves an existing empty control and rejects a future-generation affected record', async () => {
  const h = harness({ ...initialControl(), generation: 3, dataRevision: 7 })
  const existing = await h.remote.readProfileFromServer(owner)
  expect(existing.control).toMatchObject({ generation: 3, dataRevision: 7 }); expect(h.commits).toEqual([])
  const current = harness(), profile = await current.remote.readProfileFromServer(owner), op = operation()
  current.rows.set(root + '/workouts/dzE', { ...op.payloads['workouts/dzE'], generation: 2 })
  await expect(current.remote.commitOperation(owner, op, context(profile))).rejects.toMatchObject({ code: 'invalid-document', path: 'workouts/dzE' })
})

it('remote double uses transport error codes and full control barriers', async () => {
  const remote = fakeRemote({ control: initialControl(), documents: {} }), profile = await remote.readProfileFromServer(owner), op = operation()
  const stale = structuredClone(profile); stale.control.unitVersion = 2
  await expect(remote.commitOperation(owner, op, context(stale))).rejects.toMatchObject({ code: 'refresh-required' })
  remote.replaceProfile({ control: { ...initialControl(), activeUnitJob: 'job' }, documents: {} })
  const busy = await remote.readProfileFromServer(owner)
  await expect(remote.commitOperation(owner, op, context(busy))).rejects.toMatchObject({ code: 'unit-job-active' })
  await expect(remote.commitReset(owner, { opId: 'r', baseGeneration: 1, nextGeneration: 2 })).rejects.toMatchObject({ code: 'unit-job-active' })
})

describe('resumable remote jobs', () => {
  it('freezes unit changes before staging, reconstructs interrupted staging on another device, and replays each transformation once', async () => {
    const h = harness(), documents = codec.encodeState(fixtureState({ exWeights: Object.fromEntries(Array.from({ length: 42 }, (_, i) => [`e${i}`, 20.1])) }), initialControl()).documents
    for (const [path, record] of Object.entries(documents)) h.rows.set(`${root}/${path}`, record)
    const profile = await h.remote.readProfileFromServer(owner)
    const job = jobs.planUnitJob({ profile, ownerKey: owner.ownerKey, to: 'lb', opId: 'u1' })
    const transaction = h.sdk.runTransaction; let calls = 0
    h.sdk.runTransaction = (...args) => { if (++calls === 3) throw Object.assign(new Error('offline'), { code: 'unavailable' }); return transaction(...args) }
    await expect(h.remote.beginJob(owner, job)).rejects.toMatchObject({ code: 'unavailable' })
    expect(h.rows.get(root).activeUnitJob).toBe(job.jobId)
    const other = createFirestorePort({ client: h.client, sdk: h.sdk })
    const found = (await other.readJobs(owner)).find(j => j.jobId === job.jobId)
    expect(found.preparedParts).toBeLessThan(found.totalParts)
    const frozen = await other.readProfileFromServer(owner)
    const resumed = jobs.resumeUnitPlan(found, frozen)
    await other.beginJob(owner, resumed)
    const first = await other.commitJobPart(owner, resumed, resumed.parts[0])
    expect(first.transformedEntities.length).toBeGreaterThan(0)
    expect((await other.commitJobPart(owner, resumed, resumed.parts[0])).transformedEntities).toEqual([])
    for (const part of resumed.parts.slice(1)) await other.commitJobPart(owner, resumed, part)
    expect(await other.finishJob(owner, resumed)).toMatchObject({ unitVersion: 2, activeUnitJob: null })
    const state = codec.decodeState((await other.readProfileFromServer(owner)).documents)
    expect(state.exWeights.e0).toBe(44.5)
    expect(state.unit).toBe('lb')
  })
  it('uses a complete current history barrier for import parts and retains completed markers for replay', async () => {
    const h = harness(), op = operation()
    const job = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'import', opId: 'i1', paths: op.paths,
      options: { sourceVersion: 1, targetVersion: 1 }, payloads: op.payloads })
    await h.remote.beginJob(owner, job)
    for (const part of job.parts) await h.remote.commitJobPart(owner, job, part)
    await h.remote.finishJob(owner, job)
    expect((await h.remote.commitJobPart(owner, job, job.parts[0])).transformedEntities).toEqual([])
    expect(codec.decodeState((await h.remote.readProfileFromServer(owner)).documents).workouts).toHaveLength(1)
    expect(h.rows.get(`${root}/jobs/${job.jobId}`)).not.toHaveProperty('payloads')
  })
  it('deletes only retired generation records and preserves an ID recreated after reset', async () => {
    const h = harness(), record = operation().payloads['workouts/dzE']
    h.rows.set(`${root}/workouts/dzE`, record)
    await h.remote.commitReset(owner, { opId: 'reset', baseGeneration: 1, nextGeneration: 2 })
    h.rows.set(`${root}/workouts/recreated`, { ...record, generation: 2 })
    await h.remote.deleteOldGeneration(owner, { generation: 1, paths: ['workouts/dzE', 'workouts/recreated'] })
    expect(h.rows.has(`${root}/workouts/dzE`)).toBe(false)
    expect(h.rows.get(`${root}/workouts/recreated`).generation).toBe(2)
  })
})

it('blocks a now-oversized import part after remote growth without discarding its local source', async () => {
  const h = harness(), source = codec.encodeState(fixtureState({ routines: Array.from({ length: 20 }, (_, i) => ({ id: `grown${i}`, ex: [] })) }), initialControl()).documents
  const paths = Object.keys(source).filter(path => path.startsWith('routines/'))
  const job = jobs.createJob({ ownerKey: owner.ownerKey, generation: 1, kind: 'import', opId: 'growth', paths, payloads: source, options: { sourceVersion: 1, targetVersion: 1 } })
  await h.remote.beginJob(owner, job)
  for (const path of paths) h.rows.set(`${root}/${path}`, { ...source[path], payload: { ...source[path].payload, note: 'x'.repeat(500000) } })
  h.rows.get(root).dataRevision++
  const before = h.commits.length
  await expect(h.remote.commitJobPart(owner, job, job.parts[0])).rejects.toMatchObject({ code: 'job-part-too-large', path: expect.stringMatching(/^routines\//) })
  expect(h.commits).toHaveLength(before)
  expect(job.payloads[paths[0]]).toEqual(source[paths[0]])
})
it('enumerates bounded retired-generation cleanup pages without relying on the old local cache', async () => {
  const h = harness({ ...initialControl(), generation: 2 }), record = operation().payloads['workouts/dzE']
  for (let i = 0; i < 45; i++) h.rows.set(`${root}/workouts/retired${String(i).padStart(2, '0')}`, record)
  const first = await h.remote.readOldGenerationPaths(owner, { generation: 1 })
  expect(first).toHaveLength(20)
  h.rows.set(`${root}/${first[0]}`, { ...record, generation: 2 })
  await h.remote.deleteOldGeneration(owner, { generation: 1, paths: first })
  let pages = 1, paths
  while ((paths = await h.remote.readOldGenerationPaths(owner, { generation: 1 })).length) {
    expect(paths.length).toBeLessThanOrEqual(20)
    await h.remote.deleteOldGeneration(owner, { generation: 1, paths }); pages++
  }
  expect(pages).toBe(3)
  expect(h.rows.get(`${root}/${first[0]}`).generation).toBe(2)
  expect(h.rows.size).toBe(2)
  await expect(h.remote.readOldGenerationPaths(owner, { generation: 2 })).rejects.toMatchObject({ code: 'generation-mismatch' })
})


it('bounded bulk parts retain full validated workout correction context without writing contextual paths', async () => {
  const h = harness(), w = { id: 'corrected', d: '2026-10-08', _ts: 1, entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }], target: { mode: 'reps' } }] }
  const before = fixtureState({ workouts: [w], exWeights: { '0025': { w: 80, d: w.d } } })
  for (const [path, record] of Object.entries(codec.encodeState(before, initialControl()).documents)) h.rows.set(`${root}/${path}`, record)
  const source = structuredClone(before); source.workouts[0]._ts = 10; source.workouts[0].note = 'n'.repeat(400000); source.workouts[0].entries[0].sets[0].w = 40; source.exWeights['0025'].w = 40
  const job = jobs.bulkAdmissionJob({ ownerKey: owner.ownerKey, state: before, cloudGeneration: 1, lastConfirmedControl: initialControl(), remoteMetadataByPath: {} }, source, { opId: 'bulk-correction', sourceKind: 'recovery' })
  expect(job.totalParts).toBeGreaterThan(1)
  await h.remote.beginJob(owner, job)
  for (const part of job.parts) {
    const count = h.commits.length
    await h.remote.commitJobPart(owner, job, part)
    const domainWrites = h.commits.slice(count).flat().map(([path]) => path.slice(root.length + 1)).filter(path => !path.startsWith('jobs/') && path)
    expect(domainWrites.every(path => part.paths.includes(path))).toBe(true)
  }
  await h.remote.finishJob(owner, job)
  expect(codec.decodeState((await h.remote.readProfileFromServer(owner)).documents).exWeights['0025'].w).toBe(40)
  expect(h.rows.get(`${root}/jobs/${job.jobId}`)).not.toHaveProperty('sourceKind')
  expect(h.rows.get(`${root}/jobs/${job.jobId}`)).not.toHaveProperty('payloads')
})
it('rejects a bulk contextual record outside the admitted part union before creating a manifest', async () => {
  const h = harness(), source = fixtureState({ targetW: 80 })
  const job = jobs.bulkAdmissionJob({ ownerKey: owner.ownerKey, state: fixtureState(), cloudGeneration: 1, lastConfirmedControl: initialControl(), remoteMetadataByPath: {} }, source, { opId: 'invalid-context', sourceKind: 'recovery' })
  job.payloads['settings/restSec'] = codec.encodeState(fixtureState(), initialControl()).documents['settings/restSec']
  await expect(h.remote.beginJob(owner, job)).rejects.toMatchObject({ code: 'invalid-job' })
  expect(h.commits).toHaveLength(0)
})

it.each([false,true])('bulk context/replay preserves newer concurrent workout correction (custom assistance=%s)',async assisted=>{
  const h=harness(),id=assisted?'private-assist':'0025',oldWeight=assisted?20:80,newWeight=assisted?60:30
  const w={id:'history',d:'2026-10-08',_ts:1,entries:[{id,sets:[{w:oldWeight,r:5,done:true}],target:{mode:'reps'}}]}
  const before=fixtureState({workouts:[w],customEx:assisted?[{id,n:'My assistance',assisted:true,custom:true}]:[],exWeights:{[id]:{w:oldWeight,d:w.d}}})
  for(const [path,record] of Object.entries(codec.encodeState(before,initialControl()).documents))h.rows.set(`${root}/${path}`,record)
  const source=structuredClone(before);source.workouts[0]._ts=10;source.workouts[0].note='n'.repeat(400000);source.workouts[0].entries[0].sets[0].w=40;source.exWeights[id].w=40
  const job=jobs.bulkAdmissionJob({ownerKey:owner.ownerKey,state:before,cloudGeneration:1,lastConfirmedControl:initialControl(),remoteMetadataByPath:{}},source,{opId:`source-${assisted}`,sourceKind:'recovery'})
  await h.remote.beginJob(owner,job);await h.remote.commitJobPart(owner,job,job.parts[0])
  expect(codec.decodeState((await h.remote.readProfileFromServer(owner)).documents).exWeights[id].w).toBe(40)
  const current=await h.remote.readProfileFromServer(owner),previous=codec.decodeState(current.documents),next=structuredClone(previous)
  next.workouts[0].entries[0].sets[0].w=newWeight;next.workouts[0]._ts=20;next.exWeights[id].w=newWeight;next._ts=stampChange(previous,next,20)
  const newer=codec.prepareOperation(previous,next,{ownerKey:owner.ownerKey,opId:'newer',generation:1,unitVersion:1,kind:'edit'})
  await h.remote.commitOperation(owner,newer,context(current))
  const reopened=createFirestorePort({client:h.client,sdk:h.sdk})
  for(const part of job.parts)await reopened.commitJobPart(owner,job,part)
  await reopened.finishJob(owner,job)
  const received=codec.decodeState((await reopened.readProfileFromServer(owner)).documents)
  expect(received.workouts[0].entries[0].sets[0].w).toBe(newWeight)
  expect(received.exWeights[id].w).toBe(newWeight)
})
it.each(['generation','unitVersion','payload'])('validates a contextual %s error even outside the first part',async field=>{
  const h=harness(),source=fixtureState({targetW:80,workouts:[{id:'later',d:'2026-10-08',entries:[],note:'n'.repeat(400000)}]})
  const job=jobs.bulkAdmissionJob({ownerKey:owner.ownerKey,state:fixtureState(),cloudGeneration:1,lastConfirmedControl:initialControl(),remoteMetadataByPath:{}},source,{opId:`invalid-${field}`,sourceKind:'adoption'})
  const path=job.parts.at(-1).paths.at(-1)
  if(field==='payload')job.payloads[path].payload.note='n'.repeat(930000);else job.payloads[path][field]=99
  await expect(h.remote.beginJob(owner,job)).rejects.toMatchObject({code:field==='payload'?'document-too-large':'invalid-document',path,importSource:true})
  expect(h.commits).toHaveLength(0)
})
