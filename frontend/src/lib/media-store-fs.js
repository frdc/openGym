/* The phone's backend for lib/media-store.js: plain files in the app's own folder.
 *
 *   Library/opengym-media/<hash>.<playExt>   one file per photo, GIF or video
 *   Library/opengym-media/index.json          { hash: { mime, size, putAt, shownAt, pending, rejected } }
 *
 * Directory.Library is iOS's Library folder (kept in device backups, never shown in Files) and
 * Android's files directory. Android's cloud backup is told to leave the folder out
 * (res/xml/backup_rules.xml): Auto Backup skips an app's WHOLE backup once it passes 25 MB, and
 * that would take the state mirror down with the videos.
 *
 * Files are shown by their file URL through the WebView's local server — no copy into memory,
 * and a long video can seek. That server types a file by its extension and will not hand a
 * .mov to <video> as something it plays, so a MOV is stored as .mp4 (MEDIA_MIMES playExt).
 *
 * Crash safety: a file is written to <name>.part and renamed once complete, and the index is
 * written after the files it lists (1 s debounce, flushed when the app goes to the background).
 * At start the two are inspected: an index entry without its file is dropped, and a file
 * without an entry is checked against its name's sha256 and retained locally. Unreadable or
 * mismatching originals are never deleted by startup. Owners use opengym-media/owners/<digest>.
 *
 * Big files cross the native bridge as base64 in 3 MB pieces (writeFile, then appendFile), never
 * as one 50 MB string.
 */
import { MEDIA_MIMES } from './media-refs.js'
import { sniffKind } from './media-sniff.js'
import { sha256Hex } from './sha256.js'

const CHUNK = 3 * 1024 * 1024   // a multiple of 3, so no piece but the last has base64 padding
const FILE_RE = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|webm)$/

/** Uint8Array → base64, in slices small enough for String.fromCharCode's argument limit. */
export function toBase64(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}

const fileName = (hash, mime) => hash + '.' + (MEDIA_MIMES[mime]?.playExt || 'bin')

function createFSBackend({
  directory = 'opengym-media',
  load = () => import('@capacitor/filesystem'),
  core = () => import('@capacitor/core'),
  app = () => import('@capacitor/app'),
  fetchImpl = (...a) => globalThis.fetch(...a),
  hash = sha256Hex,
  debounceMs = 1000
} = {}) {
  const DIR = directory, INDEX = DIR + '/index.json'
  let FS = null, Directory = null, Encoding = null, convert = s => s
  let recs = {}
  let writeTm = null
  let writing = Promise.resolve()
  const uris = new Map()

  const opts = path => ({ path, directory: Directory.Library })
  const uriOf = async name => {
    if (uris.has(name)) return uris.get(name)
    const { uri } = await FS.getUri(opts(DIR + '/' + name))
    const u = convert(uri)
    uris.set(name, u)
    return u
  }
  const readFileBlob = async name => {
    const r = await fetchImpl(await uriOf(name))
    if (!r.ok) throw Object.assign(new Error('read ' + r.status), { code: r.status === 404 ? 'media-missing' : 'media-read-failed' })
    return r.blob()
  }
  const saveIndex = () => {
    writing = writing.catch(() => {}).then(() => FS.writeFile({ ...opts(INDEX), data: JSON.stringify(recs), encoding: Encoding.UTF8, recursive: true }))
    return writing
  }
  const scheduleIndex = () => {
    clearTimeout(writeTm)
    writeTm = setTimeout(() => { writeTm = null; saveIndex().catch(() => {}) }, debounceMs)
  }
  const flush = () => { if (writeTm) { clearTimeout(writeTm); writeTm = null; return saveIndex() } return writing }

  return {
    name: 'fs',
    persistent: true,
    flush,
    async open() {
      try {
        const m = await load()
        FS = m.Filesystem; Directory = m.Directory; Encoding = m.Encoding
        try { const c = await core(); if (c?.Capacitor?.convertFileSrc) convert = u => c.Capacitor.convertFileSrc(u) } catch { /* the raw URI then */ }
      } catch { return false }
      try { await FS.mkdir({ ...opts(DIR), recursive: true }) } catch { /* already there */ }
      try {
        const r = await FS.readFile({ ...opts(INDEX), encoding: Encoding.UTF8 })
        const parsed = JSON.parse(r.data)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-media-index')
        recs = parsed
      } catch (error) {
        if (!/does not exist|not found|ENOENT/i.test(String(error?.message || error?.code))) throw error
        recs = {}
      }
      let names = []
      try {
        const r = await FS.readdir(opts(DIR))
        if (!Array.isArray(r.files)) throw new Error('invalid-media-listing')
        names = r.files.map(f => (typeof f === 'string' ? f : f?.name)).filter(Boolean)
      } catch (error) { throw error }
      const present = new Set(names)
      let changed = false
      // Entries whose file is gone: the file was never renamed into place, or was deleted.
      for (const [h, r] of Object.entries(recs)) {
        if (!/^[a-f0-9]{64}$/.test(h) || !r || !MEDIA_MIMES[r.mime]) throw new Error('invalid-media-index')
        if (!present.has(fileName(h, r.mime))) { delete recs[h]; changed = true }
      }
      for (const name of names) {
        if (name.endsWith('.part')) continue // another factory may still be writing it
        const m = FILE_RE.exec(name)
        if (!m || recs[m[1]]) continue
        // A file the index never got to list (the app died within the debounce). Its name is
        // its hash; mismatching bytes remain quarantined, without a readable association.
        try {
          const blob = await readFileBlob(name)
          const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
          const sniffed = sniffKind(head)
          if ((await hash(blob)) !== m[1] || !sniffed || !MEDIA_MIMES[sniffed.mime]) continue // quarantine uncertain originals
          recs[m[1]] = { hash: m[1], mime: sniffed.mime, size: blob.size, putAt: Date.now(), shownAt: 0, pending: false, rejected: false }
          changed = true
        } catch (error) { throw error } // IO is not evidence that an original can be deleted
      }
      if (changed) await saveIndex()
      app().then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (!isActive) void flush().catch(() => {}) })).catch(() => {})
      return true
    },
    async all() { return Object.entries(recs).map(([h, r]) => ({ ...r, hash: h })) },
    async getBlob(h) {
      const r = recs[h]
      if (!r) return null
      try { return await readFileBlob(fileName(h, r.mime)) } catch (error) { if (error.code === 'media-missing') return null; throw error }
    },
    async put(rec, blob) {
      const name = fileName(rec.hash, rec.mime)
      const part = DIR + '/' + name + '.part'
      for (let o = 0; o < blob.size || o === 0; o += CHUNK) {
        const data = toBase64(new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer()))
        if (o === 0) await FS.writeFile({ ...opts(part), data, recursive: true })
        else await FS.appendFile({ ...opts(part), data })
        if (!blob.size) break
      }
      // Never unlink the prior original before replacement. If the platform refuses rename,
      // keep both the original and the recoverable .part and report the local IO failure.
      await FS.rename({ from: part, to: DIR + '/' + name, directory: Directory.Library, toDirectory: Directory.Library })
      uris.delete(name)
      recs[rec.hash] = { ...rec }
      scheduleIndex()
    },
    async patch(h, fields) {
      if (!recs[h]) return
      recs[h] = { ...recs[h], ...fields }
      scheduleIndex()
    },
    async remove(h) {
      const r = recs[h]
      if (!r) return
      delete recs[h]
      const name = fileName(h, r.mime)
      uris.delete(name)
      // The file first: a crash in between leaves an index entry without its file, which the
      // next start drops. The other order would leave a file without an entry, which that start
      // would take for an unlisted new one and keep.
      try { await FS.deleteFile(opts(DIR + '/' + name)) } catch { /* already gone */ }
      scheduleIndex()
    },
    async clear() {
      recs = {}
      uris.clear()
      clearTimeout(writeTm)
      writeTm = null
      await writing
      try { await FS.rmdir({ ...opts(DIR), recursive: true }) } catch { /* nothing there */ }
      try { await FS.mkdir({ ...opts(DIR), recursive: true }) } catch { /* the next put makes it */ }
    },
    async fileUrl(h) {
      const r = recs[h]
      return r ? uriOf(fileName(h, r.mime)) : null
    }
  }
}

// Capacitor can have several consumers/factories for one owner. Share its live index and
// serialize native mutations so no cached factory overwrites a peer's newly written entry.
const pools = new WeakMap()
export function fsBackend(options = {}) {
  let selected, opening
  const open = () => opening ||= (async () => {
    const load = options.load || (() => import('@capacitor/filesystem'))
    let mod
    try { mod = await load() } catch { return false }
    const key = options.ownerKey ?? null
    let owners = pools.get(mod.Filesystem)
    if (!owners) pools.set(mod.Filesystem, owners = new Map())
    if (!owners.has(key)) {
      const directory = key === null ? 'opengym-media' : 'opengym-media/owners/' + await sha256Hex(new TextEncoder().encode(key))
      // Recheck after hashing: another factory can have installed this owner meanwhile.
      if (!owners.has(key)) {
        const backend = createFSBackend({ ...options, directory, load: async () => mod })
        const entry = { backend, ready: null, tail: Promise.resolve() }
        owners.set(key, entry)
        entry.ready = backend.open().catch(error => { if (owners.get(key) === entry) owners.delete(key); throw error })
      }
    }
    selected = owners.get(key)
    return selected.ready
  })().catch(error => { opening = null; throw error })
  const result = { name: 'fs', persistent: true, open }
  for (const method of ['all', 'getBlob', 'fileUrl', 'flush', 'put', 'patch', 'remove', 'clear']) {
    result[method] = async (...args) => {
      if (!await open()) throw new Error('media-storage-unavailable')
      const job = selected.tail.then(() => selected.backend[method](...args))
      selected.tail = job.catch(() => {})
      return job
    }
  }
  return result
}
