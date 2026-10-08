import { it, expect } from 'vitest'
import { createSyncStatus } from './sync-status.js'

it('keeps durability and cloud errors independent and snapshots detached', () => {
  const status = createSyncStatus()
  const seen = []
  const stop = status.subscribe(value => seen.push(value))
  status.update({ local: 'saved', cloud: 'blocked', cloudError: { code: 'document-too-large', path: 'workouts/a' } })
  status.update({ local: 'saving' })
  expect(seen.at(-1)).toMatchObject({ local: 'saving', cloud: 'blocked', cloudError: { code: 'document-too-large', path: 'workouts/a' } })
  seen.at(-1).cloudError.code = 'changed'
  expect(status.get().cloudError.code).toBe('document-too-large')
  stop(); status.update({ local: 'error', localError: { code: 'storage-full' } })
  expect(seen).toHaveLength(3)
})
