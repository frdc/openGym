import { jobManifest, transformUnitRecord } from './sync-jobs.js'
import { doc, collection, query, where, orderBy, documentId, limit, startAfter, getDocFromServer, getDocsFromServer, runTransaction, onSnapshot } from 'firebase/firestore'
import * as defaultCodec from './codec.js'
import { FIELD_POLICY, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_DEPTH, makeOwner } from './model.js'

const sdkDefault = { doc, collection, query, where, orderBy, documentId, limit, startAfter, getDocFromServer, getDocsFromServer, runTransaction, onSnapshot }
const collections = ['settings', 'plans', 'planDays', 'routines', 'workouts', 'bodyweight', 'customExercises', 'exerciseState', 'equipmentProfiles', 'gymCards', 'balanceOverrides', 'plates']
const grouped = new Set('routines workouts bodyweight customEx equipProfiles gymCards exWeights exNotes barWeights loadKind queue rotation scheduleMode favEx week dayPlan balanceOverrides plates edited undone deleted'.split(' '))
const settings = new Set(Object.keys(FIELD_POLICY).filter(k => FIELD_POLICY[k] === 'sync' && !grouped.has(k)))
const clone = value => structuredClone(value)
const fail = (code, path) => { throw Object.assign(new Error(path ? `${code}:${path}` : code), { code, ...(path ? { path } : {}) }) }
const map = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const integer = v => Number.isSafeInteger(v) && v >= 0
const nullableId = v => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 1500)
const sameControl = (a, b) => a && b && ['generation', 'dataRevision', 'unitVersion', 'activeUnitJob', 'lastResetOpId'].every(k => a[k] === b[k])
const initialControl = () => ({ schemaVersion: 1, generation: 1, dataRevision: 0, unitVersion: 1, activeUnitJob: null, lastResetOpId: null })
function validateControl(c) {
  if (!map(c) || Object.keys(c).sort().join() !== 'activeUnitJob,dataRevision,generation,lastResetOpId,schemaVersion,unitVersion' || c.schemaVersion !== 1 || !integer(c.generation) || c.generation < 1 || !integer(c.dataRevision) || !integer(c.unitVersion) || c.unitVersion < 1 || !nullableId(c.activeUnitJob) || !nullableId(c.lastResetOpId)) fail('invalid-control')
  return c
}
function validatePath(path) {
  if (typeof path !== 'string') fail('invalid-path')
  const [family, id, extra] = path.split('/')
  if (extra !== undefined || !collections.includes(family) || !id || id.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(id) || (family === 'settings' && !settings.has(id)) || (family === 'plans' && id !== 'main') || (family === 'plates' && !['kg', 'lb'].includes(id)) || (family === 'bodyweight' && !/^\d{4}-\d{2}-\d{2}$/.test(id))) fail('invalid-path', path)
  return family
}
function validateRecord(path, rec) {
  const family = validatePath(path)
  const walk = (v, depth = 0, inArray = false) => {
    if (depth > MAX_DOCUMENT_DEPTH || v === undefined || ['function', 'bigint', 'symbol'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) return false
    if (v === null || typeof v !== 'object') return true
    if (Array.isArray(v)) return !inArray && v.every(x => walk(x, depth + 1, true))
    return map(v) && Object.values(v).every(x => walk(x, depth + 1))
  }
  if (!map(rec) || !walk(rec) || Object.keys(rec).sort().join() !== 'appliedOpId,dataUnit,deletedAt,generation,payload,schemaVersion,stamps,unitVersion' || rec.schemaVersion !== 1 || !integer(rec.generation) || rec.generation < 1 || !integer(rec.unitVersion) || rec.unitVersion < 1 || ![null, 'kg', 'lb'].includes(rec.dataUnit) || !map(rec.payload) || !map(rec.stamps) || ![rec.stamps.edited, rec.stamps.undone, rec.stamps.deleted].every(map) || !(rec.deletedAt === null || integer(rec.deletedAt)) || !nullableId(rec.appliedOpId)) fail('invalid-document', path)
  const p = rec.payload
  if ((family === 'settings' && (Object.keys(p).some(k => k !== 'value') || (path === 'settings/unit' && Object.hasOwn(p, 'value') && !['kg', 'lb'].includes(p.value)))) || (family === 'plans' && Object.keys(p).some(k => !['queue', 'rotation', 'scheduleMode', 'routineOrder'].includes(k))) || (family === 'planDays' && Object.keys(p).some(k => !['field', 'key', 'value'].includes(k))) || Object.keys(rec.stamps).some(k => !['edited', 'undone', 'deleted'].includes(k))) fail('invalid-document', path)
  if (rec.deletedAt === null && ((['routines', 'workouts', 'customExercises', 'exerciseState', 'equipmentProfiles', 'gymCards'].includes(family) && typeof p.id !== 'string') || (family === 'bodyweight' && p.d !== path.split('/')[1]) || (family === 'planDays' && (!['week', 'dayPlan'].includes(p.field) || typeof p.key !== 'string')) || (['plates', 'balanceOverrides'].includes(family) && typeof p.key !== 'string'))) fail('invalid-document', path)
  if (new TextEncoder().encode(JSON.stringify(rec)).length > MAX_DOCUMENT_BYTES) fail('document-too-large', path)
  return rec
}

/** Server-only profile barriers and replay-safe, granular writes within one authenticated namespace. */
export function createFirestorePort({ client, codec = defaultCodec, sdk = sdkDefault }) {
  const cache = new Map()
  function root(owner) {
    let canonical
    try { canonical = makeOwner(owner?.projectId, owner?.uid) } catch { fail('owner-mismatch') }
    if (!owner.uid || canonical.ownerKey !== owner.ownerKey || owner.projectId !== client?.app?.options?.projectId || owner.projectId !== client?.auth?.app?.options?.projectId || owner.projectId !== client?.db?.app?.options?.projectId || owner.uid !== client?.auth?.currentUser?.uid) fail('owner-mismatch')
    return `users/${owner.uid}/apps/opengym`
  }
  const ref = (owner, path = '') => sdk.doc(client.db, root(owner) + (path ? '/' + path : ''))
  const confirmed = snap => { if (snap.metadata?.fromCache || snap.metadata?.hasPendingWrites) fail('server-required'); return snap }
  async function serverControl(owner) {
    const snap = confirmed(await sdk.getDocFromServer(ref(owner))); root(owner)
    return snap.exists() ? validateControl(snap.data()) : null
  }
  async function readProfileFromServer(owner) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let before = await serverControl(owner)
      if (!before) {
        // Only reached after an explicit successful server response proving absence.
        before = await sdk.runTransaction(client.db, async tx => {
          const snap = await tx.get(ref(owner)); root(owner)
          if (snap.exists()) return validateControl(snap.data())
          const value = initialControl(); tx.set(ref(owner), value); return value
        })
      }
      const cached = cache.get(owner.ownerKey)
      if (cached && sameControl(cached.control, before)) return clone(cached)
      const documents = {}
      for (const family of collections) {
        let cursor
        do {
          const constraints = [sdk.where('generation', '==', before.generation), sdk.orderBy(sdk.documentId()), sdk.limit(100)]
          if (cursor) constraints.push(sdk.startAfter(cursor))
          const page = confirmed(await sdk.getDocsFromServer(sdk.query(sdk.collection(client.db, root(owner) + '/' + family), ...constraints))); root(owner)
          for (const snap of page.docs) {
            const path = `${family}/${snap.id}`, record = validateRecord(path, snap.data())
            if (record.generation !== before.generation) fail('invalid-document', path)
            documents[path] = record
          }
          cursor = page.docs.length === 100 ? page.docs.at(-1) : null
        } while (cursor)
      }
      const after = await serverControl(owner)
      if (sameControl(before, after)) { const profile = { control: after, documents }; cache.set(owner.ownerKey, clone(profile)); return profile }
    }
    fail('refresh-required')
  }
  async function commitOperation(owner, operation, { expectedControl, domainContext } = {}) {
    root(owner)
    if (operation?.ownerKey !== owner.ownerKey) fail('owner-mismatch')
    if (!nullableId(operation.opId) || operation.opId === null || !Array.isArray(operation.paths) || !operation.paths.length || new Set(operation.paths).size !== operation.paths.length || !Array.isArray(operation.readPaths) || !map(operation.payloads)) fail('invalid-operation')
    if (operation.blockedReason) fail(operation.blockedReason.split(':')[0], operation.blockedReason.split(':').slice(1).join(':'))
    for (const path of [...operation.paths, ...operation.readPaths]) validatePath(path)
    if (Object.keys(operation.payloads).some(p => !operation.paths.includes(p))) fail('invalid-operation')
    for (const path of operation.paths) validateRecord(path, operation.payloads[path])
    if (!expectedControl || !domainContext?.remoteProfile || !sameControl(expectedControl, domainContext.remoteProfile.control)) fail('refresh-required')
    const profile = clone(domainContext.remoteProfile), op = clone(operation), expected = clone(expectedControl)
    validateControl(expected)
    for (const [path, record] of Object.entries(profile.documents)) validateRecord(path, record)
    const confirmation = await sdk.runTransaction(client.db, async tx => {
      const controlSnap = await tx.get(ref(owner)); root(owner)
      if (!controlSnap.exists()) fail('refresh-required')
      const control = validateControl(controlSnap.data())
      if (!sameControl(control, expected)) fail('refresh-required')
      const remote = {}
      for (const path of new Set([...op.paths, ...op.readPaths])) {
        const snap = await tx.get(ref(owner, path)); root(owner)
        if (snap.exists()) {
          const record = validateRecord(path, snap.data())
          if (record.generation > control.generation) fail('invalid-document', path)
          // Reset retains old records until cleanup; an ID may be reused in the current generation.
          if (record.generation === control.generation) remote[path] = record
        }
      }
      let merged
      try { merged = codec.mergeOperation(remote, op, { control, domainContext: { remoteProfile: profile, remoteState: codec.decodeState(profile.documents, { generation: control.generation }) } }) }
      catch (e) { if (!e.code) e.code = e.message.split(':')[0]; throw e }
      const writes = Object.entries(merged.documentsToWrite)
      const next = { ...control, dataRevision: control.dataRevision + (writes.length ? 1 : 0) }; validateControl(next)
      for (const [path, value] of writes) { if (!op.paths.includes(path)) fail('invalid-path', path); validateRecord(path, value) }
      root(owner)
      for (const [path, value] of writes) tx.set(ref(owner, path), value)
      if (writes.length) tx.set(ref(owner), next)
      return { ownerKey: owner.ownerKey, opId: op.opId, control: next, documents: merged.confirmedDocuments }
    })
    root(owner)
    cache.set(owner.ownerKey, clone({ control: confirmation.control, documents: { ...profile.documents, ...confirmation.documents } }))
    return confirmation
  }
  async function commitReset(owner, { opId, baseGeneration, nextGeneration }) {
    root(owner)
    if (!nullableId(opId) || opId === null || !integer(baseGeneration) || baseGeneration < 1 || nextGeneration !== baseGeneration + 1) fail('invalid-reset')
    const control = await sdk.runTransaction(client.db, async tx => {
      const snap = await tx.get(ref(owner)); root(owner)
      if (!snap.exists()) fail('refresh-required')
      const current = validateControl(snap.data())
      if (current.generation === nextGeneration && current.lastResetOpId === opId) return current
      if (current.generation !== baseGeneration) fail('generation-mismatch')
      if (current.activeUnitJob) fail('unit-job-active')
      const next = { ...current, generation: nextGeneration, dataRevision: current.dataRevision + 1, lastResetOpId: opId }; validateControl(next)
      tx.set(ref(owner), next); return next
    })
    root(owner); cache.delete(owner.ownerKey); return control
  }
  function checkJob(owner, job) {
    root(owner)
    if (job.ownerKey !== owner.ownerKey || !/^[A-Za-z0-9_-]{1,1500}$/.test(job.jobId) || !['unit', 'import'].includes(job.kind) || !integer(job.generation) || job.generation < 1 || !integer(job.totalParts) || !map(job.options)) fail('invalid-job')
    const o = job.options
    if (!integer(o.sourceVersion) || o.sourceVersion < 1 || !integer(o.targetVersion) || o.targetVersion !== o.sourceVersion + (job.kind === 'unit' ? 1 : 0)) fail('invalid-job')
    const allowed = job.kind === 'unit' ? ['from','to','convert','sourceVersion','targetVersion','baseRevision','stamp'] : ['sourceVersion','targetVersion']
    if (Object.keys(o).some(k => !allowed.includes(k)) || (job.kind === 'unit' && (!['kg','lb'].includes(o.from) || !['kg','lb'].includes(o.to) || typeof o.convert !== 'boolean' || !integer(o.baseRevision) || !integer(o.stamp)))) fail('invalid-job')
  }
  function sameJob(a, b) {
    return ['jobId','ownerKey','generation','kind','totalParts'].every(k => a[k] === b[k]) && JSON.stringify(a.options) === JSON.stringify(b.options)
  }
  function checkPart(job, part) {
    if (!/^\d{6}$/.test(part.partId) || Number(part.partId) >= job.totalParts || !Array.isArray(part.paths) || !part.paths.length || part.paths.length > 20 || new Set(part.paths).size !== part.paths.length || part.sourceVersion !== job.options.sourceVersion || part.targetVersion !== job.options.targetVersion) fail('invalid-job-part')
    part.paths.forEach(validatePath)
  }
  async function beginJob(owner, input) {
    const job = clone(input); checkJob(owner, job)
    if (job.parts?.length !== job.totalParts) fail('invalid-job')
    for (const part of job.parts) checkPart(job, part)
    const jobPath = `jobs/${job.jobId}`
    await sdk.runTransaction(client.db, async tx => {
      const c = await tx.get(ref(owner)), existing = await tx.get(ref(owner, jobPath)); root(owner)
      const control = validateControl(c.data())
      if (existing.exists()) { if (!sameJob(existing.data(), job)) fail('job-mismatch'); return }
      if (control.generation !== job.generation) fail('generation-mismatch')
      if (control.activeUnitJob) fail('unit-job-active')
      if (control.unitVersion !== job.options.sourceVersion) fail('unit-version-mismatch')
      if (job.kind === 'unit') {
        if (control.dataRevision !== job.options.baseRevision) fail('refresh-required')
        tx.set(ref(owner), { ...control, activeUnitJob: job.jobId, dataRevision: control.dataRevision + 1 })
      }
      tx.set(ref(owner, jobPath), { ...jobManifest(job), completedParts: 0, preparedParts: 0, status: 'pending' })
    })
    cache.delete(owner.ownerKey)
    // Freeze occurs BEFORE registration. Another device reconstructs unfinished
    // unit registration from the frozen server profile, without the original source.
    for (const part of job.parts) await sdk.runTransaction(client.db, async tx => {
      const parent = await tx.get(ref(owner, jobPath)), stored = await tx.get(ref(owner, `${jobPath}/parts/${part.partId}`)); root(owner)
      const manifest = parent.data()
      if (!sameJob(manifest, job)) fail('job-mismatch')
      if (stored.exists()) { if (JSON.stringify(stored.data().paths) !== JSON.stringify(part.paths)) fail('job-part-mismatch'); return }
      if (manifest.status !== 'pending' || manifest.preparedParts !== Number(part.partId)) fail('job-part-order')
      tx.set(ref(owner, `${jobPath}/parts/${part.partId}`), { ...part, status: 'pending' })
      tx.set(ref(owner, jobPath), { ...manifest, preparedParts: manifest.preparedParts + 1 })
    })
    await sdk.runTransaction(client.db, async tx => {
      const snap = await tx.get(ref(owner, jobPath)); root(owner)
      const manifest = snap.data()
      if (manifest.preparedParts !== manifest.totalParts) fail('job-incomplete')
      if (manifest.status === 'pending') tx.set(ref(owner, jobPath), { ...manifest, status: 'running' })
    })
    root(owner)
  }
  async function readJobs(owner) {
    const result = []; let cursor
    do {
      const constraints = [sdk.orderBy(sdk.documentId()), sdk.limit(100)]
      if (cursor) constraints.push(sdk.startAfter(cursor))
      const page = confirmed(await sdk.getDocsFromServer(sdk.query(sdk.collection(client.db, root(owner) + '/jobs'), ...constraints))); root(owner)
      for (const item of page.docs) { const job = item.data(); checkJob(owner, job); result.push(job) }
      cursor = page.docs.length === 100 ? page.docs.at(-1) : null
    } while (cursor)
    return result
  }
  async function readJobParts(owner, job) {
    checkJob(owner, job)
    const result = []; let cursor
    do {
      const constraints = [sdk.orderBy(sdk.documentId()), sdk.limit(100)]
      if (cursor) constraints.push(sdk.startAfter(cursor))
      const page = confirmed(await sdk.getDocsFromServer(sdk.query(sdk.collection(client.db, root(owner) + `/jobs/${job.jobId}/parts`), ...constraints))); root(owner)
      for (const item of page.docs) { const part = item.data(); checkPart(job, part); result.push(part) }
      cursor = page.docs.length === 100 ? page.docs.at(-1) : null
    } while (cursor)
    return result
  }
  async function commitJobPart(owner, input, inputPart) {
    const job = clone(input), part = clone(inputPart); checkJob(owner, job); checkPart(job, part)
    const jobPath = `jobs/${job.jobId}`, marker = `${job.jobId}:${part.partId}`
    const profile = job.kind === 'import' ? await readProfileFromServer(owner) : null
    if (job.kind === 'import') {
      let requestBytes = 16384
      for (const path of part.paths) {
        validateRecord(path, job.payloads?.[path])
        requestBytes += 2 * new TextEncoder().encode(JSON.stringify(job.payloads[path]) + JSON.stringify(profile.documents[path] || {})).length + 4096
        if (requestBytes > 8 * 1024 * 1024) fail('job-part-too-large', path)
      }
    }
    const confirmation = await sdk.runTransaction(client.db, async tx => {
      const c = await tx.get(ref(owner)), j = await tx.get(ref(owner, jobPath)), p = await tx.get(ref(owner, `${jobPath}/parts/${part.partId}`)); root(owner)
      const control = validateControl(c.data()), manifest = j.data(), stored = p.data()
      if (!manifest || !sameJob(manifest, job) || !stored || JSON.stringify(stored.paths) !== JSON.stringify(part.paths)) fail('job-part-mismatch')
      if (control.generation !== job.generation) fail('generation-mismatch')
      if (stored.status === 'complete') return { ownerKey: owner.ownerKey, opId: marker, control, documents: {}, transformedEntities: [] }
      if (manifest.status !== 'running') fail('job-not-ready')
      if (control.unitVersion !== job.options.sourceVersion) fail('unit-version-mismatch')
      if (job.kind === 'unit' ? control.activeUnitJob !== job.jobId : control.activeUnitJob !== null) fail('unit-job-active')
      if (profile && !sameControl(profile.control, control)) fail('refresh-required')
      const records = {}
      for (const path of part.paths) {
        const snap = await tx.get(ref(owner, path)); root(owner)
        if (snap.exists()) {
          const record = validateRecord(path, snap.data())
          if (record.generation > control.generation) fail('invalid-document', path)
          if (record.generation === control.generation) records[path] = record
        }
      }
      let documents
      if (job.kind === 'unit') {
        documents = {}
        for (const path of part.paths) {
          let record = records[path]
          if (!record && path === 'settings/unit') record = codec.encodeState({ unit: job.options.from }, { generation: job.generation, unitVersion: job.options.sourceVersion }).documents[path]
          if (!record) fail('job-record-missing', path)
          if (record.unitVersion !== job.options.sourceVersion) fail('unit-version-mismatch')
          documents[path] = { ...transformUnitRecord(path, record, job), appliedOpId: marker }
        }
      } else {
        const operation = { opId: marker, ownerKey: owner.ownerKey, generation: job.generation, unitVersion: job.options.sourceVersion, kind: 'import', paths: part.paths, readPaths: [], blockedReason: null,
          payloads: Object.fromEntries(part.paths.map(path => [path, job.payloads[path]])) }
        documents = codec.mergeOperation(records, operation, { control, domainContext: { remoteProfile: profile, remoteState: codec.decodeState(profile.documents) } }).documentsToWrite
      }
      for (const [path, record] of Object.entries(documents)) validateRecord(path, record)
      const next = { ...control, dataRevision: control.dataRevision + 1 }; validateControl(next)
      for (const [path, record] of Object.entries(documents)) tx.set(ref(owner, path), record)
      tx.set(ref(owner), next)
      tx.set(ref(owner, `${jobPath}/parts/${part.partId}`), { ...stored, status: 'complete' })
      tx.set(ref(owner, jobPath), { ...manifest, completedParts: manifest.completedParts + 1, lastPartId: part.partId })
      return { ownerKey: owner.ownerKey, opId: marker, control: next, documents, transformedEntities: Object.keys(documents) }
    })
    root(owner); cache.delete(owner.ownerKey); return confirmation
  }
  async function finishJob(owner, input) {
    const job = clone(input); checkJob(owner, job)
    const control = await sdk.runTransaction(client.db, async tx => {
      const c = await tx.get(ref(owner)), j = await tx.get(ref(owner, `jobs/${job.jobId}`)); root(owner)
      const control = validateControl(c.data()), manifest = j.data()
      if (!manifest || !sameJob(manifest, job)) fail('job-mismatch')
      if (control.generation !== job.generation) fail('generation-mismatch')
      if (manifest.status === 'complete') return control
      if (manifest.status !== 'running' || manifest.completedParts !== manifest.totalParts) fail('job-incomplete')
      const next = job.kind === 'unit' ? { ...control, unitVersion: job.options.targetVersion, activeUnitJob: null, dataRevision: control.dataRevision + 1 } : control
      if (job.kind === 'unit' && (control.activeUnitJob !== job.jobId || control.unitVersion !== job.options.sourceVersion)) fail('unit-version-mismatch')
      validateControl(next)
      if (job.kind === 'unit') tx.set(ref(owner), next)
      tx.set(ref(owner, `jobs/${job.jobId}`), { ...manifest, status: 'complete' })
      return next
    })
    root(owner); cache.delete(owner.ownerKey); return control
  }
  async function deleteOldGeneration(owner, { generation, paths }) {
    root(owner)
    if (!integer(generation) || generation < 1 || !Array.isArray(paths)) fail('invalid-cleanup')
    paths.forEach(validatePath)
    for (let i = 0; i < paths.length; i += 20) await sdk.runTransaction(client.db, async tx => {
      const c = await tx.get(ref(owner)); root(owner)
      if (validateControl(c.data()).generation <= generation) fail('generation-mismatch')
      const removed = []
      for (const path of paths.slice(i, i + 20)) { const snap = await tx.get(ref(owner, path)); root(owner); if (snap.exists() && validateRecord(path, snap.data()).generation === generation) removed.push(path) }
      for (const path of removed) tx.delete(ref(owner, path))
    })
    root(owner)
  }
  function watchControl(owner, onControl, onError) {
    let stopped = false
    const stop = sdk.onSnapshot(ref(owner), { includeMetadataChanges: true }, snap => {
      if (stopped) return
      try {
        root(owner)
        if (snap.metadata?.fromCache || snap.metadata?.hasPendingWrites) return
        const control = snap.exists() ? validateControl(snap.data()) : null
        onControl(clone(control))
      } catch (error) { onError(error) }
    }, error => { if (!stopped) onError(error) })
    return () => { if (!stopped) { stopped = true; stop() } }
  }
  return { readProfileFromServer, watchControl, commitOperation, commitReset, beginJob, readJobs, readJobParts, commitJobPart, finishJob, deleteOldGeneration }
}
