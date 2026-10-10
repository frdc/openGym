// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { runtime, owner } from './cloud-test-runtime.js'
import { getMediaStore, _setMediaStore } from '../lib/media-store.js'
import { localMediaGc } from '../lib/local-media.js'
const A = 'a'.repeat(64), P = 'b'.repeat(64)
const photo = { kind: 'image', hash: A, mime: 'image/webp', size: 3, width: 8, height: 6, poster: { hash: P, mime: 'image/webp', size: 3, width: 8, height: 6 }, at: 1 }
const exercise = { id: 'c1', n: 'Carry', bp: 'back', custom: true }
const workout = { id: 'w1', d: '2026-09-20', start: 1, end: 2, entries: [] }
afterEach(() => _setMediaStore(null))
async function withPhoto(kind) {
  const rt = await runtime({ cloud: true, profiles: { A: { customEx: [exercise], workouts: [workout] } } })
  await rt.auth('A'); await rt.sync()
  const media = getMediaStore(owner('A').ownerKey)
  for (const h of [A, P]) await media.put(h, new Blob(['abc']), { mime: 'image/webp' })
  rt.store.getState().update(s => { if (kind === 'custom') s.customEx[0].media = photo; else s.workouts[0].media = [photo] })
  await rt.store.getState().flushLocal()
  return { ...rt, media }
}
describe.each(['custom', 'workout'])('%s local originals', kind => {
  it('create no media upload debt and do not block sign-out', async () => {
    const rt = await withPhoto(kind)
    expect(rt.store.getState().unsyncedChanges()).toMatchObject({ owed: false, count: 0 })
    expect((await rt.saved()).pendingOperations).toEqual([])
    expect(await rt.media.pendingHashes()).toEqual(new Set())
    expect(await rt.store.getState().signOut()).toMatchObject({ owed: false })
    expect(rt.store.getState().user).toBeNull()
    expect(await rt.media.has(A)).toBe(true)
  })
  it('preserve main and poster in A while B has neither associations nor byte access', async () => {
    const rt = await withPhoto(kind)
    await rt.auth('B')
    const b = getMediaStore(owner('B').ownerKey)
    expect(rt.store.getState().S.customEx).toEqual([])
    expect(rt.store.getState().S.workouts).toEqual([])
    for (const h of [A, P]) { expect(await b.get(h)).toBeNull(); expect(await rt.media.has(h)).toBe(true) }
    await rt.auth('A')
    const saved = kind === 'custom' ? rt.store.getState().S.customEx[0].media : rt.store.getState().S.workouts[0].media[0]
    expect(saved).toEqual(photo)
  })
  it('retains removed originals across sign-out and reset without a physical GC lock', async () => {
    const rt = await withPhoto(kind), key = rt.store.getState().ownerKey
    rt.store.getState().update(s => { if (kind === 'custom') delete s.customEx[0].media; else delete s.workouts[0].media })
    await rt.store.getState().flushLocal()
    await localMediaGc(key, { appStore: rt.store })
    await rt.store.getState().resetEverything()
    await rt.store.getState().signOut({ force: true })
    expect(await rt.media.has(A)).toBe(true); expect(await rt.media.has(P)).toBe(true)
  })
})
it('still stamps only the edited custom exercise', async () => {
  const rt = await runtime({ initial: { customEx: [exercise, { ...exercise, id: 'c2', _ts: 5 }] } })
  rt.store.getState().update(s => { s.customEx[0].url = 'https://example.com/guide' })
  expect(rt.store.getState().S.customEx[0]._ts).toBeGreaterThan(5)
  expect(rt.store.getState().S.customEx[1]._ts).toBe(5)
})
