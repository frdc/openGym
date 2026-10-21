import { afterEach, expect, it, vi } from 'vitest'
import { createWearSync } from './wear-sync.js'

afterEach(() => vi.useRealTimers())
it('waits for the selected watch to confirm application, not merely message delivery', async () => {
  const requests = [], host = createWearSync({ request: async payload => { requests.push(payload); return { nodeId: 'watch' } } })
  let finished = false
  const result = host.start('session', () => true).then(value => { finished = true; return value })
  await Promise.resolve(); await Promise.resolve()
  expect(finished).toBe(false)
  const response = { v: 1, requestId: requests[0].requestId, contextToken: 'session', status: 'ok', heartPending: 1 }
  host.receive({ nodeId: 'other', response }); expect(finished).toBe(false)
  host.receive({ nodeId: 'watch', response })
  expect(await result).toEqual({ heartPending: 1 })
  expect(host.active).toBe(false)
})
it('retries the same request and preserves a conflict as an error', async () => {
  vi.useFakeTimers()
  const requests = [], host = createWearSync({ request: async payload => { requests.push(payload); return { nodeId: 'watch' } } })
  const result = host.start('session', () => true)
  const failed = expect(result).rejects.toMatchObject({ code: 'sync-conflict' })
  await vi.advanceTimersByTimeAsync(2000)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  host.receive({ nodeId: 'watch', response: { v: 1, requestId: requests[0].requestId, contextToken: 'session', status: 'error', code: 'sync-conflict' } })
  await failed
})
it('does not report success after an owner change or without a watch reply', async () => {
  vi.useFakeTimers()
  let current = true
  const host = createWearSync({ request: async () => ({ nodeId: 'watch' }) })
  const changed = host.start('session', () => current), rejected = expect(changed).rejects.toMatchObject({ code: 'stale-context' })
  current = false
  await vi.advanceTimersByTimeAsync(2000); await rejected
  current = true
  const missing = host.start('session', () => current), timeout = expect(missing).rejects.toMatchObject({ code: 'sync-timeout' })
  await vi.advanceTimersByTimeAsync(30000); await timeout
  expect(host.active).toBe(false)
})
