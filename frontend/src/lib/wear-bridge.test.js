import { it, expect, vi, beforeEach } from 'vitest'

const f = vi.hoisted(() => ({ store: null, ui: null, storeListeners: new Set(), uiListeners: new Set(), receive: null,
  plugin: { publish: vi.fn().mockResolvedValue(), reply: vi.fn().mockResolvedValue(), clear: vi.fn().mockResolvedValue(), open: vi.fn().mockResolvedValue({ requested: true }), addListener: vi.fn(), },
}))
vi.mock('./mobile.js', () => ({ isAndroid: async () => true }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => f.store, subscribe: cb => { f.storeListeners.add(cb); return () => f.storeListeners.delete(cb) } } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => f.ui, subscribe: cb => { f.uiListeners.add(cb); return () => f.uiListeners.delete(cb) } } }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => f.plugin }))
import { bindWearBridge, registerWearCompletion, registerWearEditing, openWearApp, requestWearWorkoutOpen, syncWearApp } from './wear-bridge.js'
const standaloneEvents = () => [{ seq: 1, id: '00000000-0000-4000-8000-000000000001', action: 'start', at: 1000, step: 0 }, { seq: 2, id: '00000000-0000-4000-8000-000000000002', action: 'complete', at: 2000, step: 0 }]
const standaloneCommand = state => ({ v: 1, action: 'standalone-sync', requestId: standaloneEvents()[1].id, contextToken: state.contextToken, streamId: 'stream', baseline: state.standalone.baseline, events: standaloneEvents() })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
it('ignores UI-only countdown ticks instead of draining native inbox on every render',async()=>{
  f.plugin.drainInbox=vi.fn().mockResolvedValue({entries:[],next:''})
  const stop=bindWearBridge()
  try {
    await tick();await tick();const initial=f.plugin.drainInbox.mock.calls.length
    for(let i=0;i<25;i++) {f.ui.toast=`toast-${i}`;for(const notify of f.uiListeners) notify();await tick()}
    expect(f.plugin.drainInbox).toHaveBeenCalledTimes(initial)
  } finally {stop();delete f.plugin.drainInbox}
})
it('coalesces a blocked snapshot burst so reopening does not wait behind repeated identical publications',async()=>{
  const stop=bindWearBridge();let release
  try {
    await tick();await tick()
    f.plugin.publish.mockClear().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
    for(let i=0;i<30;i++) {f.store.S={...f.store.S,vibrate:i%2===0};for(const notify of f.storeListeners) notify()}
    await tick();expect(release).toBeTypeOf('function')
    const open=openWearApp();release();await open
    expect(f.plugin.publish.mock.calls.length).toBeLessThanOrEqual(2)
  } finally {release?.();stop();f.plugin.publish.mockResolvedValue()}
})
it('keeps explicit synchronization available after the first native publication failed',async()=>{
  f.plugin.publish.mockRejectedValue(new Error('wear-disconnected'))
  f.plugin.sync=vi.fn().mockResolvedValue({nodeId:'watch'})
  const stop=bindWearBridge()
  try {
    await tick();await tick();f.plugin.publish.mockResolvedValue()
    const attempt=syncWearApp();attempt.catch(()=>{})
    await tick();expect(f.plugin.sync).toHaveBeenCalledOnce()
  } finally {stop();delete f.plugin.sync}
})
it('pulls watch work before publishing the explicit refresh and waits for its result', async () => {
  heartFixture()
  const handlers = {}
  f.plugin.addListener.mockImplementation(async (name, cb) => { handlers[name] = cb; return { remove: vi.fn() } })
  f.plugin.sync = vi.fn().mockResolvedValue({ nodeId: 'watch' })
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const before = f.plugin.publish.mock.calls.at(-1)[0].state
    const task = syncWearApp(); await tick()
    const refresh = f.plugin.sync.mock.calls[0][0].request
    const count = f.plugin.publish.mock.calls.length
    await handlers.command({ nodeId: 'watch', command: standaloneCommand(before) })
    expect(f.store.S.active.entries[0].sets[0].done).toBe(true)
    expect(f.plugin.publish.mock.calls).toHaveLength(count)
    await handlers.command({ nodeId: 'watch', syncId: refresh.requestId })
    expect(f.plugin.publish.mock.calls.at(-1)[0]).toMatchObject({ nodeId: 'watch', syncId: refresh.requestId, state: { standalone: { ack: { seq: 2 } } } })
    handlers.sync({ nodeId: 'watch', response: { ...refresh, status: 'ok', heartPending: 0 } })
    expect(await task).toEqual({ heartPending: 0 })
  } finally { stop(); delete f.plugin.sync }
})
it('preserves workout authorization across bridge restarts and changes publisher identity', async () => {
  let stop = bindWearBridge()
  try {
    await tick(); await tick()
    const first = f.plugin.publish.mock.calls.at(-1)[0].state
    stop(); stop = bindWearBridge(); await tick(); await tick()
    const second = f.plugin.publish.mock.calls.at(-1)[0].state
    expect(first.contextToken).toBe('s'); expect(second.contextToken).toBe('s')
    expect(second.publisherId).not.toBe(first.publisherId)
    expect(second.localReady).toBe(true)
    expect(JSON.stringify(second)).not.toContain('private-owner')
  } finally { stop() }
})
it('imports a standalone completion without a mounted Workout and acknowledges only after durable flush', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const state = f.plugin.publish.mock.calls.at(-1)[0].state, command = standaloneCommand(state)
    let release; f.store.flushLocal.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = f.receive({ nodeId: 'watch', command }); await tick()
    expect(f.store.S.active.entries[0].sets[0].done).toBe(true)
    expect(f.plugin.reply).not.toHaveBeenCalled()
    release(); await pending
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', streamId: 'stream', seq: 2 })
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.standalone.ack).toEqual({ streamId: 'stream', seq: 2 })
    await f.receive({ nodeId: 'watch', command })
    expect(f.store.update).toHaveBeenCalledOnce()
  } finally { stop() }
})
it('keeps a reconnecting watch retryable while the phone is still hydrating', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = standaloneCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    f.store.localReady = false
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'error', code: 'unavailable' })
    expect(f.store.S.active.entries[0].sets[0].done).toBe(false)
    f.store.localReady = true
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
    expect(f.store.S.active.entries[0].sets[0].done).toBe(true)
  } finally { stop() }
})
it('does not treat the temporary guest profile during authentication as a workout replacement', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = standaloneCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    const previous = { S: f.store.S, ownerKey: f.store.ownerKey, activeSessionToken: f.store.activeSessionToken }
    Object.assign(f.store, { authReady: false, ownerKey: 'temporary-guest', activeSessionToken: null, S: { unit: 'kg', active: null } })
    for (const cb of f.storeListeners) cb()
    await tick(); await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.localReady).toBe(false)
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'error', code: 'unavailable' })
    Object.assign(f.store, previous, { authReady: true })
    for (const cb of f.storeListeners) cb()
    await tick(); await tick()
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
    expect(f.store.S.active.entries[0].sets[0].done).toBe(true)
  } finally { stop() }
})
it('returns a temporary error to offline work received before authentication settles', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = standaloneCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    Object.assign(f.store, { authReady: false, ownerKey: 'temporary-guest', activeSessionToken: null, S: { active: null } })
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'error', code: 'unavailable' })
    expect(f.store.update).not.toHaveBeenCalled()
  } finally { stop() }
})
it('retries a failed local standalone write without publishing an unpersisted receipt or applying twice', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const state = f.plugin.publish.mock.calls.at(-1)[0].state, command = standaloneCommand(state)
    f.store.flushLocal.mockRejectedValueOnce(new Error('disk-full'))
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('error')
    for (const cb of f.storeListeners) cb(); await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.standalone.ack).toBeNull()
    await f.receive({ nodeId: 'watch', command })
    expect(f.store.update).toHaveBeenCalledOnce()
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  } finally { stop() }
})
it('refuses to acknowledge a standalone import when the active session changes during flush', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = standaloneCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    f.store.flushLocal.mockImplementationOnce(async () => { f.store.activeSessionToken = 'replacement' })
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'error', code: 'stale-context' })
  } finally { stop() }
})
it('keeps an unpersisted receipt hidden when the bridge is remounted', async () => {
  heartFixture()
  let stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = standaloneCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    f.store.flushLocal.mockRejectedValueOnce(new Error('disk-full'))
    await f.receive({ nodeId: 'watch', command })
    stop(); stop = bindWearBridge(); await tick(); await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.standalone.ack).toBeNull()
    await f.receive({ nodeId: 'watch', command })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
    expect(f.store.update).toHaveBeenCalledOnce()
  } finally { stop() }
})
it('withholds a changed phone timer baseline until its seed is saved and retries the pending seed', async () => {
  heartFixture()
  const stop = bindWearBridge()
  try {
    await tick(); await tick()
    const before = f.plugin.publish.mock.calls.at(-1)[0].state
    f.store.flushLocal.mockRejectedValue(new Error('disk-full'))
    f.ui.timer = { timerToken: 'phone-new-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000, left: 90, total: 90 }
    for (const cb of f.uiListeners) cb()
    await tick(); await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.standalone.baseline).toBe(before.standalone.baseline)
    await f.receive({ nodeId: 'watch', command: standaloneCommand(before) })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('error')
    expect(f.store.S.active.entries[0].sets[0].done).toBe(false)
    f.store.flushLocal.mockResolvedValue()
    await f.receive({ nodeId: 'watch', syncId: 'retry-seed' })
    const after = f.plugin.publish.mock.calls.at(-1)[0].state
    expect(after.standalone.runtime.timer.timerToken).toBe('phone-new-rest')
    expect(after.standalone.baseline).not.toBe(before.standalone.baseline)
  } finally { stop() }
})
it('opens once for an explicit new workout, including a request before plugin initialization', async () => {
  requestWearWorkoutOpen()
  const stop = bindWearBridge()
  let unregister
  try {
    await tick(); await tick(); await tick()
    expect(f.plugin.open).not.toHaveBeenCalled()
    unregister = registerWearCompletion(vi.fn()); await tick(); await tick()
    expect(f.plugin.open).toHaveBeenCalledOnce()
    requestWearWorkoutOpen(); await tick()
    expect(f.plugin.open).toHaveBeenCalledOnce()
    for (const cb of f.storeListeners) cb()
    await tick(); expect(f.plugin.open).toHaveBeenCalledOnce()
    f.store.activeSessionToken = 'next-workout'
    requestWearWorkoutOpen(); await tick(); await tick()
    expect(f.plugin.open).toHaveBeenCalledTimes(2)
  } finally { stop(); unregister?.() }
})
it.each(['backfill', 'editingWorkoutId'])('does not open the watch for %s sessions', async field => {
  f.store.S.active[field] = 'historical'
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  try {
    await tick(); await tick(); requestWearWorkoutOpen(); await tick()
    expect(f.plugin.open).not.toHaveBeenCalled()
  } finally { stop(); unregister() }
})
it('does not automatically open a restored workout or a request made obsolete during publish', async () => {
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  try {
    await tick(); await tick()
    expect(f.plugin.open).not.toHaveBeenCalled()
    let release
    f.plugin.publish.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    requestWearWorkoutOpen(); await tick()
    f.store.activeSessionToken = 'replacement'
    release(); await tick(); await tick()
    expect(f.plugin.open).not.toHaveBeenCalled()
  } finally { f.plugin.publish.mockResolvedValue(); stop(); unregister() }
})
beforeEach(() => {
  vi.clearAllMocks(); f.storeListeners.clear(); f.uiListeners.clear()
  f.plugin.publish.mockReset().mockResolvedValue()
  delete f.plugin.getHeartBindings; delete f.plugin.saveHeartBindings
  f.store = { ownerKey: 'private-owner', activeSessionToken: 's', localReady: true, S: { unit: 'kg', active: { cur: 0, entries: [{ id: '0025', sets: [{ r: 10, w: 60, done: false }] }] } }, flushLocal: vi.fn().mockResolvedValue() }
  f.store.update = vi.fn(producer => { const next = structuredClone(f.store.S); producer(next); f.store.S = next; for (const cb of f.storeListeners) cb() })
  f.ui = { sheets: [], work: null, timer: null, pauseRest: vi.fn(), resumeRest: vi.fn(), addRest: vi.fn(), stopRest: vi.fn() }
  f.plugin.addListener.mockImplementation(async (_, cb) => { f.receive = cb; return { remove: vi.fn() } })
})
function heartFixture() {
  f.store.S.active.id = 'training'
  f.plugin.getHeartBindings = vi.fn().mockResolvedValue({ bindings: {} })
  f.plugin.saveHeartBindings = vi.fn().mockResolvedValue()
  f.store.update = vi.fn(producer => {
    const next = structuredClone(f.store.S); producer(next); f.store.S = next
    for (const cb of f.storeListeners) cb()
  })
  f.ui.stopRest.mockImplementation(() => {
    f.ui.timer = null
    for (const cb of f.uiListeners) cb()
  })
}
const startCommand = state => ({ v: 1, requestId: 'start', action: 'heart-start', startedAt: Date.now(), contextToken: state.contextToken, revision: state.revision, target: { entryIdx: 0, setIdx: 0, side: null } })
it('exposes editing readiness and routes edits without changing timers or capture', async () => {
  heartFixture()
  const handler = vi.fn((target, command) => f.store.update(S => { S.active.entries[target.entryIdx].sets[target.setIdx].r = command.value }))
  const unregister = registerWearEditing(handler), stop = bindWearBridge()
  try {
    await tick(); await tick()
    const state = f.plugin.publish.mock.calls.at(-1)[0].state
    expect(state.current.canEdit).toBe(true)
    await f.receive({ nodeId: 'watch', command: { ...startCommand(state), requestId: 'edit', action: 'edit-set', field: 'r', value: 12 } })
    expect(handler).toHaveBeenCalledOnce()
    expect(f.store.S.active.entries[0].sets[0].r).toBe(12)
    expect(f.ui.stopRest).not.toHaveBeenCalled()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.heartCapture).toBeNull()
    f.ui.sheets = [{}]; for (const cb of f.uiListeners) cb()
    await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.current.canEdit).toBe(false)
    f.ui.sheets = []; unregister(); await tick()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.current.canEdit).toBe(false)
  } finally { stop(); unregister() }
})
it.each(['running', 'paused', 'ready'])('cancels %s rest after the set start is durably confirmed', async kind => {
  heartFixture()
  f.ui.timer = { timerToken: 'old-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000, left: 90, paused: kind === 'paused', ready: kind === 'ready' }
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  try {
    await tick(); await tick()
    await f.receive({ nodeId: 'watch', command: startCommand(f.plugin.publish.mock.calls.at(-1)[0].state) })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
    expect(f.ui.stopRest).toHaveBeenCalledOnce()
    expect(f.store.flushLocal.mock.invocationCallOrder[0]).toBeLessThan(f.ui.stopRest.mock.invocationCallOrder[0])
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.timer).toBeNull()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.heartCapture.phase).toBe('effort')
  } finally { stop(); unregister() }
})
it('keeps rest when a heart start cannot be durably confirmed', async () => {
  heartFixture()
  f.ui.timer = { timerToken: 'old-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  try {
    await tick(); await tick()
    f.store.flushLocal.mockRejectedValue(new Error('disk unavailable'))
    await f.receive({ nodeId: 'watch', command: startCommand(f.plugin.publish.mock.calls.at(-1)[0].state) })
    expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('error')
    expect(f.ui.stopRest).not.toHaveBeenCalled()
    expect(f.ui.timer.timerToken).toBe('old-rest')
  } finally { stop(); unregister() }
})
it('does not cancel the new completion rest when the prior start is replayed', async () => {
  heartFixture()
  f.ui.timer = { timerToken: 'old-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  const complete = vi.fn(() => {
    f.store.update(S => { S.active.entries[0].sets[0].done = true })
    f.ui.timer = { timerToken: 'new-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  })
  const unregister = registerWearCompletion(complete), stop = bindWearBridge()
  try {
    await tick(); await tick()
    const command = startCommand(f.plugin.publish.mock.calls.at(-1)[0].state)
    await f.receive({ nodeId: 'watch', command })
    const state = f.plugin.publish.mock.calls.at(-1)[0].state
    await f.receive({ nodeId: 'watch', command: { ...command, requestId: 'complete', action: 'complete', revision: state.revision, heartElapsedMs: 1000 } })
    expect(complete).toHaveBeenCalledOnce()
    await f.receive({ nodeId: 'watch', command })
    expect(f.ui.stopRest).toHaveBeenCalledOnce()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.timer.timerToken).toBe('new-rest')
  } finally { stop(); unregister() }
})
it('preserves a phone completion rest created while the watch start is saving', async () => {
  heartFixture()
  f.ui.timer = { timerToken: 'old-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  let release
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  try {
    await tick(); await tick()
    f.store.flushLocal.mockClear().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = f.receive({ nodeId: 'watch', command: startCommand(f.plugin.publish.mock.calls.at(-1)[0].state) })
    await vi.waitFor(() => expect(f.store.flushLocal).toHaveBeenCalledOnce())
    f.store.update(S => { S.active.entries[0].sets[0].done = true })
    f.ui.timer = { timerToken: 'phone-completion-rest', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
    release(); await pending
    expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
    expect(f.ui.stopRest).not.toHaveBeenCalled()
    expect(f.plugin.publish.mock.calls.at(-1)[0].state.timer.timerToken).toBe('phone-completion-rest')
  } finally { release?.(); stop(); unregister() }
})
it('completes once, persists and publishes the resulting rest before acknowledging', async () => {
  const complete = vi.fn(() => {
    f.store.S.active.entries[0].sets[0].done = true
    f.ui.timer = { timerToken: 't', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000, total: 90 }
    for (const cb of f.storeListeners) cb()
  })
  const unregister = registerWearCompletion(complete), stop = bindWearBridge()
  await tick(); await tick()
  const state = f.plugin.publish.mock.calls.at(-1)[0].state
  const command = { v: 1, requestId: 'r', action: 'complete', contextToken: state.contextToken, revision: state.revision, target: { entryIdx: 0, setIdx: 0, side: null } }
  await f.receive({ nodeId: 'watch', command }); await f.receive({ nodeId: 'watch', command })
  expect(complete).toHaveBeenCalledTimes(1)
  expect(f.store.flushLocal).toHaveBeenCalledTimes(2) // Completion, then its durable standalone timer seed.
  expect(f.plugin.publish.mock.calls.at(-1)[0].state.timer.timerToken).toBe('t')
  expect(f.plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(JSON.stringify(state)).not.toContain('private-owner')
  stop(); unregister()
})
it('keeps the timer while a sheet is open and invalidates old account commands', async () => {
  f.ui.sheets = [{}]
  f.ui.timer = { timerToken: 't', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  await tick(); await tick()
  const state = f.plugin.publish.mock.calls.at(-1)[0].state
  expect(state.current.canComplete).toBe(false); expect(state.timer.timerToken).toBe('t')
  f.store.ownerKey = 'new-owner'; f.store.activeSessionToken = 'new-owner-session'; for (const cb of f.storeListeners) cb()
  await f.receive({ nodeId: 'watch', command: { v: 1, requestId: 'old', contextToken: state.contextToken, revision: state.revision, action: 'complete', target: { entryIdx: 0, setIdx: 0, side: null } } })
  expect(f.plugin.reply.mock.calls.at(-1)[0].response.code).toBe('stale-context')
  expect(f.plugin.publish.mock.calls.at(-1)[0].state.timer).toBeNull()
  stop(); unregister()
})
it('forwards plus15 to the real UI action and returns a fresh sync snapshot', async () => {
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  f.ui.timer = { timerToken: 't', context: { ownerKey: f.store.ownerKey, activeSessionToken: 's' }, endsAt: Date.now() + 90000 }
  await tick(); await tick()
  await f.receive({ nodeId: 'watch', syncId: 'sync' })
  const last = f.plugin.publish.mock.calls.at(-1)[0]
  expect(last.syncId).toBe('sync'); expect(last.nodeId).toBe('watch')
  await f.receive({ nodeId: 'watch', command: { v: 1, requestId: 'plus', contextToken: last.state.contextToken, revision: last.state.revision, action: 'plus15', target: { timerToken: 't' } } })
  expect(f.ui.addRest).toHaveBeenCalledWith(15)
  stop(); unregister()
})
it('publishes a current workout before requesting remote opening and refuses after cleanup', async () => {
  const unregister = registerWearCompletion(vi.fn()), stop = bindWearBridge()
  await tick(); await tick()
  expect(await openWearApp()).toEqual({ requested: true })
  expect(f.plugin.open.mock.calls[0][0].state.active).toBe(true)
  expect(f.plugin.publish.mock.invocationCallOrder.at(-1)).toBeLessThan(f.plugin.open.mock.invocationCallOrder[0])
  stop(); unregister()
  await expect(openWearApp()).rejects.toThrow()
})
