import { isAndroid } from './mobile.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { projectWearState } from './wear-protocol.js'
import { createWearHeartSession } from './wear-heart-session.js'
import { validateWearCommand } from './wear-protocol.js'
import { createWearController } from './wear-session.js'
import { applyStandalone, projectStandalone, reconcileStandaloneTimer, standaloneTimerSignature } from './wear-standalone.js'
import { createWearSync } from './wear-sync.js'
import { applyWearLedger, prepareWearLedger, wearSyncProjection } from './wear-ledger.js'
import { createWearInbox } from './wear-inbox.js'

let completeHandler = null, editHandler = null, notifyReady = () => {}
let openHandler = null, syncHandler = null
let automaticOpen = null, requestedWorkout = null
// A bridge remount is not a disk reload. Keep failed-write receipts hidden until
// flushLocal confirms them, including across a route/root effect remount.
const pendingStandaloneSessions = new Map()
const pendingWearReceipts = new Map(), pendingLedgerSeeds = new Set()
const observedPhoneTimers = new Map(), pendingTimerSeeds = new Set()
// Local guest storage can hydrate before authentication restores the real owner.
// That temporary profile cannot authoritatively end or replace a watch workout.
const ownerReady = store => store.localReady && store.authReady !== false
export function requestWearWorkoutOpen() {
  const store = useStore.getState(), active = store.S.active
  if (!ownerReady(store) || !store.activeSessionToken || !active || active.backfill || active.editingWorkoutId) return
  requestedWorkout = { ownerKey: store.ownerKey, sessionToken: store.activeSessionToken }
  automaticOpen?.()
}
export async function openWearApp() {
  if (!openHandler) throw new Error('wear-unavailable')
  return openHandler()
}
export async function syncWearApp() {
  if (!syncHandler) throw new Error('wear-unavailable')
  return syncHandler()
}
export function registerWearCompletion(handler) {
  completeHandler = handler; notifyReady()
  return () => { if (completeHandler === handler) { completeHandler = null; notifyReady() } }
}
export function registerWearEditing(handler) {
  editHandler = handler; notifyReady()
  return () => { if (editHandler === handler) { editHandler = null; notifyReady() } }
}

export function bindWearBridge() {
  const matches = expected => !expected || (useStore.getState().ownerKey === expected.ownerKey && useStore.getState().activeSessionToken === expected.sessionToken && ownerReady(useStore.getState()))
  const open = async (expected = null) => {
    if (closed || !plugin || !matches(expected) || !snapshot().active) throw new Error('wear-unavailable')
    await publish()
    if (closed || !matches(expected) || !snapshot().active) throw new Error('wear-unavailable')
    return plugin.open({ state: snapshot() })
  }
  let closed = false, plugin, listener, revision = 0, identity = '', contextToken = '', serialized = '', state
  let heart, heartListener, syncListener, inboxListener, inbox
  const manualSync = createWearSync({ request: request => plugin.sync({ request }) })
  const sync = async () => {
    const store = useStore.getState(), expected = { ownerKey: store.ownerKey, sessionToken: store.activeSessionToken }
    if (closed || !initialized || !store.S.active) throw new Error('wear-unavailable')
    try { return await manualSync.start(store.activeSessionToken, () => !closed && matches(expected)) }
    finally { void publish().catch(() => {}) }
  }
  const publisherId = crypto.randomUUID()
  let pendingStandalone = null
  let preparingTimer = null
  let preparedTimerSession = null
  let initialized = false
  let attemptedWorkout = ''
  const openNewWorkout = () => {
    if (!initialized || closed || !requestedWorkout) return
    const expected = requestedWorkout
    if (matches(expected) && (!completeHandler || useUI.getState().sheets.length || useUI.getState().work)) return
    requestedWorkout = null
    const key = JSON.stringify(expected)
    if (!matches(expected) || attemptedWorkout === key) return
    attemptedWorkout = key
    // Let the workout's completion/editing effects settle before publishing/opening.
    void Promise.resolve().then(() => open(expected)).catch(() => {})
  }
  automaticOpen = openNewWorkout
  let transport = Promise.resolve(), sending = false
  const controllers = new Map()
  const phoneTimer = (store, ui = useUI.getState()) => {
    const timer = ui.timer?.context?.ownerKey === store.ownerKey && ui.timer?.context?.activeSessionToken === store.activeSessionToken ? ui.timer : null
    return timer ? { timerToken: timer.timerToken, endsAt: timer.endsAt || 0, leftMs: Math.max(0, Number(timer.left ?? timer.total ?? 0) * 1000), paused: !!timer.paused, ready: !!timer.ready } : null
  }
  function prepareStandaloneTimer() {
    if (preparingTimer) return preparingTimer
    preparingTimer = Promise.resolve().then(async () => {
      const store = useStore.getState(), sessionId = store.activeSessionToken
      if(ownerReady(store) && pendingLedgerSeeds.has(store.ownerKey)) {
        await store.flushLocal()
        if(!matches({ownerKey:store.ownerKey,sessionToken:sessionId})) throw Object.assign(new Error('stale-context'),{code:'stale-context'})
        pendingLedgerSeeds.delete(store.ownerKey)
      }
      if (!ownerReady(store) || !sessionId || !store.S.active) return
      const timer = phoneTimer(store), signature = standaloneTimerSignature(timer)
      const observed = observedPhoneTimers.get(sessionId), seed = store.S.active._wearStandaloneTimer
      const first = preparedTimerSession !== sessionId
      preparedTimerSession = sessionId
      observedPhoneTimers.set(sessionId, signature)
      // A hydrated private seed outlives the UI restoration. Initial null is not
      // evidence of a user skipping rest; a later observed timer change is.
      if (first && !timer && seed?.sessionId === sessionId) {
        if (seed.timer && !pendingStandaloneSessions.has(sessionId)) {
          const checkpoint = store.S.active._wearStandalone || Object.values(store.wearSessions?.[sessionId]?.records || {}).map(r=>r.checkpoint).find(cp=>cp?.runtime?.timer?.timerToken===seed.timer.timerToken)
          useUI.getState().importWearRest?.(seed.timer, checkpoint?.steps?.[checkpoint.cursor - 1] || null)
          observedPhoneTimers.set(sessionId, standaloneTimerSignature(phoneTimer(store)))
        }
      } else if (observed !== signature) {
        const next = reconcileStandaloneTimer(store.S, timer, sessionId)
        if (next !== store.S) {
          pendingTimerSeeds.add(sessionId)
          store.update(S => { S.active._wearStandaloneTimer = next.active._wearStandaloneTimer })
        }
      }
      if (pendingTimerSeeds.has(sessionId)) {
        await useStore.getState().flushLocal()
        if (!matches({ ownerKey: store.ownerKey, sessionToken: sessionId })) throw Object.assign(new Error('stale-context'), { code: 'stale-context' })
        pendingTimerSeeds.delete(sessionId)
      }
      const latest=useStore.getState()
      if(latest.wearSessions) {
        const prepared=prepareWearLedger(latest.S,sessionId,latest.wearSessions)
        if(prepared.S!==latest.S || prepared.updates) {
          pendingLedgerSeeds.add(latest.ownerKey)
          latest.update(S=>{S.active=prepared.S.active},false,{wearSessionUpdates:prepared.updates})
        }
        if(pendingLedgerSeeds.has(latest.ownerKey)) {
          await useStore.getState().flushLocal()
          if(!matches({ownerKey:latest.ownerKey,sessionToken:sessionId})) throw Object.assign(new Error('stale-context'),{code:'stale-context'})
          pendingLedgerSeeds.delete(latest.ownerKey)
        }
      }
    }).finally(() => { preparingTimer = null })
    return preparingTimer
  }
  function snapshot(replayHint=null) {
    const store = useStore.getState(), ui = useUI.getState()
    const nextIdentity = `${store.ownerKey}:${store.activeSessionToken}:${ownerReady(store)}`
    if (nextIdentity !== identity) { identity = nextIdentity; contextToken = store.activeSessionToken || ''; serialized = ''; pendingStandalone = pendingStandaloneSessions.get(contextToken) || null }
    if (!store.S.active?._wearStandalone) { pendingStandaloneSessions.delete(contextToken); pendingStandalone = null }
    const timer = ui.timer?.context?.ownerKey === store.ownerKey && ui.timer?.context?.activeSessionToken === store.activeSessionToken ? ui.timer : null
    const projection = projectWearState({ S: store.S, timer, contextToken, revision: 0, ready: ownerReady(store) && !!store.activeSessionToken, editingReady: !!editHandler && !ui.sheets.length && !ui.work })
    projection.publisherId = publisherId
    projection.localReady = !!ownerReady(store)
    const standalone = projection.active ? projectStandalone(store.S, contextToken) : null
    projection.standalone = pendingStandalone ? pendingStandalone.projection : standalone
    if(store.wearSessions && ownerReady(store)) projection.standaloneSync=pendingWearReceipts.get(store.ownerKey) || wearSyncProjection(store.wearSessions,replayHint)
    projection.heartCapture = heart?.projection() || null
    projection.heartAuthorizedTokens = heart?.authorizedTokens() || []
    if (projection.current && (!completeHandler || ui.sheets.length || ui.work)) projection.current.canComplete = false
    // Ignore the decrementing left time; the watch counts down from endsAt locally.
    const signature = JSON.stringify({ ...projection, timer: projection.timer ? { ...projection.timer, leftMs: projection.timer.paused ? projection.timer.leftMs : 0 } : null })
    if (signature !== serialized) { revision++; serialized = signature }
    state = { ...projection, revision }
    return state
  }
  function publish(sync = null) {
    if (closed || !plugin) return Promise.resolve()
    const run = transport.then(async () => {
      if (closed) return
      if (manualSync.active && sync?.syncId !== manualSync.requestId) return
      await prepareStandaloneTimer()
      if(ownerReady(useStore.getState())) await heart?.adoptStandalone()
      return plugin.publish({ state: snapshot(sync?.replay), ...(sync || {}) })
    })
    transport = run.catch(() => {})
    return run
  }
  function changed() {
    if (!pendingStandalone && !pendingWearReceipts.has(useStore.getState().ownerKey)) void heart?.reconcile().catch(() => {})
    const old = revision; snapshot()
    if (old !== revision && !sending) void publish().catch(() => {})
    openNewWorkout()
    if(initialized) void inbox?.run().catch(()=>{})
  }
  const offStore = useStore.subscribe(changed), offUI = useUI.subscribe(changed)
  notifyReady = changed
  void (async () => {
    if (!(await isAndroid()) || closed) return
    const { registerPlugin } = await import('@capacitor/core')
    plugin = registerPlugin('WearBridge')
    syncListener = await plugin.addListener('sync', event => manualSync.receive(event))
    heart = createWearHeartSession({ getStore: () => useStore.getState(), plugin, changed: () => { if (!closed) void publish().catch(() => {}) } })
    const onHeart=async ({ nodeId, packet, inboxKey }) => {
      try { const response = await heart.receive(packet, nodeId); await plugin.replyHeart({ nodeId, response, inboxKey }) } catch { await plugin.replyHeart({ nodeId, inboxKey, response: { v: 1, requestId: packet?.requestId || '', token: packet?.token || '', status: 'error' } }).catch(() => {}) }
    }
    heartListener = await plugin.addListener('heart',onHeart)
    const onCommand=async ({ nodeId, command, syncId, inboxKey, replay }) => {
      if (closed) return
      if (syncId) { await publish({ nodeId, syncId, replay }).catch(() => {}); return }
      // Each node has a serialized controller, and commands from all nodes are globally serialized below.
      if (!controllers.has(nodeId)) controllers.set(nodeId, createWearController({
        readSnapshot: snapshot,
        completeCurrent: async (target, command) => {
          if (!completeHandler) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
          return heart.complete(command, nodeId, () => completeHandler(target))
        },
        editCurrent: (target, command) => {
          const code = validateWearCommand(command, snapshot())
          if (code || !editHandler) throw Object.assign(new Error(code || 'unavailable'), { code: code || 'unavailable' })
          return editHandler(target, command)
        },
        timerAction: action => {
          const ui = useUI.getState()
          if (action === 'pause') ui.pauseRest()
          else if (action === 'resume') ui.resumeRest()
          else if (action === 'plus15') ui.addRest(15)
          else ui.stopRest()
        },
        flushLocal: () => useStore.getState().flushLocal(),
        publish: () => publish(),
        reply: response => plugin.reply({ nodeId, response }),
      }))
      const controller = controllers.get(nodeId)
      const run = commands.then(async () => {
        sending = true
        try {
          if (command?.action === 'standalone-sync') {
            let response
            const store = useStore.getState(), expected = { ownerKey: store.ownerKey, sessionToken: store.activeSessionToken }
            try {
              if (!ownerReady(store)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
              await prepareStandaloneTimer()
              if (!matches(expected)) throw Object.assign(new Error('stale-context'), { code: 'stale-context' })
              const currentStore = useStore.getState(), before = snapshot(), checkpoint = currentStore.S.active?._wearStandalone
              if(currentStore.wearSessions) {
                const result=applyWearLedger(currentStore.S,currentStore.wearSessions,command,currentStore.activeSessionToken,nodeId)
                if(result.S!==currentStore.S) {
                  if(!pendingWearReceipts.has(store.ownerKey)) pendingWearReceipts.set(store.ownerKey,before.standaloneSync)
                  currentStore.update(S=>{ S.active=result.S.active; S.workouts=result.S.workouts },true,{wearSessionUpdates:result.updates})
                }
                await useStore.getState().flushLocal()
                if(!matches(expected)) throw Object.assign(new Error('stale-context'),{code:'stale-context'})
                await heart.adoptCheckpoint(result.checkpoint,result.workoutId,result.workoutStart)
                if(!matches(expected)) throw Object.assign(new Error('stale-context'),{code:'stale-context'})
                if(result.activeRuntime) useUI.getState().importWearRest?.(result.checkpoint.runtime.timer,result.checkpoint.steps[result.checkpoint.cursor-1] || null)
                observedPhoneTimers.set(expected.sessionToken,standaloneTimerSignature(phoneTimer(useStore.getState())))
                pendingWearReceipts.delete(store.ownerKey)
                response={status:'ok',streamId:result.checkpoint.streamId,seq:command.events.at(-1).seq}
              } else {
              if (checkpoint?.nodeId && checkpoint.nodeId !== nodeId) throw Object.assign(new Error('stream-conflict'), { code: 'stream-conflict' })
              const next = applyStandalone(currentStore.S, command, store.activeSessionToken)
              const importTimer = next !== currentStore.S || !!pendingStandalone
              if (next !== currentStore.S) {
                pendingStandalone = { projection: before.standalone }
                pendingStandaloneSessions.set(store.activeSessionToken, pendingStandalone)
                next.active._wearStandalone.nodeId = nodeId
                store.update(S => { S.active = next.active })
              }
              await useStore.getState().flushLocal()
              if (!matches(expected)) throw Object.assign(new Error('stale-context'), { code: 'stale-context' })
              await heart.adoptStandalone()
              if (!matches(expected)) throw Object.assign(new Error('stale-context'), { code: 'stale-context' })
              const saved = useStore.getState().S.active._wearStandalone
              if (importTimer) useUI.getState().importWearRest?.(saved.runtime.timer, saved.steps[saved.cursor - 1] || null)
              observedPhoneTimers.set(expected.sessionToken, standaloneTimerSignature(phoneTimer(useStore.getState())))
              pendingStandalone = null
              pendingStandaloneSessions.delete(expected.sessionToken)
              response = { status: 'ok', streamId: saved.streamId, seq: command.events.at(-1).seq }
              }
            } catch (e) { response = { status: 'error', code: e.code || 'unavailable', streamId: command.streamId || '', seq: pendingStandalone?.projection?.ack?.seq || 0 } }
            await plugin.reply({ nodeId, inboxKey, response: { v: 1, requestId: command.requestId || '', ...response } })
            await publish()
          } else if (['heart-start', 'heart-cancel'].includes(command?.action)) {
            const cached = heart.result(command, nodeId)
            const before = cached ? null : snapshot()
            const error = cached ? null : validateWearCommand(command, before)
            let response
            try {
              if (error) throw Object.assign(new Error(error), { code: error })
              response = cached || await heart.handle(command, nodeId)
              const current = snapshot()
              // Only a newly confirmed start ends this session's rest. A replay
              // must not cancel the next rest created by completing the set.
              if (!cached && command.action === 'heart-start' && response.status === 'ok' && current.contextToken === command.contextToken && before.timer && current.timer?.timerToken === before.timer.timerToken) useUI.getState().stopRest()
            } catch (e) { response = { status: 'error', code: e.code || 'unavailable' } }
            await publish()
            await plugin.reply({ nodeId, response: { v: 1, requestId: command.requestId, revision, ...response } })
          } else await controller.handle(command)
        } finally { sending = false }
      })
      commands = run.catch(() => {})
      await run.catch(() => {})
    }
    inbox=createWearInbox({plugin,ready:()=>!closed && ownerReady(useStore.getState()) && useStore.getState().ownerKey,
      command:entry=>onCommand({nodeId:entry.nodeId,command:entry.payload,inboxKey:entry.key}),
      heart:entry=>onHeart({nodeId:entry.nodeId,packet:entry.payload,inboxKey:entry.key})})
    inboxListener=await plugin.addListener('inbox',()=>{void inbox.wake().catch(()=>{})})
    listener = await plugin.addListener('command',onCommand)
    if (closed) { await listener.remove(); return }
    openHandler = open
    await heart.reconcile()
    await publish()
    initialized = true
    syncHandler = sync
    openNewWorkout()
    await inbox.run()
  })().catch(() => {})
  let commands = Promise.resolve()
  return () => { closed = true; if (automaticOpen === openNewWorkout) { automaticOpen = null; requestedWorkout = null } if (openHandler === open) openHandler = null; if (syncHandler === sync) syncHandler = null; manualSync.dispose(); inbox?.dispose(); offStore(); offUI(); notifyReady = () => {}; for (const c of controllers.values()) c.dispose(); heart?.dispose(); void inboxListener?.remove(); void syncListener?.remove(); void heartListener?.remove(); void listener?.remove(); void plugin?.clear().catch(() => {}) }
}
