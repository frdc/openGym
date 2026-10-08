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
  return { readProfileFromServer, watchControl, commitOperation, commitReset }
}
