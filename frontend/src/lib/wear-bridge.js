import { isAndroid } from './mobile.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { projectWearState } from './wear-protocol.js'
import { createWearHeartSession } from './wear-heart-session.js'
import { validateWearCommand } from './wear-protocol.js'
import { createWearController } from './wear-session.js'

let completeHandler = null, editHandler = null, notifyReady = () => {}
let openHandler = null
let automaticOpen = null, requestedWorkout = null
export function requestWearWorkoutOpen() {
  const store = useStore.getState(), active = store.S.active
  if (!store.localReady || !store.activeSessionToken || !active || active.backfill || active.editingWorkoutId) return
  requestedWorkout = { ownerKey: store.ownerKey, sessionToken: store.activeSessionToken }
  automaticOpen?.()
}
export async function openWearApp() {
  if (!openHandler) throw new Error('wear-unavailable')
  return openHandler()
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
  const matches = expected => !expected || (useStore.getState().ownerKey === expected.ownerKey && useStore.getState().activeSessionToken === expected.sessionToken && useStore.getState().localReady)
  const open = async (expected = null) => {
    if (closed || !plugin || !matches(expected) || !snapshot().active) throw new Error('wear-unavailable')
    await publish()
    if (closed || !matches(expected) || !snapshot().active) throw new Error('wear-unavailable')
    return plugin.open({ state: snapshot() })
  }
  let closed = false, plugin, listener, revision = 0, identity = '', contextToken = '', serialized = '', state
  let heart, heartListener
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
  function snapshot() {
    const store = useStore.getState(), ui = useUI.getState()
    const nextIdentity = `${store.ownerKey}:${store.activeSessionToken}:${store.localReady}`
    if (nextIdentity !== identity) { identity = nextIdentity; contextToken = crypto.randomUUID(); serialized = '' }
    const timer = ui.timer?.context?.ownerKey === store.ownerKey && ui.timer?.context?.activeSessionToken === store.activeSessionToken ? ui.timer : null
    const projection = projectWearState({ S: store.S, timer, contextToken, revision: 0, ready: store.localReady && !!store.activeSessionToken, editingReady: !!editHandler && !ui.sheets.length && !ui.work })
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
    const value = snapshot()
    const run = transport.then(() => closed ? undefined : plugin.publish({ state: value, ...(sync || {}) }))
    transport = run.catch(() => {})
    return run
  }
  function changed() {
    void heart?.reconcile().catch(() => {})
    const old = revision; snapshot()
    if (old !== revision && !sending) void publish().catch(() => {})
    openNewWorkout()
  }
  const offStore = useStore.subscribe(changed), offUI = useUI.subscribe(changed)
  notifyReady = changed
  void (async () => {
    if (!(await isAndroid()) || closed) return
    const { registerPlugin } = await import('@capacitor/core')
    plugin = registerPlugin('WearBridge')
    heart = createWearHeartSession({ getStore: () => useStore.getState(), plugin, changed: () => { if (!closed) void publish().catch(() => {}) } })
    heartListener = await plugin.addListener('heart', async ({ nodeId, packet }) => {
      try { const response = await heart.receive(packet, nodeId); await plugin.replyHeart({ nodeId, response }) } catch { await plugin.replyHeart({ nodeId, response: { v: 1, requestId: packet?.requestId || '', token: packet?.token || '', status: 'error' } }).catch(() => {}) }
    })
    listener = await plugin.addListener('command', async ({ nodeId, command, syncId }) => {
      if (closed) return
      if (syncId) { await publish({ nodeId, syncId }).catch(() => {}); return }
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
          if (['heart-start', 'heart-cancel'].includes(command?.action)) {
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
    })
    if (closed) { await listener.remove(); return }
    openHandler = open
    await heart.reconcile()
    await publish()
    initialized = true
    openNewWorkout()
  })().catch(() => {})
  let commands = Promise.resolve()
  return () => { closed = true; if (automaticOpen === openNewWorkout) { automaticOpen = null; requestedWorkout = null } if (openHandler === open) openHandler = null; offStore(); offUI(); notifyReady = () => {}; for (const c of controllers.values()) c.dispose(); heart?.dispose(); void heartListener?.remove(); void listener?.remove(); void plugin?.clear().catch(() => {}) }
}
