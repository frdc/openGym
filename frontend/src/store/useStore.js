import { create } from 'zustand'
import { DEF } from './state-defaults.js'
export { DEF } from './state-defaults.js'
import { stampChange, entryKey, localExtras } from '../lib/sync-merge.js'
import { saveWorkoutEdit, deleteEditedWorkout } from '../lib/session-edit.js'
import { registerCustom, healCustomEx } from '../lib/exercises.js'
import { sanitizeAccent } from '../lib/accent.js'
import { RTL_LANGS } from '../lib/i18n-core.js'
import { localTZ } from '../lib/format.js'
import { MOBILE, nativeLoadLegacyStrict, onAppActive, syncReminder, writeAutoBackup } from '../lib/mobile.js'
import { referencedHashes, referencedFiles } from '../lib/media-refs.js'
import { getMediaStore, legacyMediaStore } from '../lib/media-store.js'
import { createOfflineStorage } from '../lib/cloud/offline-store.js'
import { createLegacyReader, migrateLegacy } from '../lib/cloud/legacy-migration.js'
import { makeOwner, makeEnvelope, recoverableBy, trainingState } from '../lib/cloud/model.js'
import { prepareOperation, decodeState, encodeState } from '../lib/cloud/codec.js'
import { createSyncBridge } from '../lib/cloud/sync-bridge.js'
import { createFirebaseClient, readFirebaseConfig } from '../lib/cloud/firebase-client.js'
import { createAuthSession } from '../lib/cloud/auth-session.js'
import { createFirestorePort } from '../lib/cloud/firestore-port.js'

const clone = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
// Optional object properties are omitted as in prior JSON saves. Everything else
// must be representable before admitting a producer result into the local queue.
function localData(value, path = '', ancestors = new Set()) {
  const invalid = () => { throw failure(`invalid-local-data:${path || '$'}`) }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value }
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid()
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid()
  if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) invalid()
  ancestors.add(value)
  const child = key => path ? `${path}.${key}` : String(key)
  let out
  if (Array.isArray(value)) {
    out = []
    for (let i = 0; i < value.length; i++) out.push(localData(value[i], child(i), ancestors))
  } else out = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, localData(item, child(key), ancestors)]))
  ancestors.delete(value)
  return out
}
const info = error => ({ code: error?.code || error?.message || 'storage-unavailable', path: error?.path || null, opId: null })
const detectedLang = () => { const base = (globalThis.navigator?.language || '').toLowerCase().split('-')[0]; return RTL_LANGS.has(base) ? base : 'en' }
export function freshState() { return { ...clone(DEF), lang: detectedLang(), langAuto: true, weighIn: false, gifSize: 'mini' } }
export function restartedState(cur) { return { ...freshState(), ...(cur?.lang ? { lang: cur.lang, langAuto: cur.langAuto === true } : {}) } }
export const hasData = st => ['workouts', 'routines', 'bodyweight', 'customEx'].some(k => st?.[k]?.length)
// Retained pure compatibility helper for backup consumers; runtime merging belongs to the codec.
export function restoredStateFor(local, remote, dirty = false) {
  if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
  return sanitizeAccent({ ...clone(DEF), ...clone(remote), ...(local.active ? { active: clone(local.active) } : {}) })
}
const compatibilityStatus = status => ({ ...status, pending: !!status.pendingCount, held: status.cloud === 'adoption-required',
  auth: status.cloud === 'auth-required', offline: status.cloud === 'waiting', lastError: status.localError || status.cloudError,
  status: status.local === 'error' || status.cloud === 'blocked' ? 'error' : status.cloud === 'synced' ? 'ok'
    : status.cloud === 'adoption-required' ? 'held' : status.cloud === 'waiting' ? 'offline'
      : status.pendingCount ? 'pending' : 'local' })

/** Local runtime factory, also used by integration tests with real injected ports.
 * Auth authority comes only from authFactory's onUser callback. No window test hooks.
 */
export function createWorkoutStore(options = {}) {
  const config = options.config || readFirebaseConfig()
  const projectId = options.projectId || config.options?.projectId || 'workout-tracker-e0c6c'
  const guest = makeOwner(projectId), newId = options.newId || (() => crypto.randomUUID())
  const storage = options.storage || createOfflineStorage({ mobile: MOBILE })
  const legacyReader = options.legacyReader || createLegacyReader({ ...(MOBILE ? { readNative: () => nativeLoadLegacyStrict() } : {}) })
  const authFactory = options.authFactory || createAuthSession
  let bridge, session, client, bootPromise, stopped = false, epoch = 0, authEpoch = 0, transition = null
  let envelope = null, desiredUser = null, importRead = null, adopting = null, persistRequested = false
  let lastForeground = -Infinity, backupTimer = null
  const departures = new Map(), disposers = [], authWaiters = new Set()
  let latestStatus = { ownerKey: null, localReady: false, local: 'loading', cloud: 'unconfigured', localRevision: 0, pendingCount: 0, blockedCount: 0, localError: null, cloudError: null }
  const store = create((set, get) => {
    const localFailure = error => { if (stopped || ['stale-context', 'stale-auth-epoch'].includes(error?.code)) return; latestStatus = { ...latestStatus, local: 'error', localError: info(error) }; set({ sync: compatibilityStatus(latestStatus) }) }
    const requireReady = () => { if (!get().localReady || stopped) throw failure('local-not-ready') }
    const remind = () => { if (MOBILE && get().localReady) void syncReminder(get().S) }
    function install(state, value) {
      if (stopped || value.ownerKey !== transition?.owner.ownerKey) return
      envelope = value
      const S = sanitizeAccent(state)
      delete S.coach
      S.customEx = healCustomEx(S.customEx)
      registerCustom(S.customEx || [])
      set({ S, ownerKey: value.ownerKey, activeSessionToken: value.localMetadata?.activeSessionToken || null,
        localReady: true, ready: true, user: desiredUser ? { ...desiredUser, id: desiredUser.uid, name: desiredUser.displayName || desiredUser.email || '' } : null,
        recoveryCopies: value.recoveryCopies, adoptionDecision: value.adoptionDecision })
      remind()
    }
    function hide() {
      envelope = null; importRead = null
      registerCustom([])
      set({ S: freshState(), ownerKey: null, activeSessionToken: null, ready: false, localReady: false, user: null, recoveryCopies: [], adoptionDecision: null })
    }
    async function prepareOwner(owner, token) {
      await migrateLegacy({ storage, legacyReader, owner, newId })
      if (token !== epoch || stopped) throw failure('stale-context')
      const current = await storage.read(owner.ownerKey)
      if (!current) await storage.commit(owner.ownerKey, value => value || makeEnvelope(owner, freshState()))
      else {
        const admitted = current.recoveryCopies.filter(c => c.status === 'adopted' && !(current.localMetadata?.seededRecoveryIds || []).includes(c.recoveryId))
        if (admitted.length) {
          const operation = prepareOperation(DEF, current.state, { ownerKey: owner.ownerKey, opId: newId(), kind: 'migration', generation: current.lastConfirmedControl ? current.cloudGeneration : null, unitVersion: current.lastConfirmedControl?.unitVersion || 1 })
          const ids = admitted.map(c => c.recoveryId)
          await storage.commit(owner.ownerKey, value => {
            if (ids.every(id => value.localMetadata?.seededRecoveryIds?.includes(id))) return value
            return { ...value, pendingOperations: operation ? [...value.pendingOperations, operation] : value.pendingOperations,
              localMetadata: { ...value.localMetadata, seededRecoveryIds: [...new Set([...(value.localMetadata?.seededRecoveryIds || []), ...ids])] } }
          })
        }
      }
      if (token !== epoch || stopped) throw failure('stale-context')
    }
    async function drainDepartures(retry = false) {
      for (const [key, departure] of departures) {
        await departure.pending
        if (departure.error) {
          if (!retry) throw departure.error
          try { await bridge.flushOwner(key) }
          catch (error) { departure.error = error; throw error }
        }
        if (departures.get(key) === departure) departures.delete(key)
      }
    }
    async function completeTransition(target) {
      try {
        await drainDepartures(true)
        if (target.token !== epoch || stopped) return
        await prepareOwner(target.owner, target.token)
        if (target.user) await bridge.bindAuth({ owner: target.owner, user: target.user, authEpoch: ++authEpoch })
        else await bridge.hydrate(target.owner)
        if (target.token !== epoch || stopped) return
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) get().update(s => { s.reminder = { ...s.reminder, tz } })
      } catch (error) { if (target.token === epoch && error.code !== 'stale-context') { hide(); localFailure(error) } }
    }
    async function confirmedUser(user) {
      if (stopped) return
      const clean = user ? { uid: user.uid, email: user.email || null, displayName: user.displayName || null } : null
      const owner = clean ? makeOwner(projectId, clean.uid) : guest
      set({ authReady: true })
      if (get().localReady && owner.ownerKey === get().ownerKey) {
        desiredUser = clean
        set({ user: clean ? { ...clean, id: clean.uid, name: clean.displayName || clean.email || '' } : null })
        return
      }
      const oldKey = get().ownerKey, oldState = get().S
      desiredUser = clean
      const target = transition = { owner, user: clean, token: ++epoch }
      // Register the barrier before publishing hidden state or awaiting detach.
      // Later Auth callbacks must also wait for this captured owner's local write.
      let settle
      const departure = oldKey ? { state: oldState, error: null, pending: new Promise(resolve => { settle = resolve }) } : null
      if (departure) departures.set(oldKey, departure)
      hide()
      try {
        const detached = bridge.unbindAuth()
        if (departure) void detached.then(settle, error => { departure.error = error; settle() })
        await detached
        await drainDepartures()
      } catch (error) {
        if (target.token === epoch) localFailure(error)
        return
      }
      if (target.token === epoch) await completeTransition(target)
    }
    async function copyRecoveryMedia(copy) {
      const context = get().getContext()
      const assertCurrent = () => { if (stopped || !get().localReady || get().ownerKey !== context.ownerKey || epoch !== context.epoch) throw failure('stale-context') }
      assertCurrent()
      if (!copy || !recoverableBy(copy, transition.owner)) throw failure('recovery-owner-mismatch')
      const files = referencedFiles(copy.state)
      if (!files.length) return { copied: 0, missing: 0 }
      // Legacy sources remain unowned until this explicit decision; raw Node UID and matching
      // hashes never select a Firebase owner. Guest adoption uses its known source namespace.
      const source = copy.sourceId && copy.recoveryId.startsWith('legacy-') ? legacyMediaStore()
        : copy.ownerKey ? getMediaStore(copy.ownerKey) : null
      if (!source) throw failure('media-source-unknown')
      const target = getMediaStore(context.ownerKey)
      if (source === target) return { copied: 0, missing: 0 }
      await source.ready(); assertCurrent()
      if (!source.persistent) throw failure('media-storage-unavailable')
      await target.ready(); assertCurrent()
      if (!target.persistent) throw failure('media-storage-unavailable')
      const result = { copied: 0, missing: 0 }
      for (const file of files) {
        const value = await source.get(file.hash); assertCurrent()
        if (!value) { result.missing++; continue } // absent original retains its reference
        await target.put(file.hash, value.blob, { mime: value.mime, pending: false }); assertCurrent()
        result.copied++
      }
      return result
    }
    function lifecycle() {
      if (options.lifecycle === false || typeof window === 'undefined') return
      const flush = () => { void get().flushLocal().catch(localFailure) }
      const foreground = () => {
        if (!get().localReady || Date.now() - lastForeground < 1000) return
        lastForeground = Date.now(); void bridge.onForeground().catch(localFailure); remind()
      }
      const visibility = () => document.visibilityState === 'hidden' ? flush() : foreground()
      const online = () => { if (get().localReady) void bridge.onOnline().catch(localFailure) }
      for (const [target, name, callback] of [[window, 'pagehide', flush], [window, 'focus', foreground], [window, 'pageshow', foreground], [window, 'online', online], [document, 'visibilitychange', visibility]]) {
        target.addEventListener(name, callback); disposers.push(() => target.removeEventListener(name, callback))
      }
      const stopNative = onAppActive(foreground, flush)
      if (stopNative) disposers.push(stopNative)
    }
    function record(next, push, kind, replaceActive = false) {
      requireReady()
      const previous = get().S
      delete next.coach
      next.customEx = healCustomEx(next.customEx)
      // Reject policy/identity errors before accepting a view that cannot enter the bridge.
      encodeState(next, { generation: envelope.cloudGeneration, unitVersion: envelope.unitProjectionVersion ?? envelope.lastConfirmedControl?.unitVersion ?? 1 })
      const sameSession = previous.active && next.active && previous.active.id === next.active.id && previous.active.editingWorkoutId === next.active.editingWorkoutId
      const activeSessionToken = next.active ? (!replaceActive && sameSession ? get().activeSessionToken : null) || newId() : null
      set({ S: next, activeSessionToken })
      void bridge.recordChange({ previous, next, kind, scheduleRemote: push, activeSessionToken, replaceActive }).catch(localFailure)
    }
    return {
      S: freshState(), user: null, ownerKey: null, activeSessionToken: null, ready: false, localReady: false, authReady: false,
      sync: compatibilityStatus(latestStatus), config: { allow_guest: true, coach: null }, needsMobileOnboarding: false, linkCode: null, coachLocal: null,
      recoveryCopies: [], adoptionDecision: null, keptRev: 0,
      boot() {
        if (bootPromise) return bootPromise
        bootPromise = (async () => {
          if (!persistRequested) { persistRequested = true; try { Promise.resolve(globalThis.navigator?.storage?.persist?.()).catch(() => {}) } catch { /* Optional browser capability. */ } }
          // Initialization failure is cloud-only; the canonical local archive still hydrates.
          let cloudError = null
          try { client = options.client === undefined ? createFirebaseClient({ config, emulator: import.meta.env?.VITE_FIREBASE_EMULATOR === 'true' }) : options.client }
          catch (error) { cloudError = info(error) }
          const remote = options.remote === undefined ? client ? createFirestorePort({ client }) : null : options.remote
          bridge = createSyncBridge({ storage, remote, newId, guestBaseline: freshState(), clock: options.clock, onState: install,
            onStatus: value => { latestStatus = value; if (!stopped) set({ sync: compatibilityStatus(value) }) } })
          transition = { owner: guest, user: null, token: ++epoch }
          await completeTransition(transition)
          if (stopped) return
          lifecycle()
          if (cloudError) { set({ authReady: true, sync: compatibilityStatus({ ...latestStatus, cloud: 'blocked', cloudError }) }); return }
          session = authFactory({ client, onUser: confirmedUser })
          session.ready.then(() => { if (!stopped) set({ authReady: true }) }, error => { if (!stopped) set({ authReady: true, sync: compatibilityStatus({ ...latestStatus, cloud: 'auth-required', cloudError: info(error) }) }) })
        })()
        return bootPromise
      },
      update(producer, push = true, { kind = 'edit' } = {}) {
        requireReady()
        const previous = get().S, draft = clone(previous)
        producer(draft)
        // Domain helpers historically use optional undefined properties; S is JSON data.
        const next = localData(draft)
        next._ts = stampChange(previous, next, Date.now())
        record(next, push, kind)
        const beforeMedia = referencedHashes({ workouts: previous.workouts })
        const remainingWorkouts = new Map((next.workouts || []).map(w => [entryKey('workouts', w), w]))
        const removed = (previous.workouts || []).some(w => {
          const kept = remainingWorkouts.get(entryKey('workouts', w))
          if (!kept) return true
          const hashes = referencedHashes({ workouts: [kept] })
          return [...referencedHashes({ workouts: [w] })].some(hash => !hashes.has(hash))
        })
        // A pending addition must not overwrite today's preserved photo/workout after a
        // removal, even if another workout still refers to the same bytes.
        if (removed || !next.autoBackup) { clearTimeout(backupTimer); backupTimer = null }
        else if (MOBILE && [...referencedHashes({ workouts: next.workouts })].some(hash => !beforeMedia.has(hash))) {
          const captured = get().getContext()
          clearTimeout(backupTimer)
          backupTimer = setTimeout(() => {
            if (!stopped && get().localReady && get().ownerKey === captured.ownerKey && epoch === captured.epoch) void get().autoBackupNow().catch(localFailure)
          }, 2000)
        }
      },
      saveHistoryEdit() { let saved; get().update(s => { saved = saveWorkoutEdit(s) }, true, { kind: 'history-edit' }); return saved },
      deleteHistoryEdit() { let removed; get().update(s => { removed = deleteEditedWorkout(s) }, true, { kind: 'history-edit' }); return removed },
      discardHistoryEdit() { get().update(s => { s.active = null }) },
      replaceState(state, push = false) { requireReady(); const next = sanitizeAccent({ ...clone(DEF), ...localData(state) }); next._ts = stampChange(get().S, next, Date.now()); record(next, push, 'replace', true) },
      setUnit(to, opts) { requireReady(); return bridge.changeUnit(to, opts) },
      resetEverything() { requireReady(); return bridge.reset() },
      async importConflict(backup) {
        requireReady()
        const ownerKey = get().ownerKey
        const profile = get().user ? await bridge.readRemote() : null
        if (ownerKey !== get().ownerKey) throw failure('stale-context')
        const state = profile ? decodeState(profile.documents, { generation: profile.control.generation }) : clone(get().S)
        const localState = clone(get().S), inBackup = new Set((backup?.workouts || []).map(w => entryKey('workouts', w)))
        const missing = new Set([...state.workouts, ...localState.workouts].filter(w => !inBackup.has(entryKey('workouts', w))).map(w => entryKey('workouts', w)))
        importRead = { ownerKey, state, rev: profile?.control.dataRevision ?? null, local: true, localState, localRevision: latestStatus.localRevision }
        return missing.size ? { ...clone(importRead), workouts: missing.size } : null
      },
      importBackup(backup, { mergeWith } = {}) {
        requireReady()
        const preview = mergeWith || (importRead?.ownerKey === get().ownerKey ? importRead : null); importRead = null
        if (preview?.ownerKey && preview.ownerKey !== get().ownerKey) throw failure('owner-mismatch')
        const training = clone(backup); delete training.coach
        return bridge.importBackup(training, { mode: mergeWith ? 'merge' : 'replace', mergeWith: preview })
      },
      async flushLocal() { if (bridge) await bridge.flushLocal() },
      async retryLocal() {
        try {
          // Retained departures remain obligations even if a current view is ready.
          await drainDepartures(true)
          if (transition && !get().localReady) { await completeTransition(transition); if (!get().localReady) throw failure(get().sync.localError?.code || 'storage-unavailable') }
          else await get().flushLocal()
        } catch (error) { localFailure(error); throw error }
      },
      async syncNow() { requireReady(); await bridge.syncNow(); return get().sync },
      pushState() { return get().syncNow() },
      pullState() { return get().syncNow() },
      unsyncedChanges() { const result = bridge?.getUnsynced() || { count: 0, blocked: 0 }; return { ...result, owed: result.count > 0 || get().sync.local === 'error' } },
      setUser(user) {
        if ((user?.uid || user?.id || null) !== (desiredUser?.uid || null)) throw failure('auth-confirmation-required')
      },
      isGuest: () => get().localReady && get().ownerKey === guest.ownerKey,
      setGuest(value) { if (value && desiredUser) return get().signOut({ force: true }) },
      login: (...args) => session ? session.login(...args) : Promise.reject(failure('auth/not-ready')),
      register: (...args) => session ? session.register(...args) : Promise.reject(failure('auth/not-ready')),
      resetPassword: (...args) => session ? session.resetPassword(...args) : Promise.reject(failure('auth/not-ready')),
      getContext: () => ({ ownerKey: get().ownerKey, localReady: get().localReady, activeSessionToken: get().activeSessionToken, epoch }),
      async signOut({ force = false } = {}) {
        requireReady()
        const capturedEpoch = epoch, capturedKey = get().ownerKey, capturedSession = session
        const assertDeparture = () => { if (stopped || epoch !== capturedEpoch || get().ownerKey !== capturedKey || !get().localReady) throw failure('stale-context') }
        await bridge.syncNow(); assertDeparture()
        const left = get().unsyncedChanges()
        if (capturedKey === guest.ownerKey && !get().user) return left
        if (left.owed && !force) return left
        const { useUI } = await import('./useUI.js'); assertDeparture()
        useUI.getState().abandonWork?.(); assertDeparture()
        useUI.getState().stopRest?.(); useUI.getState().stopWork?.()
        await get().flushLocal(); assertDeparture()
        // SDK signOut may resolve before its Auth observer finishes opening Guest.
        // Only that next confirmed owner epoch can complete this departure.
        let stop = () => {}, cancel
        const guestReady = new Promise((resolve, reject) => {
          const finish = error => { stop(); authWaiters.delete(cancel); error ? reject(error) : resolve() }
          cancel = () => finish(failure('stale-context'))
          const check = () => {
            if (stopped || session !== capturedSession || epoch > capturedEpoch + 1 || (epoch > capturedEpoch && (desiredUser || transition?.owner.ownerKey !== guest.ownerKey))) { cancel(); return }
            if (epoch === capturedEpoch + 1 && get().localReady && get().ownerKey === guest.ownerKey && !get().user) finish()
          }
          authWaiters.add(cancel); stop = store.subscribe(check); check()
        })
        try {
          await Promise.all([guestReady, Promise.resolve().then(() => { assertDeparture(); return capturedSession.signOut() })])
          if (stopped || session !== capturedSession || epoch !== capturedEpoch + 1 || get().user || get().ownerKey !== guest.ownerKey || !get().localReady) throw failure('stale-context')
        } finally { stop(); authWaiters.delete(cancel) }
        return { ...left, ...(left.owed ? { stashed: true } : {}) }
      },
      async resolveAdoption(choice) {
        requireReady()
        const context = get().getContext()
        const media = choice === 'add' && envelope?.adoptionDecision?.status === 'pending' ? await copyRecoveryMedia(envelope.recoveryCopies.find(c => c.recoveryId === envelope.adoptionDecision.recoveryId)) : null
        if (!get().localReady || context.ownerKey !== get().ownerKey || context.epoch !== epoch) throw failure('stale-context')
        await bridge.resolveAdoption(choice)
        return { media }
      },
      adoptProfile(ask) {
        if (adopting) return adopting
        const key = get().ownerKey, answerEpoch = epoch, decision = envelope?.adoptionDecision
        if (decision?.status !== 'pending') return Promise.resolve(null)
        const copy = envelope.recoveryCopies.find(c => c.recoveryId === decision.recoveryId)
        adopting = (async () => { const add = await ask(localExtras(copy?.state || DEF, get().S)); if (key !== get().ownerKey || answerEpoch !== epoch) throw failure('stale-context'); await get().resolveAdoption(add ? 'add' : 'keep'); return add })().finally(() => { adopting = null })
        return adopting
      },
      async resumeAdoption(ask) { if (!ask) ask = (await import('../sheets.jsx')).askAddDeviceData; return get().adoptProfile(ask) },
      listRecovery() {
        requireReady()
        return (envelope?.recoveryCopies || []).filter(copy => recoverableBy(copy, transition.owner)).map(({ recoveryId, sourceId, reason, decision }) => ({ recoveryId, sourceId, reason, decision }))
      },
      recoveryState(recoveryId) {
        requireReady()
        const copy = envelope?.recoveryCopies.find(item => item.recoveryId === recoveryId)
        if (!copy || !recoverableBy(copy, transition.owner)) throw failure('recovery-owner-mismatch')
        return trainingState(copy.state)
      },
      async resolveRecovery(recoveryId, choice) {
        requireReady()
        const context = get().getContext()
        const copy = envelope?.recoveryCopies.find(c => c.recoveryId === recoveryId)
        if (!copy || !recoverableBy(copy, transition.owner)) throw failure('recovery-owner-mismatch')
        const media = choice === 'add' && !copy.decision ? await copyRecoveryMedia(copy) : null
        if (!get().localReady || context.ownerKey !== get().ownerKey || context.epoch !== epoch) throw failure('stale-context')
        await bridge.resolveRecovery(recoveryId, choice)
        return { media }
      },
      async keptChanges() { return (envelope?.recoveryCopies || []).filter(c => c.ownerKey === get().ownerKey).map(c => ({ server: projectId, uid: desiredUser?.uid || null, recoveryId: c.recoveryId, at: c.state?._ts || 0 })) },
      async keptState(server, uid) { if (server !== projectId || uid !== (desiredUser?.uid || null) || !get().localReady) return null; return clone(departures.get(get().ownerKey)?.state || envelope?.recoveryCopies.find(c => c.ownerKey === get().ownerKey)?.state || null) },
      async mediaRetentionSnapshot() {
        requireReady()
        const context = get().getContext(), revision = envelope.localRevision
        const assertCurrent = () => {
          if (stopped || !get().localReady || epoch !== context.epoch || get().ownerKey !== context.ownerKey || envelope?.localRevision !== revision) throw failure('stale-context')
        }
        const confirmed = await storage.read(context.ownerKey); assertCurrent()
        if (!confirmed || confirmed.localRevision !== revision) throw failure('stale-context')
        const retained = typeof storage.readRecoveryEnvelopes === 'function' ? await storage.readRecoveryEnvelopes(context.ownerKey) : []
        assertCurrent()
        const sources = [{ ownerKey: context.ownerKey, state: clone(get().S) }]
        for (const value of [confirmed, ...retained]) {
          if (value.ownerKey !== context.ownerKey) throw failure('owner-mismatch')
          sources.push({ ownerKey: value.ownerKey, state: clone(value.state) })
          for (const copy of value.recoveryCopies) sources.push({ ownerKey: copy.ownerKey || null, sourceId: copy.sourceId || null, state: clone(copy.state) })
        }
        return { ...context, localRevision: revision, sources }
      },
      async stashedMediaHashes() { requireReady(); return new Set((envelope?.recoveryCopies || []).flatMap(c => [...referencedHashes(c.state)])) },
      async autoBackupNow() { const context = get().getContext(), S = clone(get().S); if (!context.localReady) return; await get().flushLocal(); if (MOBILE && !stopped && get().localReady && get().ownerKey === context.ownerKey && epoch === context.epoch && S.autoBackup) return writeAutoBackup(S) },
      loadConfig: async () => get().config, refreshConfig: async () => get().config,
      async dispose() { stopped = true; ++epoch; for (const cancel of [...authWaiters]) cancel(); session?.stop(); for (const stop of disposers.splice(0)) stop(); clearTimeout(backupTimer); if (bridge) await bridge.unbindAuth().catch(() => {}); hide() },
    }
  })
  return store
}
export const useStore = createWorkoutStore()
