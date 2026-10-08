import { describe, it, expect, vi } from 'vitest'
import { fsBackend, toBase64 } from './media-store-fs.js'
import { sha256Hex } from './sha256.js'
import { jpeg, mp4 } from './media-samples.test-util.js'

// Capacitor's Filesystem, in memory: files as base64 (or UTF-8 text for index.json), keyed by
// path. Each call is recorded, so the tests can see how a big file crossed the bridge.
function fakeFs() {
  const files = new Map()
  const calls = []
  const fromB64 = s => new Uint8Array(Buffer.from(s, 'base64'))
  const Filesystem = {
    async mkdir() {},
    async readFile({ path, encoding }) {
      calls.push(['readFile', path])
      if (!files.has(path)) throw new Error('File does not exist')
      const v = files.get(path)
      return { data: encoding ? new TextDecoder().decode(v) : toBase64(v) }
    },
    async writeFile({ path, data, encoding }) {
      calls.push(['writeFile', path, encoding ? data.length : fromB64(data).length])
      files.set(path, encoding ? new TextEncoder().encode(data) : fromB64(data))
    },
    async appendFile({ path, data }) {
      calls.push(['appendFile', path, fromB64(data).length])
      const cur = files.get(path) || new Uint8Array(0)
      const add = fromB64(data)
      const next = new Uint8Array(cur.length + add.length)
      next.set(cur); next.set(add, cur.length)
      files.set(path, next)
    },
    async rename({ from, to }) { calls.push(['rename', from, to]); files.set(to, files.get(from)); files.delete(from) },
    async deleteFile({ path }) { calls.push(['deleteFile', path]); if (!files.delete(path)) throw new Error('missing') },
    async readdir({ path }) { return { files: [...files.keys()].filter(k => k.startsWith(path + '/')).map(k => ({ name: k.slice(path.length + 1), type: 'file' })) } },
    async getUri({ path }) { return { uri: 'file:///lib/' + path } },
    async rmdir({ path }) { for (const k of [...files.keys()]) if (k.startsWith(path + '/')) files.delete(k) }
  }
  const mod = { Filesystem, Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' } }
  // The WebView's local server: a file URL answers the file's bytes.
  const fetchImpl = async url => {
    const path = String(url).replace('capacitor://localhost/_capacitor_file_/lib/', '')
    const v = files.get(path)
    return v ? { ok: true, blob: async () => new Blob([v]) } : { ok: false, status: 404 }
  }
  const core = async () => ({ Capacitor: { convertFileSrc: u => u.replace('file:///', 'capacitor://localhost/_capacitor_file_/') } })
  const app = async () => ({ App: { addListener: vi.fn() } })
  return { files, calls, deps: { load: async () => mod, core, app, fetchImpl, debounceMs: 5 } }
}
const tick = ms => new Promise(r => setTimeout(r, ms))

describe('the phone backend', () => {
  it('writes a big file in 3 MB pieces, renames it into place, and lists it after the index', async () => {
    const fs = fakeFs()
    const be = fsBackend(fs.deps)
    expect(await be.open()).toBe(true)
    const big = new Uint8Array(7 * 1024 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff
    const hash = await sha256Hex(big)
    await be.put({ hash, mime: 'video/quicktime', size: big.length, putAt: 1, shownAt: 0, pending: true, rejected: false }, new Blob([big]))
    const writes = fs.calls.filter(c => c[0] === 'writeFile' || c[0] === 'appendFile')
    expect(writes.map(c => [c[0], c[2]])).toEqual([['writeFile', 3 * 1024 * 1024], ['appendFile', 3 * 1024 * 1024], ['appendFile', 1024 * 1024]])
    expect(writes.every(c => c[1] === `opengym-media/${hash}.mp4.part`)).toBe(true)   // a MOV is named .mp4
    // Compared by hash: a deep equal over 7 MB element by element takes minutes.
    expect(await sha256Hex(fs.files.get(`opengym-media/${hash}.mp4`))).toBe(hash)
    expect(fs.files.has(`opengym-media/${hash}.mp4.part`)).toBe(false)
    expect(await be.fileUrl(hash)).toBe(`capacitor://localhost/_capacitor_file_/lib/opengym-media/${hash}.mp4`)
    expect(await sha256Hex(await be.getBlob(hash))).toBe(hash)
    await tick(20)
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('opengym-media/index.json')))[hash]).toMatchObject({ mime: 'video/quicktime', pending: true })
  })

  it('on start, recovers validated local files and quarantines mismatches and interrupted writes', async () => {
    const fs = fakeFs()
    const photo = jpeg()
    const video = mp4().file
    const ph = await sha256Hex(photo)
    const vh = await sha256Hex(video)
    const gone = 'f'.repeat(64)
    fs.files.set(`opengym-media/${ph}.jpg`, photo)
    fs.files.set(`opengym-media/${vh}.mp4`, video)
    fs.files.set(`opengym-media/${'e'.repeat(64)}.jpg`, photo)         // bytes that do not match the name
    fs.files.set(`opengym-media/${'d'.repeat(64)}.webp.part`, photo)   // half a write
    fs.files.set('opengym-media/index.json', new TextEncoder().encode(JSON.stringify({
      [vh]: { hash: vh, mime: 'video/mp4', size: video.length, putAt: 5, shownAt: 0, pending: false, rejected: false },
      [gone]: { hash: gone, mime: 'image/webp', size: 10, putAt: 5, shownAt: 0, pending: false, rejected: false }
    })))
    const be = fsBackend(fs.deps)
    await be.open()
    const recs = Object.fromEntries((await be.all()).map(r => [r.hash, r]))
    expect(Object.keys(recs).sort()).toEqual([ph, vh].sort())
    expect(recs[ph]).toMatchObject({ mime: 'image/jpeg', size: photo.length, pending: false })
    expect(recs[vh]).toMatchObject({ pending: false })
    await tick(5)
    expect(fs.files.has(`opengym-media/${'e'.repeat(64)}.jpg`)).toBe(true)
    expect(fs.files.has(`opengym-media/${'d'.repeat(64)}.webp.part`)).toBe(true)
  })

  it('removes the file before the index entry, and clear empties the folder', async () => {
    const fs = fakeFs()
    const be = fsBackend(fs.deps)
    await be.open()
    const photo = jpeg()
    const h = await sha256Hex(photo)
    await be.put({ hash: h, mime: 'image/jpeg', size: photo.length, putAt: 1, shownAt: 0, pending: true, rejected: false }, new Blob([photo]))
    await be.remove(h)
    expect(fs.files.has(`opengym-media/${h}.jpg`)).toBe(false)
    expect(await be.all()).toEqual([])
    await be.put({ hash: h, mime: 'image/jpeg', size: photo.length, putAt: 1, shownAt: 0, pending: true, rejected: false }, new Blob([photo]))
    await be.clear()
    expect([...fs.files.keys()].filter(k => k.startsWith('opengym-media/') && !k.endsWith('index.json'))).toEqual([])
  })

  it('answers false when there is no Filesystem plugin at all', async () => {
    const be = fsBackend({ load: async () => { throw new Error('not a Capacitor build') } })
    expect(await be.open()).toBe(false)
  })
})


describe('native startup uncertainty', () => {
  it('preserves unindexed originals when WebView reads fail', async () => {
    const fs = fakeFs(), photo = jpeg(), h = await sha256Hex(photo)
    fs.files.set(`opengym-media/${h}.jpg`, photo)
    const be = fsBackend({ ...fs.deps, fetchImpl: async () => { throw new Error('temporary IO') } })
    await be.open().catch(() => false)
    expect(fs.files.has(`opengym-media/${h}.jpg`)).toBe(true)
    expect(fs.files.has('opengym-media/index.json')).toBe(false)
  })
  it('does not replace unreadable index evidence', async () => {
    const fs = fakeFs(), broken = new TextEncoder().encode('{broken')
    fs.files.set('opengym-media/index.json', broken)
    fs.files.set(`opengym-media/${await sha256Hex(jpeg())}.jpg`, jpeg())
    await fsBackend(fs.deps).open().catch(() => false)
    expect(fs.files.get('opengym-media/index.json')).toEqual(broken)
  })
  it('scopes equal hashes and shares writes across factories for one native owner', async () => {
    const fs = fakeFs(), h = await sha256Hex(jpeg())
    const a = fsBackend({ ...fs.deps, ownerKey: 'A' }), b = fsBackend({ ...fs.deps, ownerKey: 'B' })
    await a.open(); await b.open()
    await a.put({ hash: h, mime: 'image/jpeg', size: jpeg().length }, new Blob([jpeg()]))
    expect(await b.getBlob(h)).toBeNull()
    expect(await b.all()).toEqual([])
    const peer = fsBackend({ ...fs.deps, ownerKey: 'A' }); await peer.open()
    expect(await peer.getBlob(h)).not.toBeNull()
    await peer.put({ hash: 'b'.repeat(64), mime: 'image/jpeg', size: 1 }, new Blob(['b']))
    expect((await a.all()).map(r => r.hash)).toContain('b'.repeat(64))
    await a.flush()
  })
})

it('readdir failure neither prunes indexed originals nor rewrites an empty index', async () => {
  const fs = fakeFs(), h = await sha256Hex(jpeg())
  const original = new TextEncoder().encode(JSON.stringify({ [h]: { hash: h, mime: 'image/jpeg', size: jpeg().length } }))
  fs.files.set('opengym-media/index.json', original); fs.files.set(`opengym-media/${h}.jpg`, jpeg())
  const mod = await fs.deps.load(); mod.Filesystem.readdir = async () => { throw new Error('IO') }
  await expect(fsBackend(fs.deps).open()).rejects.toThrow('IO')
  expect(fs.files.get('opengym-media/index.json')).toEqual(original)
  expect(fs.calls.filter(c => c[0] === 'deleteFile')).toEqual([])
})

it('a parseable but invalid index is preserved as evidence instead of rewritten empty', async () => {
  const fs = fakeFs(), original = new TextEncoder().encode(JSON.stringify({ ['a'.repeat(64)]: { mime: 'not-media', size: 1 } }))
  fs.files.set('opengym-media/index.json', original)
  await expect(fsBackend(fs.deps).open()).rejects.toThrow('invalid-media-index')
  expect(fs.files.get('opengym-media/index.json')).toEqual(original)
})

it('can retry a transient original-read failure without clearing its recovery evidence', async () => {
  const fs = fakeFs(), h = await sha256Hex(jpeg())
  fs.files.set(`opengym-media/${h}.jpg`, jpeg())
  let failed = true
  const be = fsBackend({ ...fs.deps, fetchImpl: async url => { if (failed) throw new Error('transient'); return fs.deps.fetchImpl(url) } })
  await expect(be.open()).rejects.toThrow('transient')
  expect(fs.files.has(`opengym-media/${h}.jpg`)).toBe(true)
  failed = false
  expect(await be.open()).toBe(true)
  expect(await be.getBlob(h)).not.toBeNull()
})

it('a replacement rename failure cannot delete an existing original', async () => {
  const fs = fakeFs(), be = fsBackend(fs.deps), h = await sha256Hex(jpeg())
  await be.open()
  const rec = { hash: h, mime: 'image/jpeg', size: jpeg().length }
  await be.put(rec, new Blob([jpeg()]))
  const mod = await fs.deps.load(); mod.Filesystem.rename = async () => { throw new Error('rename IO') }
  await expect(be.put(rec, new Blob([jpeg()]))).rejects.toThrow('rename IO')
  expect(fs.files.get(`opengym-media/${h}.jpg`)).toEqual(jpeg())
  await be.flush()
})
