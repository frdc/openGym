// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runtime, owner, state, deferred } from '../store/cloud-test-runtime.js'
import { fakeStorage } from '../lib/cloud/test-fixtures.js'
import { makeEnvelope } from '../lib/cloud/model.js'
import { useStore } from '../store/useStore.js'
import LocalStartup from './LocalStartup.jsx'
import appSource from '../App.jsx?raw'
const fixture = vi.hoisted(() => ({ current: null }))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  fixture.current = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: fixture.current.useStore }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { act(() => root.unmount()); host.remove(); await fixture.current.close() })
function Gated() {
  const ready = useStore(s => s.localReady)
  const S = useStore(s => s.S)
  return ready ? <div data-ready>{S.targetW}</div> : <LocalStartup />
}
const mount = async h => { await fixture.current.attach(h.store); act(() => root.render(<Gated />)) }
const click = async () => { await act(async () => { host.querySelector('button').click(); await Promise.resolve() }) }
const failure = () => Object.assign(new Error('private-storage-diagnostic'), { code: 'storage-unavailable' })
it('keeps normal loading content isolated and routes the App gate through startup recovery', async () => {
  expect(appSource).toMatch(/if \(!localReady\) return <LocalStartup/)
  act(() => root.render(<LocalStartup />))
  expect(host.querySelector('button')).toBeNull(); expect(host.querySelector('[data-ready]')).toBeNull()
})
it('retries a real failed initial read without overwriting stored data or displaying defaults', async () => {
  const storage = fakeStorage({ [owner().ownerKey]: makeEnvelope(owner(), state({ targetW: 777 })) })
  const read = storage.read, gate = deferred(); let fail = true, wait = false
  storage.read = async (...args) => { if (fail) throw failure(); if (wait) await gate.promise; return read(...args) }
  const h = await runtime({ storage }); await mount(h)
  expect(h.store.getState().localReady).toBe(false); expect(storage.confirmedRevisions).toHaveLength(0)
  expect(host.textContent).toContain('Changes could not be saved on this device.'); expect(host.textContent).not.toContain('777')
  expect(host.textContent).not.toContain('private-storage-diagnostic'); expect(host.querySelector('[data-ready]')).toBeNull()
  const retry = vi.spyOn(h.store.getState(), 'retryLocal'); fail = false; wait = true
  await click(); await click(); expect(retry).toHaveBeenCalledOnce(); expect(host.querySelector('button').disabled).toBe(true)
  await act(async () => { gate.resolve(); await retry.mock.results[0].value })
  expect(host.querySelector('[data-ready]').textContent).toBe('777')
})
it('keeps A and the latest B profile hidden after a real departure failure until retry', async () => {
  const storage = fakeStorage({ [owner('B').ownerKey]: makeEnvelope(owner('B'), state({ targetW: 222 })) })
  const h = await runtime({ storage }); await h.auth('A'); await mount(h)
  const commit = storage.commit; let fail = true
  storage.commit = (...args) => fail ? Promise.reject(failure()) : commit(...args)
  await act(async () => { h.store.getState().update(s => { s.targetW = 111 }); await Promise.resolve(); await h.auth('B') })
  expect(host.querySelector('[data-ready]')).toBeNull(); expect(host.textContent).not.toContain('111'); expect(host.textContent).not.toContain('222')
  expect(host.querySelector('button').textContent).toContain('Try again')
  fail = false; await click()
  expect(host.querySelector('[data-ready]').textContent).toBe('222')
  expect((await storage.read(owner('A').ownerKey)).state.targetW).toBe(111)
})
it.each(['unmount', 'owner'])('ignores a late rejected retry after %s changes', async transition => {
  const storage = fakeStorage(), read = storage.read; storage.read = async () => { throw failure() }
  const h = await runtime({ storage }); await mount(h)
  const gate = deferred(), retry = vi.spyOn(h.store.getState(), 'retryLocal').mockReturnValueOnce(gate.promise)
  await click()
  if (transition === 'unmount') act(() => root.render(null))
  else { storage.read = read; await act(async () => { await h.auth('B') }) }
  await act(async () => { gate.reject(failure()); await retry.mock.results[0].value.catch(() => {}) })
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
