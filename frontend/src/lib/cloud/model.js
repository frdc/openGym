/** Cloud transport contracts. Transport metadata never belongs to shareable state S.
 * @typedef {{projectId:string, uid:string|null, ownerKey:string}} Owner
 * @typedef {{schemaVersion:1, generation:number, dataRevision:number, unitVersion:number, activeUnitJob:null|string, lastResetOpId:null|string}} Control
 * @typedef {{schemaVersion:1, generation:number, unitVersion:number, dataUnit:null|'kg'|'lb', payload:*, stamps:Object, deletedAt:null|number, appliedOpId:null|string}} Record
 * @typedef {{opId:string, ownerKey:string, generation:number, unitVersion:number, kind:string, paths:string[], readPaths:string[], payloads:Object<string,Record>, blockedReason:null|string}} Operation
 * @typedef {{schemaVersion:1, ownerKey:string, localRevision:number, cloudGeneration:number, state:Object, remoteMetadataByPath:Object<string,{record:Record,ackRevision:number}>, pendingOperations:Operation[], pendingJobs:Job[], adoptionDecision:*, recoveryCopies:Object[], lastConfirmedControl:null|Control}} Envelope
 * @typedef {{ownerKey:string, opId:string, control:Control, documents:Object<string,Record>}} Confirmation
 * @typedef {{control:Control, documents:Object<string,Record>}} Profile
 * @typedef {{remoteProfile:Profile, remoteState:Object}} DomainContext
 * @typedef {{jobId:string,ownerKey:string,generation:number,kind:string,options:Object,totalParts:number,completedParts:number,status:'pending'|'running'|'complete'|'blocked'}} Job
 * @typedef {{partId:string,paths:string[],status:string,sourceVersion:number,targetVersion:number}} JobPart
 */
export const SCHEMA_VERSION = 1
export const APP_NAMESPACE = 'apps/opengym'
export const EMULATOR_PROJECT_ID = 'demo-opengym'
export const AUTH_EMULATOR_HOST = '127.0.0.1:9099'
export const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081'
export const MAX_JOB_PART_IDS = 20
export const MAX_DOCUMENT_BYTES = 900 * 1024
export const MAX_DOCUMENT_DEPTH = 20

// Explicit inventory: adding a persistent setting requires a deliberate transport decision.
const policies = {
  sync: `unit restSec restPauseSec sound soundOnSilent vibrateOnSilent timerFlash timedSetOvertime keepAwake lang theme accent accentCustom body targetW bodyweight routines week dayPlan queue rotation scheduleMode exWeights workouts customEx gifSize heatmapMetric workoutView wc hints reminder effort equipProfiles activeEquipId equipFilterOn exNotes favEx weekStart wdec speedUnit barWeights plates loadKind gymCards lastGymCardId checkIn showWeightCard weighIn connStatus startFrom enParens enOnly logRef balanceTemplate balanceOverrides vibrate classicChime showRir edited undone deleted`,
  local: 'active coach autoBackup langAuto',
  derived: '_ts routineOrder',
  legacy: 'unitSet resetAt resetIds',
  removed: '_rev _wid _wids _unstamped _prior',
}
export const FIELD_POLICY = Object.freeze(Object.fromEntries(Object.entries(policies).flatMap(([policy, fields]) => fields.split(' ').map(field => [field, policy]))))

export function makeOwner(projectId, uid = null) {
  if (typeof projectId !== 'string' || !projectId || (uid !== null && (typeof uid !== 'string' || !uid || uid.includes('/')))) throw new Error('invalid-owner')
  return { projectId, uid, ownerKey: JSON.stringify([projectId, APP_NAMESPACE, uid]) }
}
export function makeEnvelope(owner, state) {
  return { schemaVersion: 1, ownerKey: owner.ownerKey, localRevision: 0, cloudGeneration: 1,
    state: structuredClone(state), remoteMetadataByPath: {}, pendingOperations: [], pendingJobs: [],
    adoptionDecision: null, recoveryCopies: [], lastConfirmedControl: null }
}
