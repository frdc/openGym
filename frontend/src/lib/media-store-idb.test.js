import { describe, test, expect } from 'vitest'
import { idbBackend } from './media-store-idb.js'

/* Just enough IndexedDB for the backend: one database, one object store keyed by `hash`, requests
   that answer on the next tick and transactions that complete after their last request. Values
   are kept as they are put, so a test can plant a record in the old `blob` shape. */
function fakeIdb() {
  const rows = new Map()
  const later = fn => setTimeout(fn, 0)
  const request = run => {
    const r = { onsuccess: null, onerror: null, result: undefined }
    later(() => { r.result = run(); r.onsuccess?.() })
    return r
  }
  const db = {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    close() {},
    transaction() {
      const t = { oncomplete: null, onerror: null, onabort: null, pending: 0 }
      const settle = () => { if (--t.pending === 0) later(() => t.oncomplete?.()) }
      const track = run => { t.pending++; return request(() => { const v = run(); later(settle); return v }) }
      t.objectStore = () => ({
        put: v => track(() => { rows.set(v.hash, v) }),
        get: k => track(() => rows.get(k)),
        delete: k => track(() => { rows.delete(k) }),
        openCursor: () => {
          const list = [...rows.values()]
          const r = { onsuccess: null, onerror: null, result: null }
          let i = 0
          const step = () => later(() => {
            r.result = i < list.length ? { value: list[i], continue: () => { i++; step() } } : null
            r.onsuccess?.()
          })
          step()
          return r
        }
      })
      return t
    }
  }
  return {
    rows,
    open() {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: db }
      later(() => r.onsuccess?.())
      return r
    }
  }
}

const bytesOf = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()))

describe('the IndexedDB media backend', () => {
  test('keeps the bytes as an ArrayBuffer, never the Blob, and hands back a readable Blob', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    expect(await be.open()).toBe(true)
    await be.put({ hash: 'h1', mime: 'video/quicktime', size: 3 }, new Blob([new Uint8Array([1, 2, 3])]))
    const row = idb.rows.get('h1')
    expect(row.blob).toBeUndefined()
    expect(row.data).toBeInstanceOf(ArrayBuffer)
    const back = await be.getBlob('h1')
    expect(back.type).toBe('video/quicktime')
    expect(await bytesOf(back)).toEqual([1, 2, 3])
    expect(await be.all()).toEqual([{ hash: 'h1', mime: 'video/quicktime', size: 3 }])
  })

  test('an old record whose Blob WebKit can no longer read reports IO rather than authorizing recovery as absent', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    const dead = { size: 37535282, type: 'video/quicktime', arrayBuffer: () => Promise.reject(new Error('WebKitBlobResource error 1')) }
    idb.rows.set('h2', { hash: 'h2', mime: 'video/quicktime', size: 37535282, blob: dead })
    await expect(be.getBlob('h2')).rejects.toThrow('WebKitBlobResource')
    expect(idb.rows.has('h2')).toBe(true)
  })

  test('an old record that reads short reports incomplete IO', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    idb.rows.set('h3', { hash: 'h3', mime: 'image/webp', size: 10, blob: new Blob([new Uint8Array([9])]) })
    await expect(be.getBlob('h3')).rejects.toThrow('media-read-incomplete')
    expect(idb.rows.has('h3')).toBe(true)
  })

  test('an old readable record is read once and rewritten as data', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    idb.rows.set('h4', { hash: 'h4', mime: 'image/webp', size: 2, blob: new Blob([new Uint8Array([7, 8])]) })
    expect(await bytesOf(await be.getBlob('h4'))).toEqual([7, 8])
    const row = idb.rows.get('h4')
    expect(row.blob).toBeUndefined()
    expect(row.data).toBeInstanceOf(ArrayBuffer)
    expect(await bytesOf(await be.getBlob('h4'))).toEqual([7, 8])
  })
})

test('separate owner databases isolate matching hashes and preserve peer writes', async () => {
  const databases = new Map()
  const idb = { open(name) { if (!databases.has(name)) databases.set(name, fakeIdb()); return databases.get(name).open() } }
  const a = idbBackend({ idb, ownerKey: 'A' }), b = idbBackend({ idb, ownerKey: 'B' }), peer = idbBackend({ idb, ownerKey: 'A' })
  await a.open(); await b.open(); await peer.open()
  await a.put({ hash: 'h', mime: 'image/jpeg', size: 1 }, new Blob(['a']))
  expect(await b.getBlob('h')).toBeNull(); expect(await b.all()).toEqual([])
  expect(await (await peer.getBlob('h')).text()).toBe('a')
  await peer.put({ hash: 'new', mime: 'image/jpeg', size: 1 }, new Blob(['b']))
  expect((await a.all()).map(r => r.hash)).toEqual(['h', 'new'])
  const legacy = idbBackend({ idb }); await legacy.open()
  expect(await legacy.all()).toEqual([])
})
