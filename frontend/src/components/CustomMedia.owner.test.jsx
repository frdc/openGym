// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
const h = vi.hoisted(() => ({ fixture: null, ingest: null }))
vi.mock('../store/useStore.js', async importOriginal => {
  const actual = await importOriginal()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  h.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: h.fixture.useStore }
})
vi.mock('../lib/media-ingest.js', () => ({ ingestMediaFile: (...args) => h.ingest(...args) }))
import { runtime, deferred, owner } from '../store/cloud-test-runtime.js'
import { getMediaStore, createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { useMediaUrl } from './CustomMedia.jsx'
import WorkoutMediaSection from './WorkoutMedia.jsx'
const hash = 'a'.repeat(64)
const mediaRef = { kind: 'image', hash, mime: 'image/jpeg', size: 3, width: 1, height: 1, at: 1 }
const w = { id: 'w', d: '2026-09-01', start: 1, end: 2, entries: [] }
let rt, host, root, a
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  rt = await runtime(); await rt.auth('A')
  rt.store.getState().update(s => { s.workouts = [w] }); await rt.store.getState().flushLocal()
  await h.fixture.attach(rt.store)
  a = createMediaStore({ ...memoryBackend(), persistent: true })
  _setMediaStore(a, owner('A').ownerKey)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); _setMediaStore(null); await h.fixture.close() })
function UrlProbe() { const value = useMediaUrl(mediaRef); return <span>{value.url || value.status}</span> }
it('releases a late A URL in A and never displays it for B even with the same hash', async () => {
  const wait = deferred(); a.url = () => wait.promise
  const release = vi.spyOn(a, 'release')
  act(() => root.render(<UrlProbe />)); await settle()
  await act(async () => rt.auth('B'))
  await act(async () => wait.resolve('blob:A'))
  expect(host.textContent).not.toContain('blob:A')
  expect(release).toHaveBeenCalledWith(hash)
  expect(await getMediaStore(owner('B').ownerKey).has(hash)).toBe(false)
})
it('rejects a delayed picker result after A to B to A and does not attach it to a matching workout', async () => {
  const wait = deferred(); h.ingest = vi.fn(() => wait.promise)
  act(() => root.render(<WorkoutMediaSection w={w} />)); await settle()
  const input = host.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [new File(['abc'], 'photo.jpg')], configurable: true })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle(); expect(h.ingest).toHaveBeenCalledOnce()
  await act(async () => { await rt.auth('B'); rt.store.getState().update(s => { s.workouts = [w] }); await rt.auth('A') })
  await act(async () => wait.resolve({ media: mediaRef, blobs: [{ hash, mime: 'image/jpeg', blob: new Blob(['abc']) }], warnings: [] }))
  expect(rt.store.getState().S.workouts[0].media).toBeUndefined()
  expect(await a.has(hash)).toBe(false)
})
