import { it, expect, vi } from 'vitest'
import { createWearHeartSession } from './wear-heart-session.js'
import { projectStandalone, applyStandalone } from './wear-standalone.js'
it('restores validated offline capture bindings after restart and receives delayed measurements', async () => {
  const f = fixture()
  f.store.S.unit = 'kg'; f.store.S.restSec = 60
  f.store.S.active.entries[0].id = '0025'
  f.store.S.active.entries[0].sets.forEach(s => { s.r = 8; s.w = 30 })
  const token = '00000000-0000-4000-8000-000000000001'
  const events = [{ seq: 1, id: token, action: 'start', at: 1000, step: 0, heart: true }, { seq: 2, id: '00000000-0000-4000-8000-000000000002', action: 'complete', at: 2000, step: 0 }]
  f.store.S = applyStandalone(f.store.S, { v: 1, action: 'standalone-sync', contextToken: 's', streamId: 'stream', baseline: projectStandalone(f.store.S, 's').baseline, requestId: events[1].id, events }, 's')
  f.store.S.active._wearStandalone.nodeId = 'watch'
  await f.host.reconcile()
  expect(f.host.authorizedTokens()).toContain(token)
  await f.host.receive({ v: 1, requestId: 'measurement', token, measurement: { startedAt: 1000, effortEndMs: 1000, recoveryEndMs: 31000, endReason: 'next-set', points: [[0, 100], [1000, 150], [31000, 120]] } }, 'watch')
  expect(f.store.S.active.entries[0].sets[0].heartRate.effort.peak).toBe(150)
  expect(JSON.stringify(f.store.S.active.entries[0].sets[0].heartRate)).not.toContain(token)
})
it('retries a failed offline binding write before authorizing acknowledgment', async () => {
  const f = fixture(), token = '00000000-0000-4000-8000-000000000001'
  f.store.S.active.entries[0].sets[0].heartRate = { startedAt: 1000, points: [] }
  f.store.S.active._wearStandalone = { sessionId: 's', nodeId: 'watch', hearts: { [token]: { target: { entryIdx: 0, setIdx: 0 }, startedAt: 1000, effortEndMs: null } } }
  f.plugin.saveHeartBindings.mockRejectedValueOnce(new Error('disk-full'))
  await expect(f.host.adoptStandalone()).rejects.toThrow('disk-full')
  expect((await f.plugin.getHeartBindings()).bindings[token]).toBeUndefined()
  await f.host.adoptStandalone()
  expect((await f.plugin.getHeartBindings()).bindings[token]).toMatchObject({ startedAt: 1000, nodeId: 'watch' })
})
function fixture(initial={}) {
  const store={ownerKey:'a',localReady:true,activeSessionToken:'s',S:{active:{id:'w',entries:[{sets:[{done:false},{done:false}]}]},workouts:[]},flushLocal:vi.fn(async()=>{}),update(fn){const next=structuredClone(this.S);fn(next);this.S=next}}
  let journal=initial
  const plugin={getHeartBindings:async()=>({bindings:structuredClone(journal)}),saveHeartBindings:vi.fn(async({bindings})=>{journal=structuredClone(bindings)})}
  const host=createWearHeartSession({getStore:()=>store,plugin})
  const command={action:'heart-start',contextToken:'c',requestId:'start',startedAt:Date.now(),target:{entryIdx:0,setIdx:0}}
  const packet=()=>({v:1,requestId:'p',token:host.projection().token,measurement:{startedAt:command.startedAt,effortEndMs:1000,recoveryEndMs:31000,endReason:'next-set',points:[[0,100],[1000,150],[31000,120]]}})
  return {store,host,command,packet,plugin}
}
it('deduplicates start, binds moved rows and preserves finalized history',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');await f.host.handle(f.command,'watch')
  const p=f.packet();expect(f.plugin.saveHeartBindings.mock.calls.at(-1)[0].bindings).toHaveProperty(p.token)
  f.store.S.active.entries[0].sets.reverse()
  await f.host.complete({...f.command,target:{entryIdx:0,setIdx:1},heartElapsedMs:1000},'watch')
  f.store.S.active.entries[0].sets[1].done=true
  f.store.S.workouts.push(f.store.S.active);f.store.S.active=null;f.store.activeSessionToken=null
  await f.host.receive(p,'watch')
  const m=f.store.S.workouts[0].entries[0].sets[1].heartRate
  expect(m.effort.peak).toBe(150);expect(JSON.stringify(m)).not.toContain(p.token)
})
it('refuses deleted rows and packets from another node',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  await expect(f.host.receive(p,'other')).rejects.toThrow('stale-target')
  f.store.S.active.entries[0].sets.shift()
  await expect(f.host.receive(p,'watch')).rejects.toThrow('stale-target')
})
it('does not acknowledge when owner changes during durable flush',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  f.store.flushLocal=async()=>{f.store.ownerKey='b'}
  await expect(f.host.receive(p,'watch')).rejects.toThrow('stale-context')
})
it('does not regress final measurements on stale incremental replay',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  await f.host.receive(p,'watch');await f.host.receive({...p,measurement:{...p.measurement,recoveryEndMs:null,points:[[0,90]]}},'watch')
  expect(f.store.S.active.entries[0].sets[0].heartRate.recoveryEndMs).toBe(31000)
})
it('rejects fabricated summaries inconsistent with plotted readings',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  p.measurement.effort={count:1,mean:20,peak:20}
  await expect(f.host.receive(p,'watch')).rejects.toThrow('invalid-heart-summary')
})
it('restores an earlier measurement when a repeat mark is cancelled',async()=>{
  const f=fixture();const previous={v:1,startedAt:1,points:[[0,90]],status:'complete'}
  f.store.S.active.entries[0].sets[0].heartRate=previous
  await f.host.handle(f.command,'watch')
  await f.host.handle({...f.command,requestId:'cancel',action:'heart-cancel'},'watch')
  expect(f.store.S.active.entries[0].sets[0].heartRate).toEqual(previous)
})
it('does not repeatedly save invalidated rows on reconciliation',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');f.store.S.active.entries=[]
  await f.host.reconcile();const n=f.plugin.saveHeartBindings.mock.calls.length
  await f.host.reconcile();expect(f.plugin.saveHeartBindings.mock.calls.length).toBe(n)
})
it('retains recent final retry bindings and prunes oldest closed records at the limit',async()=>{
  const initial=Object.fromEntries(Array.from({length:200},(_,i)=>[`t${i}`,{startedAt:i+1,closed:true,sessionId:'old',workoutId:'old',nodeId:'watch'}]))
  const f=fixture(initial);await f.host.handle(f.command,'watch')
  const bindings=f.plugin.saveHeartBindings.mock.calls.at(-1)[0].bindings
  expect(Object.keys(bindings)).toHaveLength(200);expect(bindings.t0).toBeUndefined();expect(bindings.t199).toBeDefined()
})
it('loads final bindings after restart and attaches delayed final measurements',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  const journal=f.plugin.saveHeartBindings.mock.calls.at(-1)[0].bindings
  const restarted=createWearHeartSession({getStore:()=>f.store,plugin:{getHeartBindings:async()=>({bindings:journal}),saveHeartBindings:async()=>{}}})
  f.store.S.active.entries[0].sets[0].done=true;f.store.S.active.end=f.command.startedAt+31000;f.store.S.workouts.push(f.store.S.active);f.store.S.active=null;f.store.activeSessionToken=null
  await f.host.complete({...f.command,heartElapsedMs:1000},'watch')
  await restarted.reconcile();await restarted.receive(p,'watch')
  expect(f.store.S.workouts[0].entries[0].sets[0].heartRate.recoveryEndMs).toBe(31000)
})
it('keeps next-start boundaries authoritative against delayed final packets',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  await f.host.complete({...f.command,heartElapsedMs:1000},'watch');f.store.S.active.entries[0].sets[0].done=true
  await f.host.handle({...f.command,requestId:'next',startedAt:f.command.startedAt+20000,target:{entryIdx:0,setIdx:1}},'watch')
  await f.host.receive(p,'watch')
  const m=f.store.S.active.entries[0].sets[0].heartRate
  expect(m.recoveryEndMs).toBe(20000);expect(m.endReason).toBe('next-set');expect(m.points.every(p=>p[0]<=20000)).toBe(true);expect(m.milestones).toEqual([])
})
it('does not shrink finals or overwrite already measured sample timestamps',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet();await f.host.receive(p,'watch')
  await f.host.receive({...p,requestId:'older',measurement:{...p.measurement,recoveryEndMs:21000,points:[[0,80]]}},'watch')
  const m=f.store.S.active.entries[0].sets[0].heartRate
  expect(m.recoveryEndMs).toBe(31000);expect(m.points[0]).toEqual([0,100])
})
it('retains effort when ordinary completion fails or does not mark the bound row',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch')
  await expect(f.host.complete({...f.command,heartElapsedMs:1000},'watch',()=>{throw new Error('blocked')})).rejects.toThrow('blocked')
  expect(f.host.projection().phase).toBe('effort')
  await expect(f.host.complete({...f.command,heartElapsedMs:1000},'watch',()=>{})).rejects.toThrow('completion-unconfirmed')
  expect(f.host.projection().phase).toBe('effort')
})
it('closes interrupted effort with no completion timestamp and permits ordinary logging',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  await f.host.receive({...p,measurement:{...p.measurement,effortEndMs:null,endReason:'interrupted'}},'watch')
  expect(f.host.projection()).toBeNull()
  const complete=vi.fn(()=>{f.store.S.active.entries[0].sets[0].done=true})
  await f.host.complete(f.command,'watch',complete)
  expect(complete).toHaveBeenCalledOnce()
})
it('uses full effort aggregates when a disabled effort gains samples before final delivery',async()=>{
  const f=fixture();await f.host.handle(f.command,'watch');const p=f.packet()
  await f.host.receive({...p,requestId:'incremental',measurement:{startedAt:f.command.startedAt,effortEndMs:null,recoveryEndMs:null,points:[[0,100]],effort:{count:1,mean:100,peak:100}}},'watch')
  await f.host.receive({...p,measurement:{startedAt:f.command.startedAt,effortEndMs:null,recoveryEndMs:1000,endReason:'disabled',points:[[0,100],[1000,150]],effort:{count:2,mean:125,peak:150}}},'watch')
  expect(f.store.S.active.entries[0].sets[0].heartRate.effort).toEqual({count:2,mean:125,peak:150})
  expect(f.host.projection()).toBeNull()
})
