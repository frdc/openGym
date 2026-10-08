import { it, expect } from 'vitest'
import { fixtureState } from './test-fixtures.js'
import { makeOwner } from './model.js'
import { prepareOperation, encodeState } from './codec.js'
import { stampChange } from '../sync-merge.js'

const options = { ownerKey: makeOwner('demo-opengym', 'a').ownerKey, generation: 1, unitVersion: 1, opId: 'edit', kind: 'edit' }
const original = () => fixtureState({ customEx: [{ id: 'c', n: 'Custom', media: { hash: 'one' }, _ts: 5, _f: { n: 5, media: 5 } }] })
const change = (before, action) => { const after = structuredClone(before); action(after); after._ts = stampChange(before, after, 100); return [after, prepareOperation(before, after, options)] }

it('does not upload an entity timestamp caused only by a local media edit', () => {
  const before = original()
  const [after, op] = change(before, next => { next.customEx[0].media = { hash: 'two' } })
  expect(after.customEx[0]._ts).toBe(100)
  expect(op).toBeNull()
  expect(encodeState(after, options).localOverlay.entities['customExercises/Yw'].media.hash).toBe('two')
})

it('still uploads mixed media/domain edits, ordinary timestamps and deletion/add-back metadata', () => {
  const before = original()
  const [, mixed] = change(before, next => { next.customEx[0].media = { hash: 'two' }; next.customEx[0].n = 'Renamed' })
  expect(mixed.paths).toEqual(['customExercises/Yw'])
  expect(mixed.payloads['customExercises/Yw'].payload.n).toBe('Renamed')
  expect(mixed.payloads['customExercises/Yw'].payload.media).toBeUndefined()
  const ordinary = structuredClone(before); ordinary.customEx[0]._ts = 101
  expect(prepareOperation(before, ordinary, options).paths).toEqual(['customExercises/Yw'])
  const [removed, deletion] = change(before, next => { next.customEx = []; next.deleted = { customEx: { c: 100 } } })
  expect(deletion.payloads['customExercises/Yw'].deletedAt).toBe(100)
  const [, restored] = change(removed, next => { next.customEx = [{ id: 'c', n: 'Back', media: { hash: 'two' }, _ts: 200 }] })
  expect(restored.paths).toEqual(['customExercises/Yw'])
  expect(restored.payloads['customExercises/Yw'].deletedAt).toBeNull()
})
