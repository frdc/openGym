import { DEF } from '../../store/state-defaults.js'
import { makeEnvelope, makeOwner } from './model.js'

export const fixtureState = (overrides = {}) => structuredClone({ ...DEF, ...overrides })
export const fixtureEnvelope = (overrides = {}) => ({
  ...makeEnvelope(makeOwner('demo-opengym', 'test-user'), fixtureState()), ...structuredClone(overrides),
})
