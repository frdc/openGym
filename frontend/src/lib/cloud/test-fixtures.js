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
