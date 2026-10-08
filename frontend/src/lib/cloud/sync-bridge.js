import { prepareLegacyState } from './legacy-migration.js'
import { blockedImportError, createJobCoordinator, reconcileJobUnits } from './sync-jobs.js'
import * as defaultCodec from './codec.js'
import { makeEnvelope, makeOwner, recoverableBy, trainingState } from './model.js'
import { DEF } from '../../store/state-defaults.js'
import { createSyncStatus } from './sync-status.js'

const clone = value => structuredClone(value)
const failure = message => Object.assign(new Error(message), { code: message.split(':')[0] })
const errorInfo = (error, op) => {
  const [prefix, ...path] = (error?.message || 'sync-failed').split(':')
  return { code: error?.code || prefix, path: error?.path || path.join(':') || null, opId: op?.opId || null }
}
const transient = code => ['unavailable', 'deadline-exceeded', 'aborted', 'cancelled', 'resource-exhausted', 'network-request-failed', 'auth/network-request-failed', 'server-required', 'refresh-required', 'domain-context-stale'].includes(code.replace(/^firestore\//, ''))
const sameControl = (a, b) => a && b && ['generation', 'dataRevision', 'unitVersion', 'activeUnitJob', 'lastResetOpId'].every(k => a[k] === b[k])
const delays = [1000, 2000, 4000, 8000, 16000, 30000]
function nextIndependentOperation(envelope) {
  if (!envelope.pendingJobs.some(blockedImportError)) return envelope.pendingOperations[0]
  // Subsequent import jobs retain their ordering too. A skipped normal write
  // adds its footprint so later reads/writes cannot overtake that dependency.
  const waiting = new Set(envelope.pendingJobs.flatMap(job => job.parts?.flatMap(part => part.paths) || []))
  for (const op of envelope.pendingOperations) {
    const footprint = [...op.paths, ...(op.readPaths || [])]
    if (!footprint.some(path => waiting.has(path))) return op
    for (const path of footprint) waiting.add(path)
  }
}
const initializeOperation = (op, control) => !op || op.generation !== null || !control ? op : {
  ...op, generation: control.generation,
  payloads: Object.fromEntries(Object.entries(op.payloads).map(([path, record]) => [path, { ...record, generation: control.generation }])) }

/** Inputs are already stamped by the domain caller. Callbacks receive detached
 * onState(state, envelope), onStatus(status). clock = {now,setTimeout,clearTimeout}.
 * bindAuth resolves after local readiness; cloud work proceeds independently.
 */
export function createSyncBridge({ storage, codec = defaultCodec, remote, clock = globalThis,
  newId = () => crypto.randomUUID(), onState, onStatus, guestBaseline = DEF } = {}) {
  const status = createSyncStatus(onStatus), contexts = new Map(), localFailures = new WeakSet()
  let active = null, epoch = 0, highestAuthEpoch = -1
  const now = () => clock.now?.() ?? Date.now()
  const valid = ctx => !!ctx && active === ctx && ctx.epoch === epoch
  const authenticated = ctx => valid(ctx) && ctx.user && ctx.owner.uid && remote
  const assertCurrent = ctx => { if (!valid(ctx)) throw failure('stale-context') }
  const emit = (ctx, patch) => { if (valid(ctx)) status.update(patch) }
  function localError(ctx, error) {
    if (error && typeof error === 'object') localFailures.add(error)
    emit(ctx, { local: 'error', localError: errorInfo(error) })
  }
  function memory(ctx) {
    return ctx.intents.reduce((value, draft) => codec.mergeLocalDraft(value, draft), clone(ctx.envelope))
  }
  function publish(ctx) {
    if (!valid(ctx) || !ctx.envelope) return
    const envelope = memory(ctx)
    emit(ctx, { ownerKey: ctx.owner.ownerKey, localReady: true, localRevision: ctx.envelope.localRevision,
      pendingCount: envelope.pendingOperations.length + envelope.pendingJobs.length, blockedCount: envelope.pendingOperations.filter(x => x.blockedReason).length + envelope.pendingJobs.filter(x => x.blockedReason).length })
    try { onState?.(clone(envelope.state), clone(envelope)) } catch { /* UI cannot reject persistence */ }
  }
  function accept(ctx, envelope) {
    if (!ctx.envelope || envelope.localRevision >= ctx.envelope.localRevision) ctx.envelope = clone(envelope)
    initializeIntents(ctx, envelope.lastConfirmedControl)
    publish(ctx)
  }
  function initializeIntents(ctx, control) {
    if (!control) return
    // Seal memory-only drafts at the first proof they were waiting for, even if
    // their first durable write failed. A later reset never retargets them.
    ctx.initialControl ||= clone(control)
    for (const draft of ctx.intents) draft.operation = initializeOperation(draft.operation, ctx.initialControl)
  }
  function cancelTimer(ctx) {
    if (ctx?.timer != null) clock.clearTimeout(ctx.timer)
    if (ctx) ctx.timer = null
  }
  function detach(ctx) {
    if (!ctx) return
    cancelTimer(ctx); ctx.stopWatch?.(); ctx.watchToken = null; ctx.stopStorage?.(); ctx.user = null
  }
  function cloudError(ctx, error, op) {
    if (!valid(ctx) || error?.code === 'stale-context') return
    if (localFailures.has(error)) {
      cancelTimer(ctx); emit(ctx, { cloud: 'waiting-local', cloudError: null, retryAt: null }); return
    }
    const info = errorInfo(error, op), retry = transient(info.code)
    if (!retry) cancelTimer(ctx)
    emit(ctx, { cloud: retry ? 'waiting' : (info.code.startsWith('auth/') || info.code === 'unauthenticated') ? 'auth-required' : 'blocked', cloudError: info,
      blockedCount: retry ? [...ctx.envelope.pendingOperations, ...ctx.envelope.pendingJobs].filter(x => x.blockedReason).length : ctx.envelope.pendingOperations.length + ctx.envelope.pendingJobs.length,
      ...(!retry ? { retryAt: null } : {}) })
    if (retry && authenticated(ctx) && ctx.timer == null) {
      const delay = delays[Math.min(ctx.attempt++, delays.length - 1)]
      emit(ctx, { retryAt: now() + delay })
      ctx.timer = clock.setTimeout(() => { ctx.timer = null; if (authenticated(ctx)) void startSync(ctx) }, delay)
    }
  }
  async function durable(ctx, reducer) {
    let reductionError
    try {
      assertCurrent(ctx)
      const saved = await storage.commit(ctx.owner.ownerKey, current => {
        assertCurrent(ctx)
        try { return reducer(current || ctx.envelope) } catch (error) { reductionError = error; throw error }
      })
      assertCurrent(ctx); accept(ctx, saved)
      if (!ctx.intents.length) emit(ctx, { local: 'saved', localError: null })
      return saved
    } catch (error) {
      if (error?.code !== 'stale-context' && error !== reductionError) localError(ctx, error)
      throw error
    }
  }
  function persistIntents(ctx) {
    const work = ctx.tail.catch(() => {}).then(async () => {
      if (!ctx.intents.length) return ctx.envelope
      const batch = [...ctx.intents]
      const drafts = clone(batch), base = clone(ctx.envelope), initialControl = clone(ctx.initialControl)
      emit(ctx, { local: 'saving', localError: null })
      try {
        // Local intent is always written to its captured owner, including a flush
        // of the old owner while a newer authentication callback is taking over.
        const saved = await storage.commit(ctx.owner.ownerKey, current => drafts.reduce((value, draft) => codec.mergeLocalDraft(value,
          { ...draft, operation: initializeOperation(draft.operation, initialControl || current?.lastConfirmedControl) }), current || base))
        ctx.intents = ctx.intents.filter(x => !batch.includes(x))
        accept(ctx, saved)
        emit(ctx, { local: ctx.intents.length ? 'saving' : 'saved', localError: null })
        return saved
      } catch (error) { localError(ctx, error); publish(ctx); throw error }
    })
    ctx.tail = work; work.catch(() => {})
    return work
  }
  async function flush(ctx) {
    if (!ctx) return
    await persistIntents(ctx)
    try { await storage.flush(ctx.owner.ownerKey) }
    catch {
      // A failed ACK/watch transaction can be the backend's last request even
      // though no memory edit needs retry. Confirm the latest envelope anew;
      // the failed operation stays queued for idempotent cloud replay.
      try {
        const saved = await storage.commit(ctx.owner.ownerKey, current => current || ctx.envelope)
        accept(ctx, saved); emit(ctx, { local: 'saved', localError: null })
      } catch (error) { localError(ctx, error); throw error }
    }
  }
  async function activate(owner, token) {
    if (makeOwner(owner.projectId, owner.uid).ownerKey !== owner.ownerKey) throw failure('invalid-owner')
    const prior = contexts.get(owner.ownerKey)
    const ctx = { owner: Object.freeze(clone(owner)), epoch: token, user: null, envelope: prior?.envelope || null,
      intents: prior?.intents || [], tail: prior?.tail || Promise.resolve(), attempt: 0, timer: null }
    active = ctx; contexts.set(owner.ownerKey, ctx)
    emit(ctx, { ownerKey: owner.ownerKey, localReady: false, local: 'loading', cloud: 'auth-required', localError: null, cloudError: null, retryAt: null })
    try {
      await storage.open(); assertCurrent(ctx)
      const envelope = await storage.read(owner.ownerKey); assertCurrent(ctx)
      ctx.envelope = envelope || makeEnvelope(owner, DEF)
      // Migration runs before hydrate/bindAuth. Choose IDs outside replayable reducers.
      if (ctx.envelope.state.active && !ctx.envelope.localMetadata?.activeSessionToken) {
        const token = newId()
        ctx.envelope = await storage.commit(owner.ownerKey, current => {
          const value = current || ctx.envelope
          return { ...value, localMetadata: { ...value.localMetadata,
            activeSessionToken: value.state.active ? value.localMetadata?.activeSessionToken || token : null } }
        }); assertCurrent(ctx)
      }
      initializeIntents(ctx, ctx.envelope.lastConfirmedControl)
      ctx.stopStorage = storage.subscribe(owner.ownerKey, async () => {
        if (!valid(ctx)) return
        try { const value = await storage.read(owner.ownerKey); if (valid(ctx) && value) accept(ctx, value) }
        catch (error) { emit(ctx, { local: 'error', localError: errorInfo(error) }) }
      })
      emit(ctx, { local: ctx.intents.length ? 'error' : 'saved', localError: ctx.intents.length ? { code: 'unsaved-changes', path: null, opId: null } : null })
      publish(ctx)
      return ctx
    } catch (error) { emit(ctx, { local: 'error', localError: errorInfo(error) }); throw error }
  }
  async function hydrate(owner) {
    owner = clone(owner)
    const old = active, token = ++epoch
    detach(old); active = null
    await flush(old)
    if (token !== epoch) throw failure('stale-context')
    await activate(owner, token)
  }
  async function stageGuestChoice(ctx) {
    const guestOwner = makeOwner(ctx.owner.projectId)
    const guest = await storage.read(guestOwner.ownerKey); assertCurrent(ctx)
    if (!guest || JSON.stringify(guest.state) === JSON.stringify(DEF) || JSON.stringify(guest.state) === JSON.stringify(guestBaseline)) return
    const recoveryId = `guest:${guest.ownerKey}:${guest.localRevision}`
    await durable(ctx, current => {
      if (current.adoptionDecision) return current
      return { ...current, adoptionDecision: { status: 'pending', sourceOwnerKey: guest.ownerKey, recoveryId },
        recoveryCopies: [...current.recoveryCopies, { recoveryId, ownerKey: guest.ownerKey, state: clone(guest.state), pendingOperations: clone(guest.pendingOperations), reason: 'guest-adoption' }] }
    })
  }
  async function bindAuth({ owner, user, authEpoch }) {
    owner = clone(owner); user = user ? { uid: user.uid } : null
    if (!Number.isSafeInteger(authEpoch) || authEpoch <= highestAuthEpoch) throw failure('stale-auth-epoch')
    if (!user || owner.uid !== user.uid) throw failure('owner-mismatch')
    highestAuthEpoch = authEpoch
    const old = active, token = ++epoch
    detach(old); active = null
    await flush(old)
    if (token !== epoch) throw failure('stale-context')
    const ctx = await activate(owner, token); assertCurrent(ctx)
    ctx.user = { uid: user.uid }; ctx.authEpoch = authEpoch
    await stageGuestChoice(ctx); assertCurrent(ctx)
    if (!remote) { emit(ctx, { cloud: 'unconfigured' }); return }
    void startSync(ctx)
  }
  function installWatch(ctx) {
    if (ctx.watchToken) return
    const token = {}; ctx.watchToken = token
    const current = () => authenticated(ctx) && ctx.watchToken === token
    try {
      const stop = remote.watchControl(ctx.owner, control => {
        if (!current() || sameControl(control, ctx.envelope.lastConfirmedControl)) return
        void refresh(ctx).catch(error => { if (current()) cloudError(ctx, error) })
      }, error => {
        if (!current()) return
        ctx.watchToken = null; ctx.stopWatch?.(); ctx.stopWatch = null
        cloudError(ctx, error)
      })
      if (current()) ctx.stopWatch = stop; else stop()
    } catch (error) { ctx.watchToken = null; throw error }
  }
  async function unbindAuth() {
    const old = active
    ++epoch; detach(old); active = null
    status.update({ ownerKey: null, localReady: false, local: 'loading', cloud: 'auth-required', localError: null, cloudError: null, retryAt: null, pendingCount: 0, blockedCount: 0 })
    await flush(old)
  }
  function integrate(current, profile, initialControl, history) {
    const { control, documents } = profile
    let next = clone(current)
    if (next.pendingJobs.some(j => j.kind === 'reset')) return next
    const previousControl = next.lastConfirmedControl
    if (previousControl && (control.generation < previousControl.generation || (control.generation === previousControl.generation && control.dataRevision < previousControl.dataRevision))) return next

    // Unknown generations are assigned only after this server-confirmed Profile.
    next.pendingOperations = next.pendingOperations.map(op => initializeOperation(op, initialControl))
    const retired = next.pendingOperations.filter(op => op.generation !== control.generation)
    if (retired.length || (previousControl && next.cloudGeneration !== control.generation)) {
      const retiredJobs = next.pendingJobs.filter(j => j.kind !== 'cleanup' && j.generation !== control.generation)
      next.recoveryCopies.push({ recoveryId: `generation:${next.cloudGeneration}:${next.localRevision}`, ownerKey: next.ownerKey, reason: 'generation-mismatch', state: clone(next.state), pendingOperations: clone(retired), pendingJobs: clone(retiredJobs) })
      next.pendingJobs = next.pendingJobs.filter(j => !retiredJobs.some(old => old.jobId === j.jobId))
      next.pendingOperations = next.pendingOperations.filter(op => op.generation === control.generation)
      const localOverlay = codec.encodeState(next.state, { generation: next.cloudGeneration, unitVersion: previousControl?.unitVersion || 1 }).localOverlay
      next.state = codec.decodeState(documents, { generation: control.generation, localOverlay })
      next.remoteMetadataByPath = {}
      next.unitProjectionVersion = control.unitVersion
    }
    next.cloudGeneration = control.generation
    if (control.activeUnitJob || next.pendingJobs.some(j => j.kind === 'unit')) return next
    next = reconcileJobUnits(next, profile, history)
    return codec.applyConfirmation(next, { ownerKey: next.ownerKey, opId: null, control, documents })
  }
  async function refresh(ctx) {
    assertCurrent(ctx)
    const profile = await remote.readProfileFromServer(ctx.owner); assertCurrent(ctx)
    if (!profile?.control || profile.fromCache || profile.hasPendingWrites) throw failure('server-required')
    initializeIntents(ctx, profile.control)
    const initialControl = clone(ctx.initialControl)
    const history = remote.readJobs ? await remote.readJobs(ctx.owner) : []; assertCurrent(ctx)
    await durable(ctx, current => integrate(current, profile, initialControl, history)); assertCurrent(ctx)
    return clone(profile)
  }
  async function runSync(ctx) {
    let operation
    try {
      await flush(ctx); assertCurrent(ctx)
      await jobs.runReset(ctx); assertCurrent(ctx)
      let profile = await refresh(ctx); assertCurrent(ctx)
      if (ctx.envelope.adoptionDecision?.status === 'pending') { emit(ctx, { cloud: 'adoption-required', cloudError: null }); return }
      emit(ctx, { cloud: 'syncing', cloudError: null, retryAt: null })
      profile = await jobs.run(ctx, profile); assertCurrent(ctx)
      profile = await refresh(ctx); assertCurrent(ctx)
      if (ctx.envelope.pendingJobs.some(blockedImportError) && (profile.control.activeUnitJob || ctx.envelope.pendingJobs.some(job => job.kind === 'unit'))) throw failure('unit-job-active')
      while (authenticated(ctx)) {
        let latest
        try { latest = await storage.read(ctx.owner.ownerKey) }
        catch (error) { localError(ctx, error); throw error }
        assertCurrent(ctx)
        if (latest) accept(ctx, latest)
        operation = nextIndependentOperation(ctx.envelope)
        if (!operation) break
        if (operation.blockedReason) throw failure(operation.blockedReason)
        if (operation.generation !== profile.control.generation) throw failure('generation-mismatch')
        if (operation.unitVersion !== profile.control.unitVersion) throw failure('unit-version-mismatch')
        let confirmation
        try {
          confirmation = await remote.commitOperation(ctx.owner, clone(operation), { expectedControl: clone(profile.control),
            domainContext: { remoteProfile: clone(profile), remoteState: codec.decodeState(profile.documents, { generation: profile.control.generation }) } })
        } catch (error) {
          if (!['refresh-required', 'domain-context-stale'].includes(error.code)) throw error
          // Refresh once in this attempt; persistent contention uses bounded backoff.
          profile = await refresh(ctx); assertCurrent(ctx)
          confirmation = await remote.commitOperation(ctx.owner, clone(operation), { expectedControl: clone(profile.control),
            domainContext: { remoteProfile: clone(profile), remoteState: codec.decodeState(profile.documents, { generation: profile.control.generation }) } })
        }
        assertCurrent(ctx)
        if (confirmation.ownerKey !== ctx.owner.ownerKey || confirmation.opId !== operation.opId) throw failure('invalid-confirmation')
        await durable(ctx, current => current.cloudGeneration !== confirmation.control.generation ? current : current.pendingJobs.some(j => j.kind === 'unit') ? { ...current, pendingOperations: current.pendingOperations.filter(op => op.opId !== confirmation.opId) } : codec.applyConfirmation(current, confirmation)); assertCurrent(ctx)
        profile = await refresh(ctx); assertCurrent(ctx)
      }
      await jobs.runCleanup(ctx); assertCurrent(ctx)
      ctx.attempt = 0; cancelTimer(ctx)
      const blocked = ctx.envelope.pendingJobs.map(blockedImportError).find(Boolean)
      if (blocked) { cloudError(ctx, blocked); return }
      emit(ctx, { cloud: 'synced', cloudError: null, retryAt: null })
    } catch (error) { cloudError(ctx, error, operation) }
  }
  function startSync(ctx) {
    if (!authenticated(ctx)) return Promise.resolve()
    if (ctx.running) return ctx.running
    try { installWatch(ctx) } catch (error) { cloudError(ctx, error); return Promise.resolve() }
    const work = runSync(ctx).finally(() => { if (ctx.running === work) ctx.running = null })
    ctx.running = work
    return work
  }
  async function syncNow() {
    const ctx = active
    if (!ctx) return
    ctx.attempt = 0; cancelTimer(ctx); emit(ctx, { retryAt: null })
    await flush(ctx); assertCurrent(ctx)
    if (ctx.running) { await ctx.running; assertCurrent(ctx) }
    await startSync(ctx)
  }
  async function recordChange({ previous, next, kind = 'edit', scheduleRemote = true, activeSessionToken, replaceActive = false }) {
    const ctx = active
    if (!ctx?.envelope || !status.get().localReady) throw failure('local-not-ready')
    const operation = codec.prepareOperation(previous, next, { ownerKey: ctx.owner.ownerKey, opId: newId(), kind,
      generation: ctx.envelope.lastConfirmedControl ? ctx.envelope.cloudGeneration : ctx.initialControl?.generation ?? null, unitVersion: ctx.envelope.unitProjectionVersion ?? ctx.envelope.lastConfirmedControl?.unitVersion ?? 1 })
    if (operation) operation.unitProvenance = ctx.envelope.lastConfirmedControl ? 'confirmed' : 'unproven'
    if (activeSessionToken === undefined) activeSessionToken = next.active
      ? (previous.active && previous.active.id === next.active.id ? memory(ctx).localMetadata?.activeSessionToken : null) || newId() : null
    ctx.intents.push({ previous: clone(previous), next: clone(next), operation, activeSessionToken, replaceActive })
    emit(ctx, { local: 'saving', cloud: authenticated(ctx) ? 'pending' : 'auth-required' }); publish(ctx)
    const saved = await persistIntents(ctx)
    if (valid(ctx) && scheduleRemote) void startSync(ctx)
    return clone(saved)
  }
  async function resolveAdoption(choice) {
    if (!['add', 'keep'].includes(choice)) throw failure('invalid-adoption-choice')
    const ctx = active; assertCurrent(ctx)
    await flush(ctx); assertCurrent(ctx)
    const opId = newId(), adoptionToken = newId()
    await durable(ctx, current => {
      if (current.adoptionDecision?.status !== 'pending') return current
      let next = clone(current)
      if (choice === 'add') {
        const copy = next.recoveryCopies.find(x => x.recoveryId === next.adoptionDecision.recoveryId)
        if (!copy) throw failure('missing-recovery-copy')
        const operation = codec.prepareOperation(DEF, copy.state, { ownerKey: ctx.owner.ownerKey, opId, kind: 'adoption',
          generation: next.lastConfirmedControl ? next.cloudGeneration : null, unitVersion: next.lastConfirmedControl?.unitVersion || 1 })
        next = codec.mergeLocalDraft(next, { previous: DEF, next: { ...copy.state, active: next.state.active || copy.state.active || null }, operation,
          activeSessionToken: next.state.active ? next.localMetadata?.activeSessionToken || adoptionToken : copy.state.active ? adoptionToken : null })
      }
      next.adoptionDecision = { ...next.adoptionDecision, status: choice }
      return next
    })
    if (valid(ctx)) await syncNow()
  }
  async function resolveRecovery(recoveryId, choice) {
    if (!['add', 'keep'].includes(choice)) throw failure('invalid-adoption-choice')
    const ctx = active; assertCurrent(ctx)
    const source = memory(ctx).recoveryCopies.find(copy => copy.recoveryId === recoveryId)
    if (!source || !recoverableBy(source, ctx.owner)) throw failure('recovery-owner-mismatch')
    const prepared = choice === 'add' ? await prepareLegacyState(trainingState(source.state)) : null
    assertCurrent(ctx); await flush(ctx); assertCurrent(ctx)
    const opId = newId(), sessionToken = newId()
    await durable(ctx, current => {
      const copy = current.recoveryCopies.find(item => item.recoveryId === recoveryId)
      if (!copy || !recoverableBy(copy, ctx.owner)) throw failure('recovery-owner-mismatch')
      if (copy.decision) return current
      let next = clone(current)
      if (choice === 'add') {
        const operation = codec.prepareOperation(DEF, prepared, { ownerKey: ctx.owner.ownerKey, opId, kind: 'recovery', generation: next.lastConfirmedControl ? next.cloudGeneration : null, unitVersion: next.lastConfirmedControl?.unitVersion || 1 })
        next = codec.mergeLocalDraft(next, { previous: DEF, next: { ...prepared, active: next.state.active || prepared.active || null }, operation,
          activeSessionToken: next.state.active ? next.localMetadata?.activeSessionToken || sessionToken : prepared.active ? sessionToken : null })
      }
      next.recoveryCopies = next.recoveryCopies.map(item => item.recoveryId === recoveryId ? { ...item, decision: choice } : item)
      return next
    })
    assertCurrent(ctx)
  }
  const jobs = createJobCoordinator({ context: () => active, durable, flush, current: assertCurrent, remote, newId, now, syncNow })
  return { reset: jobs.reset, importBackup: jobs.importBackup, changeUnit: jobs.changeUnit, hydrate, bindAuth, unbindAuth, recordChange, flushLocal: () => flush(active),
    flushOwner: ownerKey => {
      const ctx = contexts.get(ownerKey)
      if (!ctx) return Promise.reject(failure('unknown-owner-context'))
      return flush(ctx)
    }, syncNow, resolveAdoption, resolveRecovery,
    readRemote: async () => { const ctx = active; if (!authenticated(ctx)) throw failure('auth-required'); return refresh(ctx) },
    getUnsynced: () => { const envelope = active?.envelope && memory(active), count = (envelope?.pendingOperations.length || 0) + (envelope?.pendingJobs.length || 0);
      return { count, blocked: status.get().cloud === 'blocked' || envelope?.adoptionDecision?.status === 'pending' ? count : [...(envelope?.pendingOperations || []), ...(envelope?.pendingJobs || [])].filter(x => x.blockedReason).length } },
    subscribeStatus: status.subscribe,
    // Runtime lifecycle adapters call these on foreground / online hints.
    onForeground: syncNow, onOnline: syncNow }
}
