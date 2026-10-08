import { normalizeStorageError, reduceEnvelope, revisionListeners, storageError, validateEnvelope, validateOwnerKey } from './offline-store.js'

const DATABASE = 'opengym-offline'
const STORE = 'envelopes'

export function createIdbStorage({ indexedDB = globalThis.indexedDB, broadcast } = {}) {
  let opening, db, channel = broadcast
  const pending = new Map(), observers = revisionListeners()
  async function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(storageError('storage-unavailable')); return }
      let request, failed = false
      const fail = error => { failed = true; reject(normalizeStorageError(error)) }
      try { request = indexedDB.open(DATABASE, 1) } catch (error) { fail(error); return }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'ownerKey' }) }
      request.onerror = () => fail(request.error)
      request.onblocked = () => fail(storageError('storage-blocked'))
      request.onsuccess = () => {
        if (failed) { request.result.close(); return }
        db = request.result
        db.onversionchange = () => { db.close(); db = null; opening = null }
        if (channel === undefined) {
          try { channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DATABASE) : null } catch { channel = null }
        }
        if (channel?.addEventListener) channel.addEventListener('message', event => {
          const key = event.data?.ownerKey
          // Broadcasts are hints. Never acknowledge a revision without reading it.
          read(key).then(value => { if (value) observers.notify(value) }).catch(() => {})
        })
        resolve()
      }
    }).catch(error => { opening = null; throw error })
    await opening
  }
  async function transact(ownerKey, reducer, writing = false) {
    if (writing && typeof reducer !== 'function') throw storageError('invalid-reducer')
    validateOwnerKey(ownerKey)
    await open()
    return new Promise((resolve, reject) => {
      let tx, value, failure
      try { tx = db.transaction(STORE, reducer ? 'readwrite' : 'readonly', reducer ? { durability: 'strict' } : undefined) } catch (error) { reject(normalizeStorageError(error)); return }
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => { failure ||= tx.error }
      tx.onabort = () => reject(normalizeStorageError(failure || tx.error || storageError('storage-aborted')))
      try {
        const store = tx.objectStore(STORE), request = store.get(ownerKey)
        request.onerror = () => { failure = request.error }
        request.onsuccess = () => {
          try {
            const current = request.result ?? null
            if (current) validateEnvelope(current, ownerKey)
            value = reducer ? reduceEnvelope(ownerKey, current, reducer) : current
            if (reducer) {
              const put = store.put(value)
              put.onerror = () => { failure = put.error }
            }
          } catch (error) { failure = error; tx.abort() }
        }
      } catch (error) { failure = error; tx.abort() }
    })
  }
  async function read(ownerKey) { return structuredClone(await transact(ownerKey)) }
  function commit(ownerKey, reducer) {
    const operation = transact(ownerKey, reducer, true).then(envelope => {
      observers.notify(envelope)
      try { channel?.postMessage({ ownerKey, localRevision: envelope.localRevision }) } catch { /* delivery is only a hint */ }
      return structuredClone(envelope)
    })
    pending.set(ownerKey, operation)
    operation.catch(() => {})
    return operation
  }
  return { open, read, commit, async flush(ownerKey) { validateOwnerKey(ownerKey); await pending.get(ownerKey) }, subscribe: observers.subscribe }
}
