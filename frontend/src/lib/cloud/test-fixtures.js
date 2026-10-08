import { jobManifest, transformUnitRecord } from './sync-jobs.js'
import * as defaultCodec from './codec.js'
import { reduceEnvelope, validateEnvelope, validateOwnerKey } from './offline-store.js'
import { DEF } from '../../store/state-defaults.js'
import { makeEnvelope, makeOwner } from './model.js'

export const fixtureState = (overrides = {}) => structuredClone({ ...DEF, ...overrides })
export const fixtureEnvelope = (overrides = {}) => ({
  ...makeEnvelope(makeOwner('demo-opengym', 'test-user'), fixtureState()), ...structuredClone(overrides),
})

// A transaction-aware test double: readwrite transactions serialize and only publish
// their staged rows on completion. This is not browser IndexedDB validation.
export function fakeIndexedDB() {
  const rows = new Map()
  let tail = Promise.resolve(), failure = null
  const db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      let release, pending = 0, aborted = false, started = false, staged
      const ready = tail
      tail = new Promise(resolve => { release = resolve })
      const tx = { error: null, abort() { if (aborted) return; aborted = true; setTimeout(() => { tx.onabort?.(); release() }, 0) } }
      const finish = () => setTimeout(() => {
        if (pending || aborted) return
        if (failure) { tx.error = failure; failure = null; tx.abort(); return }
        rows.clear(); for (const [k, v] of staged) rows.set(k, v)
        tx.oncomplete?.(); release()
      }, 0)
      const request = fn => {
        pending++
        const req = {}
        ready.then(() => setTimeout(() => {
          if (aborted) return
          if (!started) { staged = new Map(structuredClone([...rows])); started = true }
          try { req.result = fn(); req.onsuccess?.() } catch (error) { req.error = error; tx.error = error; req.onerror?.(); tx.abort() }
          pending--; finish()
        }, 0))
        return req
      }
      tx.objectStore = () => ({ get: key => request(() => structuredClone(staged.get(key))), put: value => request(() => staged.set(value.ownerKey, structuredClone(value))) })
      return tx
    },
  }
  return { rows, failNextCommit(error) { failure = error }, open() { const request = { result: db }; setTimeout(() => request.onsuccess?.(), 0); return request } }
}

export function fakeFilesystem() {
  const files = new Map()
  let failure = null, transform = null
  const mod = { Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
    async readFile({ path }) { if (!files.has(path)) throw Object.assign(new Error('File does not exist'), { code: 'ENOENT' }); return { data: files.get(path) } },
    async writeFile({ path, data }) { if (failure) { const error = failure; failure = null; throw error } files.set(path, transform ? transform(data) : data); transform = null },
  } }
  return { files, mod, loadFilesystem: async () => mod, failNextWrite(error) { failure = error }, transformNextWrite(fn) { transform = fn } }
}

// Storage-level fake for coordinator tests: one serial commit stream per owner,
// detached reads/results, and only confirmed revisions in the public log.
export function fakeStorage(initial = {}) {
  const rows = new Map(Object.entries(structuredClone(initial))), pending = new Map(), listeners = new Map()
  const confirmedRevisions = []
  let failure = null
  return {
    async open() {},
    async read(ownerKey) {
      validateOwnerKey(ownerKey)
      const value = rows.get(ownerKey) ?? null
      if (value) validateEnvelope(value, ownerKey)
      return structuredClone(value)
    },
    commit(ownerKey, reducer) {
      const work = (pending.get(ownerKey) || Promise.resolve()).catch(() => {}).then(() => {
        if (failure) { const error = failure; failure = null; throw error }
        const next = reduceEnvelope(ownerKey, rows.get(ownerKey) ?? null, reducer)
        rows.set(ownerKey, structuredClone(next))
        confirmedRevisions.push({ ownerKey, localRevision: next.localRevision })
        for (const fn of listeners.get(ownerKey) || []) { try { fn(next.localRevision) } catch { /* observer isolation */ } }
        return structuredClone(next)
      })
      pending.set(ownerKey, work); work.catch(() => {})
      return work
    },
    async flush(ownerKey) { validateOwnerKey(ownerKey); await pending.get(ownerKey) },
    subscribe(ownerKey, fn) { validateOwnerKey(ownerKey); if (!listeners.has(ownerKey)) listeners.set(ownerKey, new Set()); listeners.get(ownerKey).add(fn); return () => listeners.get(ownerKey).delete(fn) },
    failNextCommit(error) { failure = error },
    confirmedRevisions,
  }
}

// Coordinator double only; permission/rules proofs live in check-firestore-rules.mjs.
export function fakeRemote(initialProfile, { codec = defaultCodec, ownerKey = null } = {}) {
  let profile = structuredClone(initialProfile), failure = null, repetitions = 1, delayed = false
  const transactions = [], listeners = new Set(), callbacks = [], jobs = new Map(), retired = new Map()
  const error = code => Object.assign(new Error(code), { code })
  const check = owner => { if (ownerKey === null) ownerKey = owner.ownerKey; if (owner.ownerKey !== ownerKey) throw error('owner-mismatch'); if (failure) { const e = failure; failure = null; throw e } }
  const notify = () => { for (const listener of listeners) { const value = structuredClone(profile.control), fn = () => listener.onControl(value); if (delayed) callbacks.push(fn); else fn() } }
  return {
    transactions,
    async readProfileFromServer(owner) { check(owner); return structuredClone(profile) },
    watchControl(owner, onControl, onError) { check(owner); const listener = { onControl, onError }; listeners.add(listener); return () => listeners.delete(listener) },
    async commitOperation(owner, operation, { expectedControl, domainContext } = {}) {
      check(owner)
      if (operation.ownerKey !== owner.ownerKey) throw error('owner-mismatch')
      if (['generation', 'dataRevision', 'unitVersion', 'activeUnitJob', 'lastResetOpId'].some(key => expectedControl?.[key] !== profile.control[key] || domainContext?.remoteProfile?.control[key] !== profile.control[key])) throw error('refresh-required')
      if (operation.generation !== profile.control.generation) throw error('generation-mismatch')
      let merged
      try {
        for (let i = 0; i < repetitions; i++) merged = codec.mergeOperation(structuredClone(profile.documents), operation, { control: structuredClone(profile.control), domainContext: structuredClone(domainContext) })
      } catch (e) { if (!e.code) e.code = e.message.split(':')[0]; throw e }
      if (Object.keys(merged.documentsToWrite).length) profile = { control: { ...profile.control, dataRevision: profile.control.dataRevision + 1 }, documents: { ...profile.documents, ...structuredClone(merged.documentsToWrite) } }
      transactions.push({ kind: 'operation', opId: operation.opId, paths: Object.keys(merged.documentsToWrite), control: structuredClone(profile.control) }); notify()
      return structuredClone({ ownerKey: owner.ownerKey, opId: operation.opId, control: profile.control, documents: merged.confirmedDocuments })
    },
    async commitReset(owner, reset) {
      check(owner)
      if (typeof reset.opId !== 'string' || !reset.opId || reset.opId.length > 1500 || !Number.isSafeInteger(reset.baseGeneration) || reset.baseGeneration < 1 || reset.nextGeneration !== reset.baseGeneration + 1) throw error('invalid-reset')
      if (profile.control.generation === reset.nextGeneration && profile.control.lastResetOpId === reset.opId) return structuredClone(profile.control)
      if (profile.control.generation !== reset.baseGeneration) throw error('generation-mismatch')
      if (reset.nextGeneration !== reset.baseGeneration + 1) throw error('invalid-reset')
      if (profile.control.activeUnitJob) throw error('unit-job-active')
      for (const [path, record] of Object.entries(profile.documents)) retired.set(path, structuredClone(record))
      profile = { control: { ...profile.control, generation: reset.nextGeneration, dataRevision: profile.control.dataRevision + 1, lastResetOpId: reset.opId }, documents: {} }
      transactions.push({ kind: 'reset', ...reset }); notify(); return structuredClone(profile.control)
    },
    async readJobs(owner) { check(owner); return structuredClone([...jobs.values()].map(jobManifest)) },
    async readJobParts(owner, job) { check(owner); return structuredClone(jobs.get(job.jobId)?.parts || []) },
    async beginJob(owner, input) {
      check(owner)
      if (jobs.has(input.jobId)) return
      if (profile.control.generation !== input.generation) throw error('generation-mismatch')
      if (profile.control.activeUnitJob) throw error('unit-job-active')
      if (profile.control.unitVersion !== input.options.sourceVersion) throw error('unit-version-mismatch')
      if (input.kind === 'unit' && input.options.baseRevision !== profile.control.dataRevision) throw error('refresh-required')
      const job = structuredClone(input); job.preparedParts = job.totalParts; job.status = 'running'; jobs.set(job.jobId, job)
      if (job.kind === 'unit') profile.control = { ...profile.control, activeUnitJob: job.jobId, dataRevision: profile.control.dataRevision + 1 }
      notify()
    },
    async commitJobPart(owner, input, part) {
      check(owner)
      const job = jobs.get(input.jobId), stored = job?.parts.find(p => p.partId === part.partId), marker = `${input.jobId}:${part.partId}`
      if (!stored) throw error('job-part-mismatch')
      if (profile.control.generation !== input.generation) throw error('generation-mismatch')
      if (stored.status === 'complete') return structuredClone({ ownerKey: owner.ownerKey, opId: marker, control: profile.control, documents: {}, transformedEntities: [] })
      if (profile.control.unitVersion !== job.options.sourceVersion) throw error('unit-version-mismatch')
      let documents = {}
      if (job.kind === 'unit') for (const path of part.paths) {
        const record = profile.documents[path] || codec.encodeState({ unit: job.options.from }, profile.control).documents[path]
        documents[path] = { ...transformUnitRecord(path, record, job), appliedOpId: marker }
      } else {
        const op = { opId: marker, ownerKey: owner.ownerKey, generation: job.generation, unitVersion: job.options.sourceVersion, paths: part.paths, readPaths: [], payloads: input.sourceKind ? input.payloads : Object.fromEntries(part.paths.map(p => [p, input.payloads[p]])), blockedReason: null }
        documents = codec.mergeOperation(profile.documents, op, { control: profile.control, domainContext: { remoteProfile: profile, remoteState: codec.decodeState(profile.documents) } }).documentsToWrite
      }
      profile = { control: { ...profile.control, dataRevision: profile.control.dataRevision + 1 }, documents: { ...profile.documents, ...documents } }
      stored.status = 'complete'; job.completedParts++; job.lastPartId = part.partId
      transactions.push({ kind: 'part', jobId: job.jobId, partId: part.partId }); notify()
      return structuredClone({ ownerKey: owner.ownerKey, opId: marker, control: profile.control, documents, transformedEntities: Object.keys(documents) })
    },
    async finishJob(owner, input) {
      check(owner)
      const job = jobs.get(input.jobId)
      if (profile.control.generation !== input.generation) throw error('generation-mismatch')
      if (job.status === 'complete') return structuredClone(profile.control)
      if (job.completedParts !== job.totalParts) throw error('job-incomplete')
      if (job.kind === 'unit') profile.control = { ...profile.control, unitVersion: job.options.targetVersion, activeUnitJob: null, dataRevision: profile.control.dataRevision + 1 }
      job.status = 'complete'; notify(); return structuredClone(profile.control)
    },
    async readOldGenerationPaths(owner, { generation }) {
      check(owner)
      if (generation >= profile.control.generation) throw error('generation-mismatch')
      return [...retired].filter(([path, record]) => record.generation === generation && !profile.documents[path]).map(([path]) => path).sort().slice(0, 20)
    },
    async deleteOldGeneration(owner, { generation, paths }) {
      check(owner)
      if (generation >= profile.control.generation) throw error('generation-mismatch')
      for (const path of paths) if (retired.get(path)?.generation === generation) retired.delete(path)
      transactions.push({ kind: 'cleanup', generation, paths: structuredClone(paths) })
    },
    failNext(error) { failure = error }, repeatTransaction(times = 2) { repetitions = times }, delayCallbacks(value = true) { delayed = value },
    deliverCallbacks() { for (const fn of callbacks.splice(0)) fn() },
    replaceProfile(value) { profile = structuredClone(value); notify() },
    emitError(error) { for (const listener of listeners) listener.onError(error) },
  }
}
