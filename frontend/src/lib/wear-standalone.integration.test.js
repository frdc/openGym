// @vitest-environment happy-dom
// Real owner store, persistence and UI timer; only the native transport/alarm boundary is fake.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ fixture: null, command: null, heart: null, inbox:null }))
const plugin = vi.hoisted(() => ({
  publish: vi.fn().mockResolvedValue(), reply: vi.fn().mockResolvedValue(), replyHeart: vi.fn().mockResolvedValue(), clear: vi.fn().mockResolvedValue(),
  getHeartBindings: vi.fn().mockResolvedValue({ bindings: {} }), saveHeartBindings: vi.fn().mockResolvedValue(),
  drainInbox:vi.fn().mockResolvedValue({entries:[],next:''}),
  open:vi.fn().mockResolvedValue({requested:true}),
  addListener: vi.fn(),
}))
vi.mock('../store/useStore.js', async original => {
  const actual = await original()
  const { createUIStoreFixture } = await import('../store/ui-test-runtime.js')
  runtime.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
  return { ...actual, useStore: runtime.fixture.useStore }
})
vi.mock('./mobile.js', async original => ({ ...await original(), MOBILE: true, isAndroid: async () => true }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }))
vi.mock('./rest-alert.js', () => ({ armRestAlert: vi.fn().mockResolvedValue(true), holdRestAlert: vi.fn(), disarmRestAlert: vi.fn(), bindNativeRest: vi.fn() }))
vi.mock('./sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
import { useStore, createWorkoutStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindWearBridge,openWearApp } from './wear-bridge.js'
import { fakeStorage } from './cloud/test-fixtures.js'
import { buildCompletedWorkout } from './finish-workout.js'

let stop
const latest = () => plugin.publish.mock.calls.at(-1)?.[0]?.state
const event = (seq, action, at, step = 0) => ({ seq, id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, action, at, step })
const packet = (state, events) => ({ v: 1, action: 'standalone-sync', requestId: events.at(-1).id, contextToken: state.contextToken, streamId: 'real-store-stream', baseline: state.standalone.baseline, events })
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
beforeEach(async () => {
  vi.clearAllMocks()
  plugin.drainInbox.mockResolvedValue({entries:[],next:''})
  plugin.reply.mockResolvedValue();plugin.replyHeart.mockResolvedValue()
  plugin.addListener.mockImplementation(async (name, handler) => { if (name === 'command') runtime.command = handler; if (name === 'heart') runtime.heart = handler; if(name==='inbox') runtime.inbox=handler; return { remove: vi.fn() } })
  runtime.fixture.begin()
  await runtime.fixture.prepare({ restSec: 90, active: { id: 'integration', start: Date.now(), cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ r: 10, w: 60, done: false }, { r: 10, w: 60, done: false }] }] } })
  useUI.setState({ timer: null, work: null, sheets: [] })
  stop = bindWearBridge()
  await vi.waitFor(() => expect(latest()?.standalone).toBeTruthy())
})
afterEach(async () => { stop?.(); useUI.getState().stopRest(); await runtime.fixture.close() })

it('reopens with a phone-completed watch capture without a persistence feedback loop',async()=>{
  const original=latest(),at=Date.now()-10000
  await runtime.command({nodeId:'watch',command:packet(original,[{...event(1,'start',at),heart:true}])})
  const update=useStore.getState().update;let writes=0
  useStore.setState({update:(...args)=>{if(++writes>12) throw new Error('reconcile-feedback-loop');return update(...args)}})
  try {
    useStore.getState().update(S=>{const row=S.active.entries[0].sets[0];row.done=true;row.at=at+1000})
    await vi.waitFor(()=>expect(useStore.getState().S.active.entries[0].sets[0].heartRate.effortEndMs).toBe(1000))
    stop();stop=bindWearBridge();await settle();await openWearApp();await settle()
    expect(writes).toBeLessThan(8);expect(plugin.open).toHaveBeenCalledOnce()
    expect(useStore.getState().S.active.entries[0].sets[0].heartRate).toMatchObject({startedAt:at,effortEndMs:1000})
  } finally {useStore.setState({update})}
})

it('drains a native heart packet received before its journal and retains foreign work',async()=>{
  const original=latest(),at=Date.now()-10000,events=[{...event(1,'start',at),heart:true},event(2,'complete',at+1000)]
  let entries=[{key:'heart',nodeId:'watch',kind:'heart',payload:{v:1,requestId:'native-heart',token:events[0].id,measurement:{startedAt:at,effortEndMs:1000,recoveryEndMs:2000,endReason:'disabled',points:[[0,80],[1000,120],[2000,90]]}}},
    {key:'journal',nodeId:'watch',kind:'command',payload:packet(original,events)},
    {key:'foreign',nodeId:'watch',kind:'command',payload:{...packet(original,events),contextToken:'foreign-session'}}]
  plugin.drainInbox.mockImplementation(async()=>({entries:structuredClone(entries),next:''}))
  const retire=async({inboxKey,response})=>{if(response.status==='ok') entries=entries.filter(e=>e.key!==inboxKey)}
  plugin.reply.mockImplementation(retire);plugin.replyHeart.mockImplementation(retire)
  runtime.inbox()
  await vi.waitFor(()=>expect(entries.map(e=>e.key)).toEqual(['foreign']))
  expect(useStore.getState().S.active.entries[0].sets[0].heartRate.points).toEqual([[0,80],[1000,120],[2000,90]])
})

it('withholds receipts after failed local confirmation and retries without double completion',async()=>{
  const original=latest(), savedFlush=useStore.getState().flushLocal, at=Date.now()-10000
  const command=packet(original,[event(1,'start',at),event(2,'complete',at+1000)])
  useStore.setState({flushLocal:async()=>{throw new Error('disk-full')}})
  await runtime.command({nodeId:'watch',command})
  expect(plugin.reply.mock.calls.at(-1)[0].response.status).toBe('error')
  expect(latest().standaloneSync.receipts).toEqual([])
  useStore.setState({flushLocal:savedFlush})
  await runtime.command({nodeId:'watch',command})
  expect(plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(latest().standaloneSync.receipts[0].seq).toBe(2)
  expect(useStore.getState().S.active.entries[0].sets.filter(s=>s.done)).toHaveLength(1)
})

it('withholds receipts until historical heart adoption is durable, including a remount',async()=>{
  const original=latest(), at=Date.now()-10000
  const events=[{...event(1,'start',at),heart:true},event(2,'complete',at+1000)]
  plugin.saveHeartBindings.mockRejectedValue(new Error('native-disk-full'))
  await runtime.command({nodeId:'watch',command:packet(original,events)})
  expect(plugin.reply.mock.calls.at(-1)[0].response.status).toBe('error')
  expect(latest().standaloneSync.receipts).toEqual([])
  stop();stop=bindWearBridge();await settle()
  expect(latest().standaloneSync.receipts).toEqual([])
  plugin.saveHeartBindings.mockResolvedValue()
  await runtime.command({nodeId:'watch',command:packet(original,events)})
  expect(plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(latest().heartAuthorizedTokens).toContain(events[0].id)
})

it('imports an offline workout, adds another exercise and retains its delayed heart measurements', async () => {
  const initial = latest(), at = Date.now() - 10000
  const events = [{ ...event(1, 'start', at), heart: true }, event(2, 'complete', at + 1000), event(3, 'start', at + 2000, 1), event(4, 'complete', at + 3000, 1)]
  const offline = packet(initial, events)
  await runtime.command({ nodeId: 'watch', command: offline })
  expect(useStore.getState().S.active.entries[0].sets.map(s => s.done)).toEqual([true, true])
  useStore.getState().update(S => { S.active.entries.push({ id: '0026', sets: [{ r: 12, w: 20, done: false }] }); S.active.cur = 1 })
  await vi.waitFor(() => expect(latest().standaloneSync.receipts.some(r=>r.seq===4)).toBe(true))
  await vi.waitFor(()=>expect(latest().standalone.steps[0]?.entryIdx).toBe(1))
  expect(latest().standalone.steps[0]).toMatchObject({ entryIdx: 1, setIdx: 0, repsValue: 12 })
  await runtime.command({ nodeId: 'watch', command: offline })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 4 })
  await runtime.heart({ nodeId: 'watch', packet: { v: 1, requestId: 'late-measurement', token: events[0].id,
    measurement: { startedAt: at, effortEndMs: 1000, recoveryEndMs: 2000, endReason: 'next-set', points: [[0, 100], [1000, 155], [2000, 120]] } } })
  expect(plugin.replyHeart.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(useStore.getState().S.active.entries[0].sets[0].heartRate.effort.peak).toBe(155)
  expect(useStore.getState().S.active.entries[1].sets[0].done).toBe(false)
  const fresh = latest()
  const newEvents = [event(1, 'start', at + 5000), event(2, 'complete', at + 6000)].map(e => ({ ...e, id: crypto.randomUUID() }))
  await runtime.command({ nodeId: 'watch', command: { ...packet(fresh, newEvents), streamId: 'new-sequence' } })
  expect(plugin.reply.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(useStore.getState().S.active.entries[1].sets[0].done).toBe(true)
  expect(useStore.getState().S.active.entries[0].sets[0].heartRate.effort.peak).toBe(155)
})

it('imports A after finish into history with its late heart curve while preserving active B', async () => {
  const original=latest(), at=Date.now()-10000
  const events=[{...event(1,'start',at),heart:true},event(2,'complete',at+1000)]
  useStore.getState().update(S=>{
    S.workouts.push(buildCompletedWorkout(S.active,{end:at+5000}))
    S.active={id:'next-workout',start:Date.now(),cur:0,entries:[{id:'0026',sets:[{r:8,w:20,done:false}]}]}
  })
  await useStore.getState().flushLocal()
  await vi.waitFor(()=>expect(latest().contextToken).not.toBe(original.contextToken))
  await vi.waitFor(()=>expect(useStore.getState().S.active.entries[0].logId).toBeTruthy())
  const next=structuredClone(useStore.getState().S.active)
  const prepared=useStore.getState().wearSessions[original.contextToken]
  expect(useStore.getState().S.workouts[0]).toMatchObject({id:prepared.workoutId,start:prepared.start})
  await runtime.command({nodeId:'watch',command:packet(original,events)})
  expect(plugin.reply.mock.calls.at(-1)[0].response.code).toBeUndefined()
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({status:'ok',seq:2})
  expect(useStore.getState().S.active).toEqual(next)
  expect(useStore.getState().S.workouts[0].entries[0].sets[0]).toMatchObject({done:true,heartRate:{startedAt:at}})
  await runtime.heart({nodeId:'watch',packet:{v:1,requestId:'history-heart',token:events[0].id,measurement:{startedAt:at,effortEndMs:1000,recoveryEndMs:2000,endReason:'disabled',points:[[0,80],[1000,130],[2000,90]]}}})
  expect(plugin.replyHeart.mock.calls.at(-1)[0].response.status).toBe('ok')
  expect(useStore.getState().S.workouts[0].entries[0].sets[0].heartRate.points).toEqual([[0,80],[1000,130],[2000,90]])
  expect(useStore.getState().S.active).toEqual(next)
  await runtime.command({nodeId:'watch',command:packet(original,events)})
  expect(useStore.getState().S.workouts[0].entries[0].sets.filter(s=>s.done)).toHaveLength(1)
})

it('persists first start and completion through the real UI, then replays without restarting rest', async () => {
  const initial = latest(), at = Date.now() - 15000
  const started = event(1, 'start', at - 1000)
  await runtime.command({ nodeId: 'watch', command: packet(initial, [started]) })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 1 })
  expect(useUI.getState().timer).toBeNull()
  const completed = event(2, 'complete', at)
  const completion = packet(initial, [completed])
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ done: true, at })
  const deadline = at + 90000
  expect(useUI.getState().timer).toMatchObject({ timerToken: completed.id, endsAt: deadline, forIdx: 0, forSet: 0 })
  expect(useUI.getState().timer.left).toBeGreaterThan(70)
  expect(useUI.getState().timer.left).toBeLessThanOrEqual(75)
  stop(); stop = bindWearBridge(); await settle()
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(useUI.getState().timer.endsAt).toBe(deadline)
  expect(latest().standaloneSync.receipts.some(r=>r.seq===2)).toBe(true)
  // Recreate the phone store from its committed archive, with a fresh bridge and UI timer.
  await runtime.fixture.flush()
  const archive = await runtime.fixture.saved()
  stop(); useUI.getState().stopRest()
  const reopened = createWorkoutStore({ projectId: 'demo-opengym', config: {}, client: null, remote: null,
    storage: fakeStorage({ [archive.ownerKey]: archive }), authFactory: () => ({ ready: Promise.resolve(null), stop() {} }),
    legacyReader: { read: async () => [] }, lifecycle: false })
  await runtime.fixture.attach(reopened); await reopened.getState().boot()
  stop = bindWearBridge(); await settle()
  await runtime.command({ nodeId: 'watch', command: completion })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 2 })
  expect(latest().standaloneSync.receipts.some(r=>r.seq===2)).toBe(true)
  expect(useUI.getState().timer?.endsAt).toBe(deadline)
})

it('publishes a phone rest and accepts its offline pause into the real persisted workout', async () => {
  useUI.getState().startRest(90, 0, { forSet: 0 })
  const phoneToken = useUI.getState().timer.timerToken
  await vi.waitFor(() => expect(latest()?.standalone?.runtime?.timer?.timerToken).toBe(phoneToken))
  const snapshot = latest()
  await runtime.command({ nodeId: 'watch', command: packet(snapshot, [event(1, 'pause', Date.now())]) })
  expect(plugin.reply.mock.calls.at(-1)[0].response).toMatchObject({ status: 'ok', seq: 1 })
  expect(useUI.getState().timer).toMatchObject({ timerToken: phoneToken, paused: true })
  expect(useStore.getState().S.active._wearStandaloneTimer.timer.paused).toBe(true)
  useUI.getState().resumeRest()
  await vi.waitFor(() => expect(latest().standalone.runtime.timer.paused).toBe(false))
  useUI.getState().stopRest()
  await vi.waitFor(() => expect(latest().standalone.runtime.timer).toBeNull())
})
