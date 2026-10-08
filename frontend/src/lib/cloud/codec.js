import { DEF } from '../../store/state-defaults.js'
import { FIELD_POLICY, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_DEPTH } from './model.js'
import { mergeStates, highestStamp } from '../sync-merge.js'
import { beatsWeight, isAssisted } from '../exercises.js'
import { bestWeightForEntry } from '../history.js'

const copy = value => structuredClone(value)
const own = (obj, key) => Object.hasOwn(obj || {}, key)
const put = (obj, key, value) => Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true })
const lists = { routines: 'routines', workouts: 'workouts', bodyweight: 'bodyweight', customEx: 'customExercises', equipProfiles: 'equipmentProfiles', gymCards: 'gymCards' }
const exerciseFields = ['exWeights', 'exNotes', 'barWeights', 'loadKind']
const planFields = ['queue', 'rotation', 'scheduleMode']
const grouped = new Set([...Object.keys(lists), ...exerciseFields, ...planFields, 'favEx', 'week', 'dayPlan', 'balanceOverrides', 'plates', 'edited', 'undone', 'deleted'])
const settings = Object.keys(FIELD_POLICY).filter(k => FIELD_POLICY[k] === 'sync' && !grouped.has(k))
const mediaFields = new Set(['media', 'photo', 'video', 'uri', 'localUri'])
const localUri = value => typeof value === 'string' && /^(file:|content:|blob:|data:|capacitor:|https?:\/\/(localhost|127\.0\.0\.1)(:|\/))/i.test(value)
const idKey = id => btoa(Array.from(new TextEncoder().encode(String(id)), n => String.fromCharCode(n)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') || '_'
const entityPath = (field, id) => `${lists[field]}/${field === 'bodyweight' && /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : idKey(id)}`
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const same = (a, b) => canonical(a) === canonical(b)
const unit = value => value === 'lb' ? 'lb' : 'kg'

// Keep associations and their Undo/field stamps local, including removed media fields.
function splitMedia(entity) {
  const payload = copy(entity), overlay = {}
  const keys = new Set([...Object.keys(payload), ...Object.keys(payload._f || {}), ...Object.keys(payload._u || {})])
  for (const key of keys) {
    if (!mediaFields.has(key) && !localUri(payload[key]) && !(['img', 'gif'].includes(key) && !own(payload, key))) continue
    if (own(payload, key)) { put(overlay, key, payload[key]); delete payload[key] }
    for (const stamp of ['_f', '_u']) if (own(payload[stamp], key)) {
      overlay[stamp] ||= {}; put(overlay[stamp], key, payload[stamp][key]); delete payload[stamp][key]
      if (!Object.keys(payload[stamp]).length) delete payload[stamp]
    }
  }
  return { payload, overlay }
}
function stampsFor(state, keys, deleted = {}) {
  const stamps = { edited: {}, undone: {}, deleted }
  for (const key of keys) {
    if (own(state.edited, key)) put(stamps.edited, key, state.edited[key])
    if (own(state.undone, key)) put(stamps.undone, key, copy(state.undone[key]))
  }
  return stamps
}
function record(state, payload, keys, options, dataUnit = null, deletion = {}) {
  return { schemaVersion: 1, generation: options.generation, unitVersion: options.unitVersion, dataUnit,
    payload: copy(payload), stamps: stampsFor(state, keys, deletion), deletedAt: null, appliedOpId: null }
}

/** Pure projection. Unmigrated workouts remain in localOverlay.unmigratedWorkouts for recovery. */
export function encodeState(state, options) {
  const documents = {}, localOverlay = { fields: {}, entities: {}, unmigratedWorkouts: [] }
  for (const [key, value] of Object.entries(state)) {
    if (!own(FIELD_POLICY, key)) throw new Error(`unclassified-field:${key}`)
    if (key === 'coach') continue
    if (['local', 'legacy', 'removed', 'derived'].includes(FIELD_POLICY[key])) put(localOverlay.fields, key, copy(value))
  }
  const add = (path, payload, keys = [], numeric = false, deletion = {}) => {
    put(documents, path, record(state, payload, keys, options, numeric ? unit(state.unit) : null, deletion))
  }
  for (const key of settings) if (own(state, key) || own(state.edited, key)) add(`settings/${key}`, own(state, key) ? { value: state[key] } : {}, [key], key === 'targetW')
  add('plans/main', { ...Object.fromEntries(planFields.filter(k => own(state, k)).map(k => [k, state[k]])), routineOrder: (state.routines || []).map(r => r.id) }, [...planFields, 'routineOrder'])
  for (const field of ['week', 'dayPlan']) {
    const keys = new Set([...Object.keys(state[field] || {}), ...Object.keys(state.edited || {}).filter(k => k.startsWith(`${field}.`)).map(k => k.slice(field.length + 1))])
    for (const key of keys) add(`planDays/${idKey(`${field}:${key}`)}`, { field, key, ...(own(state[field], key) ? { value: state[field][key] } : {}) }, [`${field}.${key}`])
  }
  for (const field of Object.keys(lists)) {
    const entries = new Map()
    for (const entry of state[field] || []) {
      const id = field === 'bodyweight' ? entry.d : entry.id
      if (id == null) {
        if (field === 'workouts') { localOverlay.unmigratedWorkouts.push(copy(entry)); continue }
        throw new Error(`invalid-document:${field}:missing-id`)
      }
      const previous = entries.get(String(id))
      if (!previous || field !== 'bodyweight' || (entry.t || 0) > (previous.t || 0)) entries.set(String(id), entry)
    }
    for (const id of new Set([...entries.keys(), ...Object.keys(state.deleted?.[field] || {})])) {
      const path = entityPath(field, id), entry = entries.get(id), deletion = state.deleted?.[field]?.[id]
      const { payload, overlay } = splitMedia(entry || (field === 'bodyweight' ? { d: id } : { id }))
      if (Object.keys(overlay).length) put(localOverlay.entities, path, overlay)
      add(path, payload, [], ['routines', 'workouts', 'bodyweight'].includes(field), deletion == null ? {} : { [field]: { [id]: deletion } })
      if (!entry && deletion > 0) documents[path].deletedAt = deletion
    }
  }
  const exIds = new Set([...exerciseFields.flatMap(f => Object.keys(state[f] || {})), ...(state.favEx || []), ...Object.keys(state.deleted?.favEx || {}),
    ...Object.keys(state.edited || {}).filter(k => /^(exNotes|barWeights)\./.test(k)).map(k => k.slice(k.indexOf('.') + 1))])
  for (const id of exIds) {
    const payload = { id, favourite: (state.favEx || []).includes(id) }
    for (const field of exerciseFields) if (own(state[field], id)) payload[field] = state[field][id]
    const del = state.deleted?.favEx?.[id]
    add(`exerciseState/${idKey(id)}`, payload, [`exNotes.${id}`, `barWeights.${id}`], own(payload, 'exWeights') || own(payload, 'barWeights'), del == null ? {} : { favEx: { [id]: del } })
  }
  for (const field of ['balanceOverrides', 'plates']) for (const [key, value] of Object.entries(state[field] || {})) add(`${field}/${field === 'plates' ? key : idKey(key)}`, { key, value })
  return { documents, localOverlay }
}

const preciseWeight = (value, factor) => value == null || value === '' || !Number.isFinite(Number(value)) ? value : Number(value) * factor
function convertTarget(target, factor) {
  if (!target || typeof target !== 'object') return target
  const out = copy(target)
  if (own(out, 'weight')) out.weight = preciseWeight(out.weight, factor)
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = preciseWeight(out.inc, factor)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(x => convertTarget(x, factor))
  return out
}
function convertSet(set, factor) {
  const out = copy(set)
  if (own(out, 'w')) out.w = preciseWeight(out.w, factor)
  if (out.sides) for (const side of ['L', 'R']) if (out.sides[side]) out.sides[side] = convertSet(out.sides[side], factor)
  if (Array.isArray(out.drops)) out.drops = out.drops.map(x => convertSet(x, factor))
  return out
}
function convertedPayload(path, rec, displayUnit) {
  const p = copy(rec.payload)
  if (!rec.dataUnit || rec.dataUnit === displayUnit) return p
  const factor = displayUnit === 'lb' ? 2.2046226218 : 1 / 2.2046226218
  if (path === 'settings/targetW') p.value = preciseWeight(p.value, factor)
  if (path.startsWith('bodyweight/')) p.w = preciseWeight(p.w, factor)
  if (path.startsWith('exerciseState/')) {
    if (p.exWeights && typeof p.exWeights === 'object') p.exWeights.w = preciseWeight(p.exWeights.w, factor)
    else if (own(p, 'exWeights')) p.exWeights = preciseWeight(p.exWeights, factor)
    if (own(p, 'barWeights')) p.barWeights = preciseWeight(p.barWeights, factor)
  }
  if (path.startsWith('routines/')) p.ex = (p.ex || []).map(x => convertTarget(x, factor))
  if (path.startsWith('workouts/')) {
    if (own(p, 'bw')) p.bw = preciseWeight(p.bw, factor)
    if (own(p, 'vol')) p.vol = preciseWeight(p.vol, factor)
    p.entries = (p.entries || []).map(e => ({ ...e,
      ...(own(e, 'topW') ? { topW: preciseWeight(e.topW, factor) } : {}),
      ...(e.target ? { target: convertTarget(e.target, factor) } : {}), ...(e.planned ? { planned: convertTarget(e.planned, factor) } : {}),
      ...(e.sets ? { sets: e.sets.map(x => convertSet(x, factor)) } : {}),
    }))
  }
  return p
}
function restoreOverlay(state, overlay = {}) {
  Object.assign(state, copy(overlay.fields || {}))
  delete state.coach
  for (const field of Object.keys(lists)) for (const entry of state[field] || []) {
    const extra = overlay.entities?.[entityPath(field, field === 'bodyweight' ? entry.d : entry.id)]
    if (!extra) continue
    for (const [key, value] of Object.entries(extra)) {
      if (key === '_f' || key === '_u') entry[key] = { ...entry[key], ...copy(value) }
      else put(entry, key, copy(value))
    }
  }
  const legacy = (overlay.unmigratedWorkouts || []).filter(w => !(state.workouts || []).some(existing => same(w, existing)))
  state.workouts = [...(state.workouts || []), ...copy(legacy)]
  return state
}
/** Each numeric record declares its source unit. The source documents are never mutated. */
export function decodeState(documents, { defaults = DEF, localOverlay, generation, displayUnit } = {}) {
  const active = Object.entries(documents).filter(([, r]) => r && r.schemaVersion === 1 && (generation == null || r.generation === generation))
  const targetUnit = unit(displayUnit || active.find(([p]) => p === 'settings/unit')?.[1]?.payload?.value || defaults.unit)
  const state = copy(defaults), order = []
  for (const f of Object.keys(lists)) state[f] = []
  for (const f of [...exerciseFields, 'week', 'dayPlan', 'balanceOverrides', 'plates']) state[f] = {}
  state.favEx = []; state.edited = {}; state.undone = {}; state.deleted = {}; state.unit = targetUnit
  for (const [path, rec] of active) {
    const [collection, key] = path.split('/'), p = convertedPayload(path, rec, targetUnit)
    Object.assign(state.edited, copy(rec.stamps?.edited || {})); Object.assign(state.undone, copy(rec.stamps?.undone || {}))
    for (const [f, deletions] of Object.entries(rec.stamps?.deleted || {})) {
      state.deleted[f] ||= {}
      for (const [id, stamp] of Object.entries(deletions)) put(state.deleted[f], id, stamp)
    }
    if (rec.deletedAt != null) continue
    if (collection === 'settings') { if (key !== 'unit') { if (own(p, 'value')) put(state, key, p.value); else delete state[key] } }
    else if (path === 'plans/main') { for (const f of planFields) if (own(p, f)) state[f] = p[f]; order.push(...(p.routineOrder || [])) }
    else if (collection === 'planDays') { if (own(p, 'value')) put(state[p.field], p.key, p.value) }
    else if (collection === 'exerciseState') {
      for (const f of exerciseFields) if (own(p, f)) put(state[f], p.id, p[f])
      if (p.favourite) state.favEx.push(p.id)
    } else if (collection === 'balanceOverrides' || collection === 'plates') put(state[collection], p.key, p.value)
    else { const field = Object.keys(lists).find(f => lists[f] === collection); if (field) state[field].push(p) }
  }
  state.routines.sort((a, b) => (order.indexOf(a.id) < 0 ? Infinity : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? Infinity : order.indexOf(b.id)))
  for (const f of ['edited', 'undone', 'deleted']) if (!Object.keys(state[f]).length) delete state[f]
  state._ts = highestStamp(state)
  return restoreOverlay(state, localOverlay)
}

function documentProblem(path, doc) {
  const walk = (value, depth, array = false) => {
    if (depth > MAX_DOCUMENT_DEPTH || value === undefined || typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) return false
    if (value === null || typeof value !== 'object') return true
    if (Array.isArray(value)) return !array && value.every(x => walk(x, depth + 1, true))
    return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(x => walk(x, depth + 1))
  }
  try {
    if (!walk(doc, 0)) return `invalid-document:${path}`
    if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DOCUMENT_BYTES) return `document-too-large:${path}`
  } catch { return `invalid-document:${path}` }
  return null
}
function associatedExercisePaths(previous, next, changed) {
  const out = new Map()
  for (const state of [previous, next]) for (const w of state.workouts || []) {
    if (w.id != null && changed.has(entityPath('workouts', w.id))) for (const e of w.entries || []) if (e.id != null) out.set(`exerciseState/${idKey(e.id)}`, e.id)
  }
  return [...out]
}
/** Inputs have already been stamped by the caller; IDs and causal time are never created here. */
export function prepareOperation(previous, next, options) {
  const before = encodeState(previous, options), after = encodeState(next, options)
  const changed = path => {
    const a = before.documents[path], b = after.documents[path]
    if (same(a, b)) return false
    // stampChange bumps an entity's generic timestamp even for a local photo.
    // Suppress only that timestamp delta when its local overlay actually changed
    // and every other transported value/stamp/deletion is exactly unchanged.
    if (a && b && !same(before.localOverlay.entities[path], after.localOverlay.entities[path])) {
      const withoutTime = rec => { const out = copy(rec); delete out.payload._ts; return out }
      if (same(withoutTime(a), withoutTime(b))) return false
    }
    return true
  }
  const paths = new Set([...Object.keys(before.documents), ...Object.keys(after.documents)].filter(changed))
  for (const [path, id] of associatedExercisePaths(previous, next, paths)) {
    paths.add(path)
    if (!after.documents[path]) {
      // The editing device may never have seen a remote PR. Its absence must reach the
      // domain merge so a historical correction cannot inherit that old load as its own.
      put(after.documents, path, record(next, { id, favourite: false }, [], options))
    }
  }
  const missingIds = after.localOverlay.unmigratedWorkouts.length > 0
  if (!paths.size && !missingIds) return null
  const payloads = {}
  for (const path of [...paths].sort()) {
    // Missing map entries need explicit replacement; list removals already carry stamped tombstones.
    put(payloads, path, after.documents[path] || { ...before.documents[path], payload: {}, deletedAt: highestStamp(next) })
  }
  return { opId: options.opId, ownerKey: options.ownerKey, generation: options.generation, unitVersion: options.unitVersion,
    kind: options.kind, paths: [...paths].sort(), readPaths: [...paths].sort(), payloads,
    blockedReason: missingIds ? 'invalid-document:workouts:missing-id' : Object.entries(payloads).map(([p, d]) => documentProblem(p, d)).find(Boolean) || null }
}

// The legacy merge looks custom exercises up in the live registry. A transaction must not
// register exercises globally: resolve those shapes from its immutable domain context instead.
function reconcileCustomLoads(merged, local, remote) {
  for (const shape of merged.customEx || []) {
    const id = shape.id, correctionSources = []
    for (const w of remote.workouts || []) {
      const changed = local.workouts.find(x => x.id === w.id), kept = merged.workouts.find(x => x.id === w.id)
      if (!kept && merged.deleted?.workouts?.[w.id] > 0) {
        for (const state of [local, remote]) if (state.deleted?.workouts?.[w.id] > 0 && w.entries?.some(e => e.id === id)) correctionSources.push(state)
      } else if (changed && kept && (w._ts || 0) !== (changed._ts || 0) && !same(w.entries, changed.entries) && [...(w.entries || []), ...(changed.entries || [])].some(e => e.id === id)) {
        correctionSources.push(same(kept.entries, changed.entries) ? local : remote)
      }
    }
    let best = null
    const consider = candidate => { if (candidate?.w > 0 && (!best || beatsWeight(shape, candidate.w, best.w))) best = candidate }
    for (const source of correctionSources.length ? correctionSources : [local, remote]) consider(source.exWeights?.[id])
    if (correctionSources.length) for (const w of merged.workouts) for (const e of w.entries || []) if (e.id === id) {
      // The history helper accepts an explicit shape when no registry ID is provided.
      consider({ w: bestWeightForEntry({ ...e, id: null, assisted: isAssisted(shape) }), d: w.d })
    }
    if (best) put(merged.exWeights, id, copy(best)); else delete merged.exWeights[id]
  }
}

/** Replay-safe merge. The transaction must verify remoteProfile.control.dataRevision before writing. */
export function mergeOperation(remoteByPath, operation, { control, domainContext } = {}) {
  if (control.activeUnitJob && operation.paths.some(p => operation.payloads[p]?.dataUnit)) throw new Error('unit-job-active')
  return mergeOperationDocuments(remoteByPath, operation, { control, domainContext })
}

// A local acknowledgement replays pending edits even while remote numeric uploads are paused.
// Generation, unit-version, and record validation still apply to this pure reconciliation.
function mergeOperationDocuments(remoteByPath, operation, { control, domainContext }) {
  if (operation.blockedReason) throw new Error(operation.blockedReason)
  if (control.generation !== operation.generation) throw new Error('generation-mismatch')
  if (control.unitVersion !== operation.unitVersion) throw new Error('unit-version-mismatch')
  if (domainContext && domainContext.remoteProfile.control.dataRevision !== control.dataRevision) throw new Error('domain-context-stale')
  const documentsToWrite = {}, confirmedDocuments = {}
  if (operation.paths.every(p => remoteByPath[p]?.appliedOpId === operation.opId)) {
    for (const p of operation.paths) put(confirmedDocuments, p, copy(remoteByPath[p]))
    return { documentsToWrite, confirmedDocuments }
  }
  const allRemote = { ...(domainContext?.remoteProfile.documents || {}), ...remoteByPath }
  const remote = decodeState(allRemote, { generation: control.generation })
  if (!domainContext && operation.paths.some(p => p.startsWith('workouts/'))) throw new Error('domain-context-required')
  const local = decodeState({ ...allRemote, ...operation.payloads }, { generation: control.generation, displayUnit: remote.unit })
  // Both are already in the same unit. mergeStates therefore never invokes its rounded converter.
  const merged = mergeStates(local, remote, { retainAllDeletions: true })
  reconcileCustomLoads(merged, local, remote)
  const encoded = encodeState(merged, operation).documents
  for (const path of operation.paths) {
    const doc = encoded[path] || operation.payloads[path]
    const confirmed = { ...copy(doc), appliedOpId: operation.opId }
    const problem = documentProblem(path, confirmed)
    if (problem) throw new Error(problem)
    put(confirmedDocuments, path, confirmed)
    if (!same(remoteByPath[path], confirmed)) put(documentsToWrite, path, confirmed)
  }
  return { documentsToWrite, confirmedDocuments }
}

function assertOwner(envelope, ownerKey) { if (ownerKey !== envelope.ownerKey) throw new Error('owner-mismatch') }
export function mergeLocalDraft(currentEnvelope, { previous, next, operation, activeSessionToken, replaceActive = false }) {
  if (operation) assertOwner(currentEnvelope, operation.ownerKey)
  const out = copy(currentEnvelope)
  // Existing domain merge joins concurrent tabs; the running session belongs to this local profile.
  out.state = mergeStates(next, out.state, { retainAllDeletions: true })
  const currentOverlay = encodeState(currentEnvelope.state, { generation: out.cloudGeneration, unitVersion: operation?.unitVersion || 1 }).localOverlay
  const nextOverlay = encodeState(next, { generation: out.cloudGeneration, unitVersion: operation?.unitVersion || 1 }).localOverlay
  restoreOverlay(out.state, currentOverlay)
  for (const field of new Set([...Object.keys(currentOverlay.fields), ...Object.keys(nextOverlay.fields)])) {
    if (same(previous[field], next[field])) continue
    if (own(next, field)) out.state[field] = copy(next[field]); else delete out.state[field]
  }
  // A stale empty tab cannot erase a workout started by another tab.
  if (!previous.active && !next.active && currentEnvelope.state.active) out.state.active = copy(currentEnvelope.state.active)
  if (replaceActive) out.state.active = copy(next.active || null)
  // Metadata follows the resulting active overlay, including a newer tab's draft.
  if (!out.state.active) out.localMetadata = { ...out.localMetadata, activeSessionToken: null }
  else if ((replaceActive || !same(previous.active, next.active)) && activeSessionToken !== undefined)
    out.localMetadata = { ...out.localMetadata, activeSessionToken }
  for (const f of ['workouts', 'customEx']) for (const entity of out.state[f] || []) {
    const changed = (next[f] || []).find(e => e.id === entity.id), before = (previous[f] || []).find(e => e.id === entity.id)
    if (changed && !same(splitMedia(before || {}).overlay, splitMedia(changed).overlay)) {
      for (const key of new Set([...mediaFields, ...Object.keys(splitMedia(entity).overlay)])) {
        if (key !== '_f' && key !== '_u') delete entity[key]
      }
      for (const [key, value] of Object.entries(splitMedia(changed).overlay)) {
        if (key === '_f' || key === '_u') entity[key] = { ...entity[key], ...copy(value) }
        else put(entity, key, copy(value))
      }
    }
  }
  if (operation && !out.pendingOperations.some(x => x.opId === operation.opId)) out.pendingOperations.push(copy(operation))
  out.localRevision++
  return out
}
export function applyConfirmation(envelope, confirmation) {
  assertOwner(envelope, confirmation.ownerKey)
  if (confirmation.control.generation !== envelope.cloudGeneration) throw new Error('generation-mismatch')
  const out = copy(envelope), options = { generation: out.cloudGeneration, unitVersion: confirmation.control.unitVersion }
  const { documents: current, localOverlay } = encodeState(out.state, options)
  const accepted = {}
  for (const [path, record] of Object.entries(confirmation.documents)) {
    if ((out.remoteMetadataByPath[path]?.ackRevision ?? -1) > confirmation.control.dataRevision) continue
    put(out.remoteMetadataByPath, path, { record: copy(record), ackRevision: confirmation.control.dataRevision })
    put(accepted, path, record)
  }
  out.pendingOperations = out.pendingOperations.filter(x => x.opId !== confirmation.opId)
  let documents = { ...current, ...accepted }
  for (const op of out.pendingOperations) {
    if (op.generation !== out.cloudGeneration) continue
    if (op.blockedReason || op.unitVersion !== confirmation.control.unitVersion) {
      for (const path of op.paths) if (current[path]) put(documents, path, current[path])
      continue
    }
    // Reapply pending diffs to the acknowledgement using their original stamps, never new time.
    const result = mergeOperationDocuments(documents, op, { control: confirmation.control, domainContext: { remoteProfile: { control: confirmation.control, documents }, remoteState: decodeState(documents, options) } })
    documents = { ...documents, ...result.confirmedDocuments }
  }
  out.state = decodeState(documents, { ...options, defaults: DEF, localOverlay })
  if (!out.lastConfirmedControl || out.lastConfirmedControl.dataRevision <= confirmation.control.dataRevision) out.lastConfirmedControl = copy(confirmation.control)
  out.localRevision++
  return out
}
