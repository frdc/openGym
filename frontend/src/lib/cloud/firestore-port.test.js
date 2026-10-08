import { describe, it, expect } from 'vitest'
import { createFirestorePort } from './firestore-port.js'
import * as codec from './codec.js'
import { fixtureState, fakeRemote } from './test-fixtures.js'
import { makeOwner } from './model.js'
import { stampChange } from '../sync-merge.js'

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
      const docs = [...rows.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1 && rows.get(p).generation === generation && p.split('/').at(-1) > after).sort().slice(0, n).map(snap)
      return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } }
    },
    async runTransaction(_, callback) {
      const execute = async save => { const writes = []; let writing = false; const result = await callback({
        async get(path) { if (writing) throw new Error('read-after-write'); return snap(path) },
        set(path, data) { writing = true; writes.push([path, structuredClone(data)]) },
      }); if (save) { for (const [p, d] of writes) rows.set(p, d); commits.push(writes) } return result }
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
