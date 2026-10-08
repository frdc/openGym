import { createIdbStorage } from './offline-idb.js'
import { createFsStorage } from './offline-fs.js'
import { makeOwner, SCHEMA_VERSION } from './model.js'

/** Durable storage for an entire envelope. Reducers are synchronous, pure, and
 * receive the latest confirmed envelope (or null). Revision numbers are backend-owned.
 * flush waits for commits already requested by this instance, including their errors.
 * subscribe callbacks receive a confirmed localRevision, never uncommitted state.
 */
export function createOfflineStorage({ mobile = false, ...deps } = {}) {
  return mobile ? createFsStorage(deps) : createIdbStorage(deps)
}

export function storageError(code, cause) {
  return Object.assign(new Error(code, cause ? { cause } : undefined), { code })
}
export function normalizeStorageError(error) {
  if (error?.name === 'QuotaExceededError' || error?.code === 'ENOSPC' || /no space left|disk full/i.test(error?.message || '')) return storageError('storage-full', error)
  return error?.code ? error : storageError('storage-unavailable', error)
}
export function isMissingFile(error) {
  return ['ENOENT', 'OS-PLUG-FILE-0008'].includes(error?.code) || /^(File does not exist|File not found)(\b|$)/i.test(error?.message || '')
}
export function validateOwnerKey(ownerKey) {
  try {
    const parts = JSON.parse(ownerKey)
    if (!Array.isArray(parts) || parts.length !== 3 || makeOwner(parts[0], parts[2]).ownerKey !== ownerKey) throw new Error()
  } catch { throw storageError('invalid-owner') }
}

// Both backends accept the same JSON domain. Reject values JSON would silently drop
// or coerce, so native readback actually confirms all the state and queue supplied.
function validateJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw storageError('invalid-envelope')
  seen.add(value)
  for (const item of Array.isArray(value) ? Array.from(value) : Object.values(value)) validateJson(item, seen)
  seen.delete(value)
}
export function validateEnvelope(envelope, ownerKey) {
  validateOwnerKey(ownerKey)
  if (envelope?.schemaVersion > SCHEMA_VERSION) throw storageError('unsupported-schema')
  if (envelope?.ownerKey !== ownerKey) throw storageError('owner-mismatch')
  if (envelope.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(envelope.localRevision) || envelope.localRevision < 0 || !Number.isSafeInteger(envelope.cloudGeneration) || envelope.cloudGeneration < 0 || !envelope.state || Array.isArray(envelope.state) || typeof envelope.state !== 'object' || !envelope.remoteMetadataByPath || Array.isArray(envelope.remoteMetadataByPath) || typeof envelope.remoteMetadataByPath !== 'object' || !Array.isArray(envelope.pendingOperations) || !Array.isArray(envelope.pendingJobs) || !Array.isArray(envelope.recoveryCopies) || !Object.hasOwn(envelope, 'adoptionDecision') || !Object.hasOwn(envelope, 'lastConfirmedControl')) throw storageError('invalid-envelope')
  for (const item of [...envelope.pendingOperations, ...envelope.pendingJobs]) if (item?.ownerKey !== ownerKey) throw storageError('owner-mismatch')
  validateJson(envelope)
  return envelope
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function reduceEnvelope(ownerKey, current, reducer) {
  if (typeof reducer !== 'function') throw storageError('invalid-reducer')
  validateOwnerKey(ownerKey)
  if (current !== null) validateEnvelope(current, ownerKey)
  const revision = current?.localRevision || 0
  if (revision === Number.MAX_SAFE_INTEGER) throw storageError('revision-overflow')
  const result = reducer(freeze(structuredClone(current)))
  if (result?.then instanceof Function) { Promise.resolve(result).catch(() => {}); throw storageError('invalid-reducer') }
  validateEnvelope(result, ownerKey)
  return structuredClone({ ...result, localRevision: revision + 1 })
}
export function revisionListeners() {
  const listeners = new Map(), seen = new Map()
  return {
    subscribe(ownerKey, fn) {
      validateOwnerKey(ownerKey)
      if (!listeners.has(ownerKey)) listeners.set(ownerKey, new Set())
      listeners.get(ownerKey).add(fn)
      return () => listeners.get(ownerKey)?.delete(fn)
    },
    notify(envelope) {
      if (envelope.localRevision <= (seen.get(envelope.ownerKey) || 0)) return
      seen.set(envelope.ownerKey, envelope.localRevision)
      for (const fn of listeners.get(envelope.ownerKey) || []) { try { fn(envelope.localRevision) } catch { /* observers cannot undo a durable write */ } }
    },
  }
}
