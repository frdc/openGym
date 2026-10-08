import { act } from 'react'
import { fakeStorage } from '../lib/cloud/test-fixtures.js'
import { makeOwner, makeEnvelope } from '../lib/cloud/model.js'
import { encodeState } from '../lib/cloud/codec.js'

// Opt-in test fixture. Supply actual factories to avoid the file-local store mock cycle.
export function createUIStoreFixture(createWorkoutStore, freshState) {
  const projectId = 'demo-opengym'
  const guest = makeOwner(projectId)
  const newStore = (storage, options = {}) => createWorkoutStore({
    projectId, config: {}, client: null, remote: null, storage,
    authFactory: () => ({ ready: Promise.resolve(null), stop() {} }),
    legacyReader: { read: async () => [] }, lifecycle: false, ...options,
  })
  let current = newStore(fakeStorage()), storage, prepared = false
  function useStore(selector) { return current(selector) }
  for (const name of ['getState', 'getInitialState', 'setState']) {
    useStore[name] = (...args) => current[name](...args)
  }
  const subscriptions = new Map()
  useStore.subscribe = listener => {
    subscriptions.set(listener, current.subscribe(listener))
    return () => { subscriptions.get(listener)?.(); subscriptions.delete(listener) }
  }
  const close = async () => {
    await act(async () => {
      try { await current.getState().flushLocal() }
      finally { await current.getState().dispose() }
    })
  }
  return {
    useStore,
    async attach(store) {
      await close()
      current = store
      for (const [listener, stop] of subscriptions) { stop(); subscriptions.set(listener, current.subscribe(listener)) }
      prepared = current.getState().localReady
    },
    begin() { prepared = false },
    async applySnapshot(snapshot) {
      const patch = typeof snapshot === 'function' ? snapshot(current.getState()) : snapshot
      const { S, user: _user, ready: _ready, localReady: _localReady, ownerKey: _owner, activeSessionToken: _token, ...methods } = patch
      if (S) {
        if (!prepared) await this.prepare(S)
        else await act(async () => { this.setFixture(draft => { for (const key of Object.keys(draft)) delete draft[key]; Object.assign(draft, S) }); await this.flush() })
      }
      if (Object.keys(methods).length) current.setState(methods)
    },
    async prepare(initialS = {}, options = {}) {
      await close()
      const S = structuredClone({ ...freshState(), ...initialS })
      encodeState(S, { generation: 1, unitVersion: 1 })
      storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, S) })
      current = newStore(storage, options)
      for (const [listener, stop] of subscriptions) { stop(); subscriptions.set(listener, current.subscribe(listener)) }
      await current.getState().boot()
      if (!current.getState().localReady || current.getState().ownerKey !== guest.ownerKey) {
        const reason = current.getState().sync.localError?.code
        await current.getState().dispose()
        throw new Error('ui-fixture-hydration-failed:' + reason)
      }
      prepared = true
      return current
    },
    // Mid-test fixtures go through the real admission path, retaining stale-copy semantics.
    setFixture(producer) { current.getState().update(producer, false) },
    flush: async () => { await act(async () => { await current.getState().flushLocal() }) },
    close,
    saved: () => storage.read(guest.ownerKey),
    commits: () => storage.confirmedRevisions,
  }
}
