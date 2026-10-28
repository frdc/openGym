import { buildHeartRate } from './heart-rate.js'
const fail = code => { throw Object.assign(new Error(code), { code }) }
const rowAt = (S,t) => { const row=S.active?.entries?.[t?.entryIdx]?.sets?.[t?.setIdx]; return t?.side?row?.sides?.[t.side]:row }
function locate(S,b) {
  const matches=w=>w?.id===b.workoutId && (b.workoutStart==null || w.start===b.workoutStart)
  const workouts = [...(matches(S.active)?[S.active]:[]),...(S.workouts||[]).filter(matches)]
  for (const w of workouts) for (const e of w.entries||[]) for (const row of e.sets||[]) for (const set of [row,row.sides?.L,row.sides?.R]) if (set?.heartRate?.startedAt===b.startedAt) return set
  return null
}
export function createWearHeartSession({getStore,plugin,changed=()=>{}}) {
  let owner=null, bindings={}, disposed=false, chain=Promise.resolve(), standaloneDirty=false
  const results=new Map()
  const serial = fn => { const run=chain.then(fn); chain=run.catch(()=>{}); return run }
  const check = key => { if(disposed || !getStore().localReady || getStore().ownerKey!==key) fail('stale-context');if(getStore().authReady===false) fail('unavailable') }
  async function load() {
    const s=getStore(); check(s.ownerKey)
    if(owner!==s.ownerKey) { const key=s.ownerKey; const saved=await plugin.getHeartBindings({ownerKey:key}); check(key); owner=key; bindings=structuredClone(saved.bindings||{}); standaloneDirty=false; results.clear() }
    return owner
  }
  async function save(key) { check(key); await plugin.saveHeartBindings({ownerKey:key,bindings:structuredClone(bindings)}); check(key) }
  async function write(key,b,m) { check(key); if(!locate(getStore().S,b)) fail('stale-target'); getStore().update(S=>{const row=locate(S,b); if(row) row.heartRate=m}); await getStore().flushLocal(); check(key) }
  const capture = () => Object.entries(bindings).find(([,b])=>b.sessionId===getStore().activeSessionToken && !b.closed)
  async function close(key,b,m,end,reason) {
    b.closed=true;b.recoveryEndMs=end;b.endReason=reason
    const trimmed=(m.points||[]).some(p=>p[0]>end)
    await write(key,b,buildHeartRate({...m,effortEndMs:b.effortEndMs??m.effortEndMs,recoveryEndMs:end,endReason:reason,partial:trimmed||m.partial||m.status==='partial',...(trimmed?{effort:null,recovery:null}:{} )}))
  }
  async function adoptCheckpoint(key,checkpoint,workoutId,workoutStart,onlyToken=null) {
    const s=getStore()
    if(!checkpoint?.nodeId) return
    const workouts=[s.S.active,...(s.S.workouts||[])].filter(w=>w?.id===workoutId && (workoutStart==null || w.start===workoutStart))
    if(workouts.length!==1) return
    const workout=workouts[0]
    let dirty=false
    for(const [token,record] of Object.entries(checkpoint.hearts||{})) {
      if(onlyToken && onlyToken!==token) continue
      const target=record.target
      const entries=target.entryLogId ? workout.entries.filter(e=>e.logId===target.entryLogId) : [workout.entries[target.entryIdx]]
      const rows=entries.length===1 ? target.setLogId ? entries[0]?.sets?.filter(r=>r.logId===target.setLogId) : [entries[0]?.sets?.[target.setIdx]] : []
      const parent=rows?.length===1 ? rows[0] : null, row=target.side?parent?.sides?.[target.side]:parent, previous=bindings[token]
      if(!record.invalid && row?.heartRate?.startedAt!==record.startedAt) continue
      if(previous && (previous.nodeId!==checkpoint.nodeId || previous.sessionId!==checkpoint.sessionId || previous.startedAt!==record.startedAt)) fail('stale-target')
      // Completed captures can reconstruct a retired retry binding on demand.
      // Do not fill the native journal again on every historical reconciliation.
      if(!previous && !onlyToken && ['complete','empty'].includes(row?.heartRate?.status)) continue
      if(!previous && Object.keys(bindings).length>=200) fail('heart-queue-full')
      const next={...previous,startedAt:record.startedAt,sessionId:checkpoint.sessionId,workoutId,workoutStart,nodeId:checkpoint.nodeId,contextToken:checkpoint.sessionId,phase:record.effortEndMs==null?'effort':'recovery',effortEndMs:record.effortEndMs,closed:!!record.closed||!!previous?.closed,invalid:!!record.invalid||!!previous?.invalid,...(record.recoveryEndMs!=null?{recoveryEndMs:record.recoveryEndMs,endReason:record.endReason}:{})}
      if(row?.heartRate?.recoveryEndMs!=null && (next.recoveryEndMs==null || row.heartRate.recoveryEndMs<=next.recoveryEndMs)) {
        next.closed=true;next.recoveryEndMs=row.heartRate.recoveryEndMs;next.endReason=row.heartRate.endReason
      }
      if(JSON.stringify(next)!==JSON.stringify(previous)) { bindings[token]=next;dirty=true }
    }
    if(dirty) standaloneDirty=true
    if(standaloneDirty) { await save(key);standaloneDirty=false }
  }
  async function adoptStandalone(key,onlyToken=null) {
    const s=getStore(), checkpoint=s.S.active?._wearStandalone
    if(checkpoint?.sessionId===s.activeSessionToken) await adoptCheckpoint(key,checkpoint,s.S.active.id,s.S.active.start,onlyToken)
    for(const session of Object.values(s.wearSessions||{})) for(const record of Object.values(session.records||{}))
      if(record.checkpoint) await adoptCheckpoint(key,record.checkpoint,session.workoutId,session.start,onlyToken)
  }
  async function reconcileNow() {
    if(!getStore().localReady || getStore().authReady===false || !plugin.getHeartBindings) return
    const key=await load()
    await adoptStandalone(key)
    let dirty=false
    for(const b of Object.values(bindings)) {
      const row=locate(getStore().S,b)
      if(!row) { if(!b.invalid || !b.closed) {b.invalid=true;b.closed=true;dirty=true} continue }
      if(b.sessionId!==getStore().activeSessionToken && !b.closed && !getStore().wearSessions?.[b.sessionId]) {
        b.closed=true;dirty=true
        const m=row.heartRate
        b.effortEndMs=m.effortEndMs??Math.max(0,Date.now()-b.startedAt)
        const workout=getStore().S.workouts?.find(w=>w.id===b.workoutId)
        await close(key,b,{...m,partial:true},Math.max(b.effortEndMs,(workout?.end||Date.now())-b.startedAt),'workout-ended')
      } else if(!b.closed && row.done && b.phase==='effort') { b.phase='recovery';b.effortEndMs=Math.max(0,(row.at||Date.now())-b.startedAt);dirty=true;await write(key,b,buildHeartRate({...row.heartRate,effortEndMs:b.effortEndMs})) }
    }
    if(dirty) await save(key)
    if(dirty) changed()
  }
  return {
    result(command,nodeId) { return owner===getStore().ownerKey ? results.get(`${nodeId}:${command.contextToken}:${command.requestId}`) : null },
    authorizedTokens() { return owner===getStore().ownerKey ? Object.entries(bindings).filter(([,b])=>!b.invalid).map(([token])=>token) : [] },
    adoptStandalone() { return serial(async()=>{ if(plugin.getHeartBindings) await adoptStandalone(await load()) }) },
    adoptCheckpoint(checkpoint,workoutId,workoutStart) { return serial(async()=>{ if(plugin.getHeartBindings) await adoptCheckpoint(await load(),checkpoint,workoutId,workoutStart) }) },
    projection() { if(owner!==getStore().ownerKey) return null; const c=capture(); return c?{token:c[0],startedAt:c[1].startedAt,phase:c[1].phase,effortEndMs:c[1].effortEndMs??null}:null },
    handle(command,nodeId) { return serial(async()=>{
      const key=await load(), request=`${nodeId}:${command.contextToken}:${command.requestId}`
      if(results.has(request)) return results.get(request)
      results.set(request,{status:'error',code:'unconfirmed'})
      const s=getStore(), current=capture()
      if(command.action==='heart-cancel') {
        if(!current || current[1].nodeId!==nodeId) fail('stale-target')
        const b=current[1];b.closed=true
        const row=locate(s.S,b)
        if(row && !row.done) {b.invalid=true;s.update(S=>{const r=locate(S,b);if(r) {if(b.previousHeartRate) r.heartRate=b.previousHeartRate;else delete r.heartRate}});await s.flushLocal();check(key)}
        else if(row) await close(key,b,{...row.heartRate,partial:true},Math.max(b.effortEndMs||0,Date.now()-b.startedAt),'disabled')
      } else {
        if(!Number.isFinite(command.startedAt)||command.startedAt<=0 || Math.abs(Date.now()-command.startedAt)>300000) fail('invalid-command')
        if(current?.[1].phase==='effort') fail('capture-active')
        const row=rowAt(s.S,command.target);if(!row || row.done) fail('stale-target')
        if(Object.values(bindings).some(b=>b.workoutId===s.S.active.id&&b.startedAt===command.startedAt)) fail('duplicate-start')
        if(Object.keys(bindings).length>=200) {
          const retired=Object.entries(bindings).filter(([,b])=>b.closed||b.invalid).sort((a,b)=>a[1].startedAt-b[1].startedAt)[0]
          if(!retired) fail('heart-queue-full')
          delete bindings[retired[0]]
        }
        if(current) {const b=current[1], old=locate(s.S,b); if(old) await close(key,b,old.heartRate,Math.max(b.effortEndMs||0,command.startedAt-b.startedAt),'next-set')}
        const token=crypto.randomUUID(), b={startedAt:command.startedAt,sessionId:s.activeSessionToken,workoutId:s.S.active.id,workoutStart:s.S.active.start,nodeId,contextToken:command.contextToken,phase:'effort',effortEndMs:null,...(row.heartRate?{previousHeartRate:structuredClone(row.heartRate)}:{})}
        bindings[token]=b
        // A durable private binding precedes publication of its public marker.
        await save(key);s.update(S=>{rowAt(S,command.target).heartRate=buildHeartRate({startedAt:b.startedAt})});await s.flushLocal();check(key)
      }
      await save(key);changed();const response={status:'ok'};results.set(request,response);return response
    }) },
    complete(command,nodeId,completeCurrent) { return serial(async()=>{
      if(!plugin.getHeartBindings) return completeCurrent?.()
      const key=await load(), c=capture();if(!c || c[1].phase!=='effort') return completeCurrent?.()
      const b=c[1], row=locate(getStore().S,b)
      if(b.nodeId!==nodeId || row!==rowAt(getStore().S,command.target)) fail('stale-target')
      if(!Number.isFinite(command.heartElapsedMs)||command.heartElapsedMs<0) fail('invalid-command')
      await completeCurrent?.();check(key)
      if(completeCurrent && !locate(getStore().S,b)?.done) fail('completion-unconfirmed')
      b.phase='recovery';b.effortEndMs=command.heartElapsedMs;delete b.previousHeartRate
      await write(key,b,buildHeartRate({...row.heartRate,effortEndMs:b.effortEndMs}));await save(key);changed()
    }) },
    receive(packet,nodeId) { return serial(async()=>{
      const key=await load()
      if(!packet || packet.v!==1 || typeof packet.requestId!=='string' || packet.requestId.length>100 || new TextEncoder().encode(JSON.stringify(packet)).length>16384) fail('invalid-packet')
      if(!bindings[packet.token]) await adoptStandalone(key,packet.token)
      const b=bindings[packet.token], input=packet.measurement
      if(!b || b.invalid || b.nodeId!==nodeId || !input || input.startedAt!==b.startedAt || !Array.isArray(input.points) || input.points.length>300) fail('stale-target')
      const row=locate(getStore().S,b);if(!row) fail('stale-target')
      const old=row.heartRate
      const ack={v:1,requestId:packet.requestId,status:'ok',token:packet.token}
      if(b.receipts?.includes(packet.requestId)) return ack
      const incomingEnd=Number.isFinite(input.recoveryEndMs)?input.recoveryEndMs:null
      if(b.lastPacketEnd!=null && (incomingEnd===null || incomingEnd<b.lastPacketEnd)) return ack
      const recoveryEndMs=b.recoveryEndMs??incomingEnd
      const stoppedEffort=b.effortEndMs==null && input.effortEndMs==null && incomingEnd!=null && ['disabled','interrupted','workout-ended'].includes(input.endReason)
      const effortEndMs=b.effortEndMs??(stoppedEffort?incomingEnd:input.effortEndMs)
      const clipped=recoveryEndMs!=null && (incomingEnd>recoveryEndMs || input.points.some(p=>p[0]>recoveryEndMs))
      const sameBoundary=input.effortEndMs===effortEndMs && (incomingEnd===recoveryEndMs || recoveryEndMs===null)
      if(['effort','recovery'].some(phase=>input[phase] && old[phase] && input[phase].count<old[phase].count)) return ack
      const points=[...new Map([...input.points,...(old.points||[])].map(p=>[p[0],p])).values()]
      const recovery= sameBoundary ? input.recovery : clipped ? null : points.filter(p=>p[0]>effortEndMs&&p[0]<=recoveryEndMs).length<=(old.recovery?.count||0) ? old.recovery : null
      const m=buildHeartRate({...input,effortEndMs,recoveryEndMs,endReason:b.endReason??input.endReason,points,partial:!!input.partial||clipped,effort:input.effortEndMs===effortEndMs||stoppedEffort?input.effort:old.effort,recovery,milestones:sameBoundary?input.milestones:old.milestones})
      await write(key,b,m)
      if(stoppedEffort) b.effortEndMs=effortEndMs
      b.lastPacketEnd=incomingEnd??b.lastPacketEnd
      b.receipts=[...(b.receipts||[]),packet.requestId].slice(-32)
      if(m.recoveryEndMs!==null) b.closed=true
      await save(key);changed()
      return {v:1,requestId:packet.requestId,status:'ok',token:packet.token}
    }) },
    reconcile() {return serial(reconcileNow)},
    dispose() {disposed=true;bindings={};results.clear()},
  }
}
