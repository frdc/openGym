import { planUnitJob } from './sync-jobs.js'
import { afterEach, expect, it } from 'vitest'
import { createSyncBridge } from './sync-bridge.js'
import { fakeStorage, fakeRemote, fixtureState } from './test-fixtures.js'
import { makeOwner, makeEnvelope } from './model.js'
import { encodeState, decodeState } from './codec.js'
import { createWorkoutStore } from '../../store/useStore.js'
const owner = makeOwner('demo-opengym', 'bulk'), guest = makeOwner(owner.projectId)
const control = { schemaVersion: 1, generation: 1, dataRevision: 0, unitVersion: 1, activeUnitJob: null, lastResetOpId: null }
const profile = s => ({ control, documents: encodeState(s, control).documents })
const source = () => fixtureState({ workouts: Array.from({ length: 15 }, (_, i) => ({ id: `large-${i}`, d: '2026-10-08', entries: [], note: String(i).padStart(2, '0') + 'n'.repeat(800000) })) })
const bridges = [], stores = []
afterEach(async () => { for (const b of bridges.splice(0)) await b.unbindAuth(); for (const s of stores.splice(0)) await s.getState().dispose() })
const bridgeFor = (storage, remote) => { const b = createSyncBridge({ storage, remote }); bridges.push(b); return b }
const bind = async b => { await b.bindAuth({ owner, user: { uid: owner.uid }, authEpoch: 1 }); await b.syncNow() }
it.each(['adoption', 'recovery', 'migration'])('bounds full %s source atomically and resumes interruptions without losing valid records', async kind => {
  const original = source(), envelope = makeEnvelope(owner, fixtureState())
  if (kind === 'recovery') envelope.recoveryCopies.push({ recoveryId: 'source', state: original, ownerKey: owner.ownerKey })
  const storage = fakeStorage(kind === 'adoption' ? { [guest.ownerKey]: makeEnvelope(guest, original) } : kind === 'recovery' ? { [owner.ownerKey]: envelope } : {})
  const remote = fakeRemote(profile(fixtureState())), part = remote.commitJobPart
  const ordinary = remote.commitOperation
  remote.commitOperation = async (o, op, ...args) => {
    if (new TextEncoder().encode(JSON.stringify(op.payloads)).length > 10 * 1024 * 1024) throw Object.assign(new Error('aggregate request limit'), { code: 'resource-exhausted' })
    return ordinary(o, op, ...args)
  }
  let interrupted = true, calls = 0
  remote.commitJobPart = async (...args) => { if (interrupted && ++calls >= 3) throw Object.assign(new Error('pause'), { code: 'permission-denied' }); return part(...args) }
  let b
  if (kind === 'migration') {
    let observed
    const s = createWorkoutStore({ projectId: owner.projectId, storage, client: null, config: {}, remote, lifecycle: false,
      legacyReader: { read: async () => [{ sourceId: 'known', state: original, ownerKey: owner.ownerKey, identityProvider: 'firebase' }] },
      authFactory: ({ onUser }) => { observed = onUser; return { ready: Promise.resolve(null), stop() {} } } })
    stores.push(s); await s.getState().boot(); await observed({ uid: owner.uid }); await s.getState().syncNow()
    await s.getState().dispose(); stores.splice(stores.indexOf(s), 1)
  } else {
    b = bridgeFor(storage, remote); await bind(b)
    expect(remote.transactions).toHaveLength(0)
    if (kind === 'adoption') await b.resolveAdoption('add'); else { await b.resolveRecovery('source', 'add'); await b.syncNow() }
    await b.unbindAuth()
  }
  const saved = await storage.read(owner.ownerKey)
  expect(saved.pendingOperations.length).toBe(0)
  expect(saved.pendingJobs).toHaveLength(1)
  const job = saved.pendingJobs[0]
  expect(job.sourceKind).toBe(kind)
  expect(job.source.workouts).toEqual(original.workouts)
  expect(job.parts.length).toBeGreaterThanOrEqual(15)
  expect(job.parts.every(p => p.paths.length <= 20 && JSON.stringify(p.paths.map(path => job.payloads[path])).length < 2000000)).toBe(true)
  expect(saved.state.workouts).toHaveLength(15)
  const id = job.jobId
  interrupted = false
  const reload = bridgeFor(storage, remote); await bind(reload)
  expect((await storage.read(owner.ownerKey)).pendingJobs).toEqual([])
  const received = decodeState((await remote.readProfileFromServer(owner)).documents).workouts
  expect(received.map(w => [w.id, w.note]).sort()).toEqual(original.workouts.map(w => [w.id, w.note]).sort())
  expect((await remote.readJobs(owner)).filter(j => j.jobId === id)).toHaveLength(1)
  expect((await storage.read(owner.ownerKey)).recoveryCopies.find(c => c.state?.workouts?.length === 15).state.workouts).toEqual(original.workouts)
  if (kind === 'adoption') expect((await storage.read(guest.ownerKey)).state).toEqual(original)
}, 90000)


it.each(['kg', 'lb'])('external declared %s is normalized once to a proven account version, with source preserved', async unit => {
  const external = fixtureState({ unit, targetW: 80, active: { id: 'running', entries: [] } })
  const destination = fixtureState({ unit: 'lb' }), higher = { ...control, unitVersion: 4 }
  const storage = fakeStorage({ [guest.ownerKey]: makeEnvelope(guest, external) })
  const remote = fakeRemote({ control: higher, documents: encodeState(destination, higher).documents })
  const b = bridgeFor(storage, remote); await bind(b); await b.resolveAdoption('add')
  const saved = await storage.read(owner.ownerKey)
  expect(saved.pendingJobs).toHaveLength(0)
  expect(decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(unit === 'kg' ? 176.4 : 80)
  expect(saved.state.unit).toBe('lb'); expect(saved.state.active.id).toBe('running')
  expect(saved.localMetadata.activeSessionToken).toBeTruthy()
  expect(saved.recoveryCopies[0].state).toEqual(external)
  await b.syncNow()
  expect((await storage.read(owner.ownerKey)).state.targetW).toBe(unit === 'kg' ? 176.4 : 80)
})
it('offline recovery waits for first proof and does not apply unrelated historic relabels to external values', async () => {
  const external = fixtureState({ targetW: 80 }), envelope = makeEnvelope(owner, fixtureState())
  envelope.recoveryCopies.push({ recoveryId: 'source', ownerKey: owner.ownerKey, state: external })
  const storage = fakeStorage({ [owner.ownerKey]: envelope })
  const higher = { ...control, unitVersion: 3 }
  const remote = fakeRemote({ control: higher, documents: encodeState(fixtureState({ unit: 'lb' }), higher).documents })
  const b = bridgeFor(storage, remote); await b.hydrate(owner); await b.resolveRecovery('source', 'add')
  expect((await storage.read(owner.ownerKey)).pendingJobs[0].generation).toBeNull()
  expect(remote.transactions).toHaveLength(0)
  await b.unbindAuth(); const reload = bridgeFor(storage, remote); await bind(reload)
  expect((await storage.read(owner.ownerKey)).pendingJobs).toHaveLength(0)
  expect(decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(176.4)
  expect((await storage.read(owner.ownerKey)).recoveryCopies[0].state).toEqual(external)
})
it('full source domain context preserves a downward history correction across bounded parts', async () => {
  const workout = { id: 'corrected', d: '2026-10-08', _ts: 1, entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }], target: { mode: 'reps' } }] }
  const destination = fixtureState({ workouts: [workout], exWeights: { '0025': { w: 80, d: workout.d } } })
  const correction = structuredClone(workout); correction._ts = 10; correction.note = 'x'.repeat(400000); correction.entries[0].sets[0].w = 40
  const external = fixtureState({ workouts: [correction], exWeights: { '0025': { w: 40, d: workout.d } } })
  const envelope = { ...makeEnvelope(owner, destination), lastConfirmedControl: control, recoveryCopies: [{ recoveryId: 'correction', ownerKey: owner.ownerKey, state: external }] }
  const storage = fakeStorage({ [owner.ownerKey]: envelope }), remote = fakeRemote(profile(destination))
  const b = bridgeFor(storage, remote); await bind(b); await b.resolveRecovery('correction', 'add'); await b.syncNow()
  expect((await remote.readJobs(owner))[0].totalParts).toBeGreaterThan(1)
  const received = decodeState((await remote.readProfileFromServer(owner)).documents)
  expect(received.workouts[0].entries[0].sets[0].w).toBe(40)
  expect(received.exWeights['0025'].w).toBe(40)
})


it('resumes two lost part acknowledgements with stable job identity and then sends independent later work', async () => {
  const external = fixtureState({ workouts: Array.from({length:41},(_,i)=>({id:`w${i}`,d:'2026-10-08',entries:[]})) })
  const storage=fakeStorage({[guest.ownerKey]:makeEnvelope(guest,external)}), remote=fakeRemote(profile(fixtureState()))
  const commit=remote.commitJobPart;let stopAt=2,calls=0
  remote.commitJobPart=async(...args)=>{const result=await commit(...args);if(++calls>=stopAt)throw Object.assign(new Error('lost ACK'),{code:'permission-denied'});return result}
  let b=bridgeFor(storage,remote);await bind(b);await b.resolveAdoption('add')
  let saved=await storage.read(owner.ownerKey);const id=saved.pendingJobs[0].jobId
  const next={...saved.state,bodyweight:[{d:'2026-10-08',w:83.2,t:100}]}
  await b.recordChange({previous:saved.state,next,scheduleRemote:false});await b.unbindAuth()
  stopAt=calls+2;b=bridgeFor(storage,remote);await bind(b)
  saved=await storage.read(owner.ownerKey);expect(saved.pendingJobs[0].jobId).toBe(id);expect(saved.state.workouts).toHaveLength(41)
  await b.unbindAuth();remote.commitJobPart=commit;b=bridgeFor(storage,remote);await bind(b)
  saved=await storage.read(owner.ownerKey);expect(saved.pendingJobs).toHaveLength(0);expect(saved.pendingOperations).toHaveLength(0)
  const received=decodeState((await remote.readProfileFromServer(owner)).documents)
  expect(received.workouts).toHaveLength(41);expect(received.bodyweight[0].w).toBe(83.2)
  expect(remote.transactions.filter(t=>t.kind==='part').map(t=>`${t.jobId}:${t.partId}`)).toEqual([...new Set(remote.transactions.filter(t=>t.kind==='part').map(t=>`${t.jobId}:${t.partId}`))])
})
it.each([false,true])('proven queued source follows account unit history only before manifest start (started=%s)',async started=>{
  const external=fixtureState({targetW:80}), envelope={...makeEnvelope(owner,fixtureState()),lastConfirmedControl:control,recoveryCopies:[{recoveryId:'source',ownerKey:owner.ownerKey,state:external}]}
  const storage=fakeStorage({[owner.ownerKey]:envelope}),remote=fakeRemote(profile(fixtureState()))
  const b=bridgeFor(storage,remote);await b.hydrate(owner);await b.resolveRecovery('source','add')
  const pending=(await storage.read(owner.ownerKey)).pendingJobs[0]
  if(started)await remote.beginJob(owner,pending)
  const unit=planUnitJob({profile:await remote.readProfileFromServer(owner),ownerKey:owner.ownerKey,to:'lb',opId:'account-unit'})
  await remote.beginJob(owner,unit);for(const part of unit.parts)await remote.commitJobPart(owner,unit,part);await remote.finishJob(owner,unit)
  await b.unbindAuth();const reload=bridgeFor(storage,remote);let status;reload.subscribeStatus(s=>{status=s});await bind(reload)
  const saved=await storage.read(owner.ownerKey)
  expect(saved.recoveryCopies[0].state).toEqual(external)
  if(started){expect(saved.pendingJobs[0].jobId).toBe(pending.jobId);expect(status).toMatchObject({cloud:'blocked',cloudError:{code:'unit-version-mismatch'}})}
  else {expect(saved.pendingJobs).toHaveLength(0);expect(decodeState((await remote.readProfileFromServer(owner)).documents).targetW).toBe(176.4);await reload.syncNow();expect((await storage.read(owner.ownerKey)).state.targetW).toBe(176.4)}
})
it('a sealed bulk source is recovered after account reset rather than retargeted to the new generation',async()=>{
  const external=fixtureState({targetW:80}),envelope={...makeEnvelope(owner,fixtureState()),lastConfirmedControl:control,recoveryCopies:[{recoveryId:'source',ownerKey:owner.ownerKey,state:external}]}
  const storage=fakeStorage({[owner.ownerKey]:envelope}),remote=fakeRemote(profile(fixtureState())),b=bridgeFor(storage,remote)
  await b.hydrate(owner);await b.resolveRecovery('source','add');const id=(await storage.read(owner.ownerKey)).pendingJobs[0].jobId
  await remote.commitReset(owner,{opId:'other-reset',baseGeneration:1,nextGeneration:2});await bind(b)
  const saved=await storage.read(owner.ownerKey)
  expect(saved.pendingJobs).toHaveLength(0);expect(saved.recoveryCopies.some(c=>c.pendingJobs?.some(j=>j.jobId===id))).toBe(true)
  expect(remote.transactions.filter(t=>t.kind==='part')).toHaveLength(0)
})
it('Keep queues no bulk source and failed atomic Add does not record a decision',async()=>{
  const external=fixtureState({targetW:80}),storage=fakeStorage({[guest.ownerKey]:makeEnvelope(guest,external)}),remote=fakeRemote(profile(fixtureState())),b=bridgeFor(storage,remote)
  await bind(b);storage.failNextCommit(Object.assign(new Error('quota'),{code:'storage-full'}))
  await expect(b.resolveAdoption('add')).rejects.toMatchObject({code:'storage-full'})
  expect((await storage.read(owner.ownerKey)).adoptionDecision.status).toBe('pending')
  expect(remote.transactions).toHaveLength(0)
  await b.resolveAdoption('keep');expect((await storage.read(owner.ownerKey)).pendingJobs).toHaveLength(0)
  expect(remote.transactions).toHaveLength(0);expect((await storage.read(guest.ownerKey)).state).toEqual(external)
})

it('late bulk ACK stays with its captured owner and cannot publish into the next account',async()=>{
  const external=fixtureState({targetW:80}),storage=fakeStorage({[guest.ownerKey]:makeEnvelope(guest,external)}),remote=fakeRemote(profile(fixtureState()))
  let release,entered;const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r}),commit=remote.commitJobPart
  remote.commitJobPart=async(...args)=>{const result=await commit(...args);entered();await gate;return result}
  const b=bridgeFor(storage,remote);await bind(b);const adding=b.resolveAdoption('add');await ready
  const other=makeOwner(owner.projectId,'other');await b.hydrate(other)
  release();await adding
  expect((await storage.read(owner.ownerKey)).pendingJobs).toHaveLength(1)
  expect((await storage.read(other.ownerKey))?.state.targetW ?? fixtureState().targetW).toBe(fixtureState().targetW)
  await b.unbindAuth();remote.commitJobPart=commit;const reload=bridgeFor(storage,remote);await bind(reload)
  expect((await storage.read(owner.ownerKey)).pendingJobs).toHaveLength(0)
})
it('known migration admission and seeded marker never become durable without their source job',async()=>{
  const external=fixtureState({workouts:[{d:'2026-10-08',start:5,entries:[]}]}),storage=fakeStorage(),commit=storage.commit,observed=[]
  storage.commit=(key,reducer)=>commit(key,current=>{
    const next=reducer(current)
    if(key===owner.ownerKey && next.recoveryCopies.some(c=>c.status==='adopted')) {
      const copy=next.recoveryCopies.find(c=>c.status==='adopted')
      observed.push({seeded:next.localMetadata.seededRecoveryIds.includes(copy.recoveryId),jobs:next.pendingJobs.length})
      expect(next.localMetadata.seededRecoveryIds).toContain(copy.recoveryId)
      expect(next.pendingJobs.some(j=>j.sourceKind==='migration')).toBe(true)
    }
    return next
  })
  let accept
  const store=createWorkoutStore({projectId:owner.projectId,storage,client:null,config:{},lifecycle:false,remote:null,
    legacyReader:{read:async()=>[{sourceId:'known-atomic',state:external,identityProvider:'firebase',ownerKey:owner.ownerKey}]},
    authFactory:({onUser})=>{accept=onUser;return{ready:Promise.resolve(null),stop(){}}}})
  stores.push(store);await store.getState().boot();await accept({uid:owner.uid})
  const saved=await storage.read(owner.ownerKey)
  expect(observed.length).toBeGreaterThan(0);expect(saved.state.workouts[0].id).toMatch(/^legacy-/)
  expect(saved.recoveryCopies.find(c=>c.status==='adopted').state).toEqual(external)
})
