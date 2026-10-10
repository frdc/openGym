import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { uid } from './format.js'
import { encodeState, decodeState } from './cloud/codec.js'
import { DEF } from '../store/state-defaults.js'
const source = name => readFileSync(new URL(name, import.meta.url), 'utf8')
it('has no Coach/Admin routes or server-only push/activity entry points', () => {
  expect(source('../App.jsx')).not.toMatch(/path="\/(coach|admin)|syncPushSubscription|openDeviceLinkRedeem/)
  expect(source('../views/Workout.jsx')).not.toContain('/api/activity')
  expect(source('../store/useUI.js')).not.toContain('/api/push')
  expect(source('../../public/sw.js')).not.toMatch(/addEventListener\('push/)
})
it('creates UUIDs using the injectable cryptographic generator', () => {
  expect(uid(() => 'injected-uuid')).toBe('injected-uuid')
  expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
it('drops Coach configuration from normal codec output and retains old authored plans', () => {
  const state = { ...structuredClone(DEF), coach: { enabled: true }, queue: { token: 'old-plan', sessions: [] } }
  const encoded = encodeState(state, { generation: 1, unitVersion: 1 })
  expect(encoded.localOverlay.fields).not.toHaveProperty('coach')
  const live = decodeState(encoded.documents, { generation: 1, localOverlay: encoded.localOverlay })
  expect(live).not.toHaveProperty('coach')
  expect(live.queue.token).toBe('old-plan')
  expect(state.coach.enabled).toBe(true)
})
