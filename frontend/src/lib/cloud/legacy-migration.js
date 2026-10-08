import { DEF } from '../../store/state-defaults.js'
import { sha256Hex } from '../sha256.js'
import { makeEnvelope, makeOwner } from './model.js'
import { storageError } from './offline-store.js'

const hashText = text => sha256Hex(new TextEncoder().encode(text))

/** Reusable by imports: resolves legacy workout IDs before any synchronous local
 * or cloud transaction. Ambiguity is an error, never permission to discard an entry.
 */
export async function prepareLegacyState(state) {
  const next = structuredClone(state)
  if (!next || typeof next !== 'object' || Array.isArray(next) || (next.workouts !== undefined && !Array.isArray(next.workouts))) throw storageError('invalid-legacy-state')
  const ids = new Set()
  for (const workout of next.workouts || []) {
    if (!workout || typeof workout !== 'object') throw storageError('invalid-legacy-state')
    if (!workout.id) {
      if (typeof workout.d !== 'string' || !workout.d) throw storageError('ambiguous-workout-identity')
      // The old sync-merge workoutKey was id, else `${d}|${start}`.
      workout.id = 'legacy-' + await hashText(`${workout.d}|${workout.start}`)
    }
    if (typeof workout.id !== 'string' || ids.has(workout.id)) throw storageError('ambiguous-workout-identity')
    ids.add(workout.id)
  }
  return next
}

/** Reader boundary: read() returns [{sourceId,state,ownerKey?,identityProvider?,
 * adoptForOwnerKey?,ownerMetadata?}]. Classification/choice is supplied by the
 * trusted application reader, never taken from fields inside the legacy state.
 * identityProvider='firebase' admits an exact ownerKey; 'guest' admits only guest.
 * markComplete(sourceId,ownerKey,fingerprint), if supplied, runs after reread.
 * newId is reserved for callers; historical identities never use random IDs.
 */
export async function migrateLegacy({ storage, legacyReader, owner, newId: _newId }) {
  if (makeOwner(owner.projectId, owner.uid).ownerKey !== owner.ownerKey) throw storageError('invalid-owner')
  await storage.open()
  const sources = await legacyReader.read()
  if (!sources.length) { const envelope = await storage.read(owner.ownerKey); return { envelope, recoveryCopies: envelope?.recoveryCopies || [] } }
  const copies = []
  for (const source of sources) {
    if (typeof source.sourceId !== 'string' || !source.sourceId || !source.state || typeof source.state !== 'object' || Array.isArray(source.state)) throw storageError('invalid-legacy-state')
    const fingerprint = await hashText(JSON.stringify(source.state))
    const recoveryId = 'legacy-' + await hashText(JSON.stringify([source.sourceId, fingerprint]))
    const admitted = source.adoptForOwnerKey === owner.ownerKey || (source.ownerKey === owner.ownerKey && (source.identityProvider === 'firebase' || (source.identityProvider === 'guest' && owner.uid === null)))
    let prepared, reason = admitted ? null : 'unproven-owner'
    if (admitted) {
      try { prepared = await prepareLegacyState(source.state) }
      catch (error) { if (!['ambiguous-workout-identity', 'invalid-legacy-state'].includes(error.code)) throw error; reason = error.code }
    }
    // Persist only selected identity evidence, never legacy auth/session objects.
    const metadata = {}
    for (const field of ['owner', 'stateOwner', 'ts', 'stateTs', 'consistent']) {
      const value = source.ownerMetadata?.[field]
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) metadata[field] = value
    }
    copies.push({ prepared, copy: { recoveryId, sourceId: source.sourceId, fingerprint, state: structuredClone(source.state), ownerMetadata: metadata, status: 'pending', reason } })
  }
  const committed = await storage.commit(owner.ownerKey, current => {
    const next = structuredClone(current || makeEnvelope(owner, DEF))
    let occupied = current !== null
    for (const { prepared, copy } of copies) {
      if (next.recoveryCopies.some(existing => existing.recoveryId === copy.recoveryId)) continue
      const saved = structuredClone(copy)
      if (!saved.reason && !occupied) {
        next.state = { ...structuredClone(DEF), ...prepared }
        saved.status = 'adopted'
        occupied = true
      } else if (!saved.reason) saved.reason = 'destination-exists'
      next.recoveryCopies.push(saved)
    }
    return next
  })
  const confirmed = await storage.read(owner.ownerKey)
  // A later legitimate writer may already have changed state. Its recovery copies
  // must still retain the exact source and marker confirmed by our commit.
  if (!confirmed || confirmed.ownerKey !== owner.ownerKey || confirmed.localRevision < committed.localRevision || (confirmed.localRevision === committed.localRevision && JSON.stringify(confirmed) !== JSON.stringify(committed)) || copies.some(({ copy }) => {
    const saved = committed.recoveryCopies.find(c => c.recoveryId === copy.recoveryId)
    return !confirmed.recoveryCopies.some(c => c.recoveryId === copy.recoveryId && JSON.stringify(c) === JSON.stringify(saved))
  })) throw storageError('migration-unconfirmed')
  for (const { copy } of copies) await legacyReader.markComplete?.(copy.sourceId, owner.ownerKey, copy.fingerprint)
  return { envelope: confirmed, recoveryCopies: confirmed.recoveryCopies }
}

/** Default readers never infer Firebase identity from Node's user.id or separate
 * owner files. Leave all sources untouched; the UI can classify/decide later.
 * readNative may be nativeLoadLegacyStrict; omit it for browser-only use.
 */
export function createLegacyReader({ localStorage = globalThis.localStorage, readNative } = {}) {
  return {
    async read() {
      const copies = []
      const raw = localStorage?.getItem('gym_state_v1')
      if (raw !== null && raw !== undefined) {
        let state
        try { state = JSON.parse(raw) } catch (error) { throw storageError('legacy-corrupt', error) }
        const owner = localStorage.getItem('gym_owner'), stateOwner = localStorage.getItem('gym_state_owner')
        copies.push({ sourceId: 'browser:gym_state_v1', state, ownerMetadata: { owner, stateOwner, stateTs: state?._ts ?? null, consistent: owner !== null && owner === stateOwner } })
      }
      if (readNative) {
        const native = await readNative()
        if (native) copies.push({ sourceId: 'native:opengym-state.json', state: native.state, ownerMetadata: { ...native.ownerMetadata, stateTs: native.state?._ts ?? null, consistent: native.ownerMetadata?.ts === (native.state?._ts || 0) } })
      }
      return copies
    },
  }
}
