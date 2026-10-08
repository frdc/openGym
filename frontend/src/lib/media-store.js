/* Account-local photos, GIFs, videos and posters. Owner stores use separate durable
 * namespaces. The original unowned pool is accessible only for explicit recovery.
 * No upload/download transport participates in ingest, playback or backups.
 * URLs are reference-counted; editors hold drafts until save/discard.
 */
import { validateOwnerKey } from './cloud/offline-store.js'
import { MEDIA_MIMES } from './media-refs.js'
import { MOBILE } from './mobile.js'
import { idbBackend } from './media-store-idb.js'
import { fsBackend } from './media-store-fs.js'

const HOUR = 3600000

/** A backend that forgets everything with the page — the tests', and the fallback's. */
export function memoryBackend() {
  const recs = new Map()
  const blobs = new Map()
  return {
    name: 'memory',
    persistent: false,
    async open() { return true },
    async all() { return [...recs.values()].map(r => ({ ...r })) },
    async getBlob(hash) { return blobs.get(hash) || null },
    async put(rec, blob) { recs.set(rec.hash, { ...rec }); if (blob) blobs.set(rec.hash, blob) },
    async patch(hash, fields) { const r = recs.get(hash); if (r) recs.set(hash, { ...r, ...fields }) },
    async remove(hash) { recs.delete(hash); blobs.delete(hash) },
    async clear() { recs.clear(); blobs.clear() }
  }
}

// The type a <video> can play a file as. A MOV is an MP4 in all that matters to a browser, and
// most refuse "video/quicktime" outright (Chrome, Firefox, Android) while playing the same bytes
// typed video/mp4. Safari plays it as what it is.
export function playType(mime, canPlayType = defaultCanPlay) {
  if (mime !== 'video/quicktime') return mime
  return canPlayType('video/quicktime') ? mime : 'video/mp4'
}
function defaultCanPlay(type) {
  try { return typeof document !== 'undefined' ? document.createElement('video').canPlayType(type) : '' } catch { return '' }
}

export function createMediaStore(backend, {
  fallback = memoryBackend,
  now = () => Date.now(),
  objectURL = globalThis.URL,
  revokeDelayMs = 30000,
  canPlayType = defaultCanPlay
} = {}) {
  let be = backend
  let opening = null
  let persistent = !!backend.persistent
  const index = new Map()
  const listeners = new Set()
  // hash → { url, refs, timer, file }  (file: a phone's file URL, which is never revoked)
  const urls = new Map()
  const making = new Map()   // hash → the url() in progress, so two callers make one
  const held = new Map()     // hash → how many open editors hold it as their draft (hold)

  const emit = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's own problem */ } } }

  const ready = () => {
    if (!opening) {
      opening = (async () => {
        let ok = false
        ok = await be.open()
        if (!ok) { be = fallback(); persistent = false; await be.open() }
        else persistent = !!be.persistent
        for (const r of await be.all()) index.set(r.hash, r)
        emit()
      })().catch(error => { opening = null; throw error })
    }
    return opening
  }

  const revokeNow = hash => {
    const u = urls.get(hash)
    if (!u) return
    clearTimeout(u.timer)
    urls.delete(hash)
    if (!u.file) { try { objectURL.revokeObjectURL(u.url) } catch { /* already gone */ } }
  }

  const store = {
    ready,
    /** Marks files as a draft's (an editor that is open) until the returned function is called.
     *  The local clean-up keeps what is held however long ago it was put: its one-hour grace is
     *  for a draft abandoned, not for one still being written. In memory only — a draft does not
     *  outlive its tab. */
    hold(hashes) {
      const hs = [...new Set(hashes)].filter(Boolean)
      for (const h of hs) held.set(h, (held.get(h) || 0) + 1)
      let done = false
      return () => {
        if (done) return
        done = true
        for (const h of hs) { const n = (held.get(h) || 0) - 1; if (n > 0) held.set(h, n); else held.delete(h) }
      }
    },
    isHeld: hash => held.has(hash),
    get persistent() { return persistent },
    get backendName() { return be.name },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },

    async has(hash) { await ready(); return index.has(hash) },
    /** The record with its blob, or null. */
    async get(hash) {
      await ready()
      const r = index.get(hash)
      if (!r) return null
      const blob = await be.getBlob(hash)
      if (!blob) return null
      return { blob, mime: r.mime, size: r.size, pending: !!r.pending, rejected: !!r.rejected }
    },
    /** Keeps `blob` under `hash`. The same hash is the same bytes, so a second put only updates
     *  the record — `pending` as the caller says: false when the server has just sent it. */
    async put(hash, blob, { mime, pending = false } = {}) {
      if (!MEDIA_MIMES[mime]) throw new Error('media-store: not a media type: ' + mime)
      await ready()
      const t = now()
      const cur = index.get(hash)
      if (cur) {
        const fields = { pending: !!pending, rejected: pending ? !!cur.rejected : false, putAt: t }
        index.set(hash, { ...cur, ...fields })
        await be.patch(hash, fields)
      } else {
        const rec = { hash, mime, size: blob.size, putAt: t, shownAt: 0, pending: !!pending, rejected: false }
        await be.put(rec, blob)
        index.set(hash, rec)
      }
      emit()
    },
    /** A URL to show the file by, or null when it is not here. Release it when done. */
    async url(hash) {
      await ready()
      const have = urls.get(hash)
      if (have) { have.refs++; clearTimeout(have.timer); have.timer = null; return have.url }
      if (making.has(hash)) {
        const u = await making.get(hash)
        if (u) { const e = urls.get(hash); if (e) { e.refs++; clearTimeout(e.timer); e.timer = null } }
        return u
      }
      const r = index.get(hash)
      if (!r) return null
      const job = (async () => {
        let url = null, file = false
        if (typeof be.fileUrl === 'function') { url = await be.fileUrl(hash, r).catch(() => null); file = !!url }
        if (!url) {
          const blob = await be.getBlob(hash).catch(() => null)
          if (!blob) return null
          url = objectURL.createObjectURL(new Blob([blob], { type: playType(r.mime, canPlayType) }))
        }
        urls.set(hash, { url, refs: 0, timer: null, file })
        return url
      })()
      making.set(hash, job)
      let url
      try { url = await job } finally { making.delete(hash) }
      const entry = url && urls.get(hash)
      if (!entry) return null   // not here, or removed while the URL was being made
      entry.refs++
      // When it was last shown decides what goes first when the cache is full; an hour is
      // precise enough, and a write per display would be one per scroll.
      if (!t0(r.shownAt) || t0(r.shownAt) + HOUR <= now()) {
        r.shownAt = now()
        be.patch(hash, { shownAt: r.shownAt }).catch(() => {})
      }
      return url
    },
    release(hash) {
      const u = urls.get(hash)
      if (!u) return
      u.refs = Math.max(0, u.refs - 1)
      if (u.refs || u.timer) return
      u.timer = setTimeout(() => { const cur = urls.get(hash); if (cur && !cur.refs) revokeNow(hash) }, revokeDelayMs)
    },
    async markSynced(hash) {
      await ready()
      const r = index.get(hash)
      if (!r || (!r.pending && !r.rejected)) return
      Object.assign(r, { pending: false, rejected: false })
      await be.patch(hash, { pending: false, rejected: false })
      emit()
    },
    async markRejected(hash) {
      await ready()
      const r = index.get(hash)
      if (!r || r.rejected) return
      r.rejected = true
      await be.patch(hash, { rejected: true })
      emit()
    },
    async remove(hash) {
      await ready()
      if (!index.has(hash)) return
      await be.remove(hash)
      revokeNow(hash)
      index.delete(hash)
      emit()
    },
    // No attachment/deletion lock spans state archives, editors and peer tabs. Automatic
    // cleanup must defer physical deletion, including reset, rather than race an attachment.
    async retainOnly() { await ready(); return 0 },
    async clearAll() {
      await ready()
      for (const hash of [...urls.keys()]) revokeNow(hash)
      index.clear()
      await be.clear().catch(() => {})
      emit()
    },
    async list() { await ready(); return [...index.values()].map(r => ({ ...r })) },
    async usage() {
      await ready()
      let bytes = 0
      for (const r of index.values()) bytes += r.size || 0
      return { bytes, count: index.size }
    },
    async pendingHashes() { await ready(); return store.pendingNow() },
    /** The pending hashes as the index holds them right now — empty before it has loaded. For
     *  inspection of legacy records. New local files have no upload debt. */
    pendingNow() { return new Set([...index.values()].filter(r => r.pending).map(r => r.hash)) },
    /** The rejected hashes, for Settings to say what the server would not take. */
    rejectedNow() { return new Set([...index.values()].filter(r => r.rejected).map(r => r.hash)) }
  }
  return store
}
const t0 = v => (typeof v === 'number' ? v : 0)

const stores = new Map()
const LEGACY = 'legacy-unowned'
/** Owner stores never fall back to the original unowned pool. */
export function getMediaStore(ownerKey) {
  validateOwnerKey(ownerKey)
  if (!stores.has(ownerKey)) stores.set(ownerKey, createMediaStore(MOBILE ? fsBackend({ ownerKey }) : idbBackend({ ownerKey })))
  return stores.get(ownerKey)
}
// Recovery-only source. Never use this as a display/picker fallback.
export function legacyMediaStore() {
  if (!stores.has(LEGACY)) stores.set(LEGACY, createMediaStore(MOBILE ? fsBackend() : idbBackend()))
  return stores.get(LEGACY)
}
export const mediaStoreInUse = () => stores.size > 0
export function _setMediaStore(s, ownerKey = LEGACY) { if (s === null) stores.clear(); else stores.set(ownerKey, s) }
