import { it, expect } from 'vitest'
import { fixtureState } from './test-fixtures.js'
import { makeOwner } from './model.js'
import { encodeState, decodeState, prepareOperation, mergeOperation } from './codec.js'
import { stampChange } from '../sync-merge.js'

// Retains the unseen-unstar invariant from sync-merge.test.js through the real
// granular codec, before retirement of the old whole-profile Node simulator.
it('a re-star over an earlier unseen unstar affects only its exerciseState record', () => {
  const options = { ownerKey: makeOwner('demo-opengym', 'test-user').ownerKey, generation: 1, unitVersion: 1 }
  const control = { schemaVersion: 1, generation: 1, dataRevision: 1, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
  const base = fixtureState({ unit: 'kg', favEx: [], _ts: 1 })
  const at = (before, favEx, now) => { const next = structuredClone(before); next.favEx = favEx; next._ts = stampChange(before, next, now); return next }
  const phone = at(at(base, ['bench'], 10), [], 20), tablet = at(base, ['bench'], 30)
  const operation = prepareOperation(base, tablet, { ...options, kind: 'update', opId: 'unseen-restar' })
  expect(operation.paths).toEqual(['exerciseState/YmVuY2g'])
  const documents = encodeState(phone, options).documents
  const result = mergeOperation(documents, operation, { control, domainContext: { remoteProfile: { control, documents }, remoteState: phone } })
  expect(Object.keys(result.documentsToWrite)).toEqual(['exerciseState/YmVuY2g'])
  expect(decodeState({ ...documents, ...result.documentsToWrite }, { generation: 1 }).favEx).toEqual(['bench'])
})
