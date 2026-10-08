import { planUnitJob, createJob, resumeUnitPlan } from '../src/lib/cloud/sync-jobs.js'
// Destructive tests are restricted to the disposable, explicitly configured demo emulators.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { initializeApp, deleteApp } from 'firebase/app'
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth'
import * as sdk from 'firebase/firestore'
import * as codec from '../src/lib/cloud/codec.js'
import { createFirestorePort } from '../src/lib/cloud/firestore-port.js'
import { makeOwner } from '../src/lib/cloud/model.js'
import { DEF } from '../src/store/state-defaults.js'
import { stampChange } from '../src/lib/sync-merge.js'

const projectId = 'demo-opengym'
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Run through firebase emulators:exec --project demo-opengym')
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8081', 'Firestore must be loopback demo port')
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099', 'Auth must be loopback demo port')
const require = createRequire(import.meta.url)
const firestoreRequire = createRequire(require.resolve('@firebase/firestore'))
assert.equal(firestoreRequire('@grpc/grpc-js/package.json').version, '1.13.6')
const clients = [], stops = []
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const context = profile => ({ expectedControl: profile.control, domainContext: { remoteProfile: profile, remoteState: codec.decodeState(profile.documents, { generation: profile.control.generation }) } })
const denied = async (fn, label) => { await assert.rejects(fn, e => e.code === 'permission-denied'); pass(label) }
const deadline = (promise, label) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout:${label}`)), 15000) })]).finally(() => clearTimeout(timer))
}
async function client(label, authenticated) {
  const app = initializeApp({ projectId, apiKey: 'demo-key', appId: 'demo-app' }, `rules-${label}-${randomUUID()}`)
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() })
  sdk.connectFirestoreEmulator(db, '127.0.0.1', 8081)
  const value = { app, auth, db }; clients.push(value)
  if (authenticated) await createUserWithEmailAndPassword(auth, `${label}-${randomUUID()}@example.test`, `demo-${randomUUID()}`)
  return value
}
function changed(before, edit, owner, control, opId = randomUUID()) {
  const after = structuredClone(before); edit(after); after._ts = stampChange(before, after, Date.now())
  return codec.prepareOperation(before, after, { ownerKey: owner.ownerKey, generation: control.generation, unitVersion: control.unitVersion, kind: 'update', opId })
}
try {
  const a = await client('a', true), b = await client('b', true), guest = await client('guest', false)
  const ownerA = makeOwner(projectId, a.auth.currentUser.uid), ownerB = makeOwner(projectId, b.auth.currentUser.uid)
  const pathA = `users/${ownerA.uid}/apps/opengym`, pathB = `users/${ownerB.uid}/apps/opengym`
  const remote = createFirestorePort({ client: a }), remoteB = createFirestorePort({ client: b })
  let profile = await remote.readProfileFromServer(ownerA)
  assert.equal(profile.control.dataRevision, 0); assert.deepEqual(profile.documents, {})
  await remoteB.readProfileFromServer(ownerB)
  pass('authenticated users A/B initialize isolated control through server reads and transactions')
  await denied(() => sdk.getDocFromServer(sdk.doc(guest.db, pathA)), 'unauthenticated control read denied')
  await denied(() => sdk.setDoc(sdk.doc(guest.db, pathA), profile.control), 'unauthenticated write denied')
  await denied(() => sdk.getDocFromServer(sdk.doc(b.db, pathA)), 'cross-owner control read denied')
  await denied(() => sdk.setDoc(sdk.doc(b.db, pathA), { ...profile.control, dataRevision: 1 }), 'cross-owner control write denied')
  await denied(() => sdk.getDocsFromServer(sdk.collection(b.db, pathA + '/workouts')), 'cross-owner query denied')
  await denied(() => sdk.setDoc(sdk.doc(a.db, pathA), { ...profile.control, schemaVersion: 2, dataRevision: 1 }), 'unsupported control schema denied')
  await denied(() => sdk.setDoc(sdk.doc(a.db, pathA), { ...profile.control, dataRevision: -1 }), 'invalid control revision denied')
  await denied(() => sdk.setDoc(sdk.doc(a.db, pathA), { ...profile.control, dataRevision: 1, surprise: true }), 'extra control field denied')
  await denied(() => sdk.setDoc(sdk.doc(a.db, pathA), { ...profile.control, dataRevision: 1, generation: 4, lastResetOpId: 'bad-reset' }), 'generation jump denied')
  for (const legacy of ['', '/exercises/x', '/workouts/x', '/workoutSessions/x', '/medicines/x', '/medicineLogs/x']) await denied(() => sdk.setDoc(sdk.doc(a.db, `users/${ownerA.uid}${legacy}`), { test: true }), `legacy path ${legacy || 'user root'} denied by isolated fragment`)
  const observed = [], listening = new Promise((resolve, reject) => { stops.push(remote.watchControl(ownerA, control => { observed.push(control); if (control?.dataRevision === 1) resolve() }, reject)) })
  const initial = structuredClone(DEF)
  const operation = changed(initial, state => {
    state.workouts = [{ id: 'w1', d: '2026-10-07', start: 1, end: 100, entries: [{ id: '0025', sets: [{ w: 20, r: 5, done: true }], target: { mode: 'reps' } }] }]
    state.queue = { ids: ['r'] }
  }, ownerA, profile.control)
  const confirmation = await remote.commitOperation(ownerA, operation, context(profile))
  assert.equal(confirmation.control.dataRevision, 1)
  assert.deepEqual(Object.keys(confirmation.documents).sort(), ['exerciseState/MDAyNQ','plans/main','workouts/dzE'])
  await deadline(listening, 'control-listener'); pass('real transaction atomically commits workout, progression and plan; authenticated listener observes commit')
  const rows = await sdk.getDocsFromServer(sdk.query(sdk.collection(a.db, pathA + '/workouts'), sdk.where('generation', '==', 1)))
  assert.equal(rows.size, 1); assert.equal(rows.docs[0].data().payload.id, 'w1')
  profile = await createFirestorePort({ client: a }).readProfileFromServer(ownerA)
  assert.equal(codec.decodeState(profile.documents).workouts.length, 1); pass('server query and fresh complete profile read roundtrip codec-generated IDs')
  await assert.rejects(() => remote.commitOperation(ownerA, operation, context({ ...profile, control: { ...profile.control, dataRevision: 0 } })), e => e.code === 'refresh-required')
  pass('stale transaction revision requires fresh history')
  const replay = await remote.commitOperation(ownerA, operation, context(profile))
  assert.equal(replay.control.dataRevision, 1)
  assert.equal((await sdk.getDocsFromServer(sdk.collection(a.db, pathA + '/workouts'))).size, 1)
  pass('stable replay keeps one workout and does not advance revision')
  const record = profile.documents['workouts/dzE']
  await denied(() => sdk.setDoc(sdk.doc(a.db, pathA + '/workouts/dzE'), record), 'domain write without control revision increment denied')
  async function batchRecord(path, value, control = profile.control) {
    const batch = sdk.writeBatch(a.db)
    batch.set(sdk.doc(a.db, pathA), { ...control, dataRevision: control.dataRevision + 1 })
    batch.set(sdk.doc(a.db, pathA + '/' + path), value)
    await batch.commit()
  }
  await denied(() => batchRecord('workouts/dzE', { ...record, generation: 2 }), 'record generation inconsistent with getAfter control denied')
  await denied(() => batchRecord('workouts/dzE', { ...record, unitVersion: 2 }), 'record unit version mismatch denied')
  await denied(() => batchRecord('workouts/dzE', { ...record, schemaVersion: 2 }), 'unsupported record schema denied')
  await denied(() => batchRecord('workouts/dzE', { ...record, payload: [] }), 'invalid payload shape denied')
  await denied(() => batchRecord('workouts/dzE', { ...record, stamps: {} }), 'invalid stamp shape denied')
  await denied(() => batchRecord('workouts/dzE', { ...record, secret: 'extra' }), 'extra record field denied')
  await denied(() => batchRecord('settings/unit', { ...record, payload: { value: 'stone' } }), 'unsupported unit payload denied')
  await denied(() => batchRecord('settings/active', record), 'unallowlisted setting denied')
  await denied(() => batchRecord('unknown/x', record), 'unallowlisted collection denied')
  await denied(() => batchRecord('plans/other', record), 'unallowlisted singleton ID denied')
  await denied(() => sdk.setDoc(sdk.doc(b.db, pathA + '/workouts/dzE'), record), 'cross-owner domain write denied')
  const largeOp = structuredClone(operation); largeOp.opId = randomUUID(); largeOp.payloads['workouts/dzE'].payload.note = 'x'.repeat(930000)
  await assert.rejects(() => remote.commitOperation(ownerA, largeOp, context(profile)), e => e.code === 'document-too-large' && e.path === 'workouts/dzE')
  assert.equal((await sdk.getDocFromServer(sdk.doc(a.db, pathA))).data().dataRevision, 1)
  pass('900 KiB adapter guard preserves original local payload and performs no partial write')
  await assert.rejects(() => batchRecord('workouts/dzE', { ...record, payload: { ...record.payload, note: 'x'.repeat(1100000) } }), e => ['invalid-argument', 'resource-exhausted'].includes(e.code))
  pass('actual emulator backend rejects document above Firestore 1 MiB limit')
  // A multi-record operation exercises repeated get/getAfter rules checks within one atomic request.
  const beforeBulk = codec.decodeState(profile.documents), bulk = changed(beforeBulk, state => { state.routines = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `Routine ${i}`, ex: [] })) }, ownerA, profile.control)
  const bulkResult = await remote.commitOperation(ownerA, bulk, context(profile))
  assert.equal(bulkResult.control.dataRevision, 2)
  profile = await remote.readProfileFromServer(ownerA)
  assert.equal(codec.decodeState(profile.documents).routines.length, 20)
  pass('20 entities plus plan commit within actual emulator rules access budget')
  await sdk.disableNetwork(a.db)
  await assert.rejects(() => remote.readProfileFromServer(ownerA), e => ['unavailable', 'failed-precondition'].includes(e.code))
  await sdk.enableNetwork(a.db)
  profile = await deadline(remote.readProfileFromServer(ownerA), 'reconnected-read')
  const update = changed(codec.decodeState(profile.documents), s => { s.sound = false }, ownerA, profile.control)
  const updated = await remote.commitOperation(ownerA, update, context(profile))
  assert.equal(updated.control.dataRevision, 3)
  pass('disconnect refuses server confirmation; reconnect resumes authenticated read/update transaction')
  const reset = { opId: randomUUID(), baseGeneration: 1, nextGeneration: 2 }
  const resetControl = await remote.commitReset(ownerA, reset)
  assert.equal(resetControl.generation, 2)
  assert.deepEqual(await remote.commitReset(ownerA, reset), resetControl)
  await assert.rejects(() => remote.commitReset(ownerA, { ...reset, opId: randomUUID() }), e => e.code === 'generation-mismatch')
  profile = await remote.readProfileFromServer(ownerA)
  assert.deepEqual(profile.documents, {})
  await denied(() => batchRecord('workouts/dzE', record, profile.control), 'old-generation write denied after reset')
  const freshOp = changed(structuredClone(DEF), s => { s.workouts = [{ id: 'w1', d: '2026-10-08', entries: [] }] }, ownerA, profile.control)
  await remote.commitOperation(ownerA, freshOp, context(profile))
  assert.equal((await sdk.getDocFromServer(sdk.doc(a.db, pathA + '/workouts/dzE'))).data().generation, 2)
  pass('reset replay is stable and same ID can be safely reused in new generation')
  assert.equal((await sdk.getDocFromServer(sdk.doc(b.db, pathB))).data().dataRevision, 0)
  pass('user B profile remains unchanged')
  profile = await remote.readProfileFromServer(ownerA)
  const unitSource = changed(codec.decodeState(profile.documents), state => { state.exWeights = Object.fromEntries(Array.from({ length: 39 }, (_, i) => [`unit${i}`, 20.1])) }, ownerA, profile.control)
  // Ordinary transport's 40 checks above remain intact; job tests use bounded source preparation.
  await remote.commitOperation(ownerA, unitSource, context(profile))
  profile = await remote.readProfileFromServer(ownerA)
  const unitJob = planUnitJob({ profile, ownerKey: ownerA.ownerKey, to: 'lb', opId: randomUUID() })
  let initializationCalls = 0
  const interrupted = createFirestorePort({ client: a, sdk: { ...sdk, runTransaction(...args) {
    if (++initializationCalls === 3) throw Object.assign(new Error('simulated-disconnect'), { code: 'unavailable' })
    return sdk.runTransaction(...args)
  } } })
  await assert.rejects(() => interrupted.beginJob(ownerA, unitJob), e => e.code === 'unavailable')
  const stagingManifest = (await remote.readJobs(ownerA)).find(j => j.jobId === unitJob.jobId)
  assert.ok(stagingManifest.preparedParts < stagingManifest.totalParts)
  const resumedPlan = resumeUnitPlan(stagingManifest, await remote.readProfileFromServer(ownerA))
  await remote.beginJob(ownerA, resumedPlan)
  pass('fresh adapter reconstructs interrupted initialization after freeze without original local blueprint')
  assert.equal((await remote.readProfileFromServer(ownerA)).control.activeUnitJob, unitJob.jobId)
  pass('unit job freezes uploads and stages bounded resumable metadata')
  const frozen = await remote.readProfileFromServer(ownerA)
  const frozenRecord = frozen.documents[unitJob.parts[0].paths[0]]
  await denied(() => batchRecord(unitJob.parts[0].paths[0], { ...frozenRecord, appliedOpId: 'ordinary-edit' }, frozen.control), 'ordinary numeric writes denied during active job')
  const jobRef = sdk.doc(a.db, pathA + `/jobs/${unitJob.jobId}`)
  const manifest = (await sdk.getDocFromServer(jobRef)).data()
  assert.ok(!('paths' in manifest) && !('payloads' in manifest))
  await denied(() => sdk.updateDoc(jobRef, { payloads: { backup: 'forbidden' } }), 'growing job source parent denied')
  await denied(() => sdk.getDocFromServer(sdk.doc(b.db, pathA + `/jobs/${unitJob.jobId}`)), 'cross-owner job read denied')
  const part = unitJob.parts[0], marker = `${unitJob.jobId}:${part.partId}`
  const badBatch = sdk.writeBatch(a.db)
  badBatch.set(sdk.doc(a.db, pathA), { ...frozen.control, dataRevision: frozen.control.dataRevision + 1 })
  badBatch.set(sdk.doc(a.db, pathA + '/' + part.paths[0]), { ...frozenRecord, unitVersion: 999, appliedOpId: marker })
  await denied(() => badBatch.commit(), 'job write with incorrect record version denied')
  const firstPart = await remote.commitJobPart(ownerA, unitJob, part)
  assert.equal(firstPart.transformedEntities.length, 20)
  assert.deepEqual((await remote.commitJobPart(ownerA, unitJob, part)).transformedEntities, [])
  pass('20-record part commits atomically within rules budget and replay transforms nothing')
  const secondDevice = createFirestorePort({ client: a })
  const discovered = (await secondDevice.readJobs(ownerA)).find(j => j.jobId === unitJob.jobId)
  const discoveredParts = await secondDevice.readJobParts(ownerA, discovered)
  for (const remaining of discoveredParts) await secondDevice.commitJobPart(ownerA, discovered, remaining)
  await secondDevice.finishJob(ownerA, discovered)
  profile = await remote.readProfileFromServer(ownerA)
  assert.equal(profile.control.unitVersion, 2)
  assert.equal(codec.decodeState(profile.documents).exWeights.unit0, 44.5)
  pass('second adapter discovers parts, resumes unit job and retains completed version history')
  const importOp = changed(codec.decodeState(profile.documents), state => { state.workouts.push({ id: 'imported', d: '2026-10-08', entries: [] }) }, ownerA, profile.control)
  const importJob = createJob({ ownerKey: ownerA.ownerKey, generation: profile.control.generation, kind: 'import', opId: randomUUID(), paths: importOp.paths, payloads: importOp.payloads, options: { sourceVersion: 2, targetVersion: 2 } })
  await remote.beginJob(ownerA, importJob)
  for (const p of importJob.parts) await remote.commitJobPart(ownerA, importJob, p)
  await remote.finishJob(ownerA, importJob)
  for (const p of importJob.parts) assert.deepEqual((await remote.commitJobPart(ownerA, importJob, p)).transformedEntities, [])
  pass('import source remains local and completed markers prevent duplicate replay')
  await remote.deleteOldGeneration(ownerA, { generation: 1, paths: ['workouts/dzE', 'routines/cjA'] })
  assert.equal((await sdk.getDocFromServer(sdk.doc(a.db, pathA + '/workouts/dzE'))).data().generation, 2)
  assert.equal((await sdk.getDocFromServer(sdk.doc(a.db, pathA + '/routines/cjA'))).exists(), false)
  await denied(() => sdk.deleteDoc(sdk.doc(a.db, pathA + '/workouts/dzE')), 'physical delete of current generation denied')
  pass('conditional cleanup deletes only retired generation and preserves recreated ID')
} finally {
  for (const stop of stops) stop()
  const results = await Promise.allSettled(clients.map(async ({ app, db }) => { await sdk.terminate(db); await deleteApp(app) }))
  for (const result of results) if (result.status === 'rejected') throw result.reason
  pass('all official SDK clients terminate and deleteApp cleanly')
}
console.log(`Verified ${checks} real demo-emulator checks with installed grpc-js 1.13.6. No production project was contacted.`)
