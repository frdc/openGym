import * as codec from './codec.js'
import { MAX_JOB_PART_IDS } from './model.js'
import { convertStateUnit } from '../units.js'
import { highestStamp } from '../sync-merge.js'

const clone = value => structuredClone(value)
const fail = code => { throw Object.assign(new Error(code), { code: code.split(':')[0] }) }
const key = id => btoa(Array.from(new TextEncoder().encode(id), n => String.fromCharCode(n)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length
export function blockedImportError(job) {
  const [code, ...rest] = (job.blockedReason || '').split(':')
  const path = rest.join(':')
  return job.kind === 'import' && ['invalid-path', 'invalid-document', 'document-too-large'].includes(code)
    && job.parts?.some(part => part.paths.includes(path))
    ? Object.assign(new Error(job.blockedReason), { code, path }) : null
}
export const MAX_PART_BYTES = 700 * 1024

/** The source and parts are durable locally; only jobManifest is a remote parent. */
export function createJob({ ownerKey, generation, kind, opId, paths, options = {}, payloads = {}, referenceDocuments = {} }) {
  if (!opId || !['unit', 'import'].includes(kind) || !Number.isSafeInteger(generation) || generation < 1 || new Set(paths).size !== paths.length) fail('invalid-job')
  const parts = []
  let chunk = [], size = 0
  for (const path of [...paths].sort()) {
    // Budget both transaction reads and worst-case merged writes, plus metadata.
    const n = 2 * (bytes(payloads[path] || path) + bytes(referenceDocuments[path] || path)) + 4096
    if (chunk.length && (chunk.length >= MAX_JOB_PART_IDS || size + n > MAX_PART_BYTES)) { parts.push(chunk); chunk = []; size = 0 }
    chunk.push(path); size += n
  }
  if (chunk.length) parts.push(chunk)
  return { jobId: key(opId), ownerKey, generation, kind, options: clone(options), totalParts: parts.length, completedParts: 0, preparedParts: 0, lastPartId: null, status: 'pending',
    parts: parts.map((paths, i) => ({ partId: String(i).padStart(6, '0'), paths, status: 'pending', sourceVersion: options.sourceVersion, targetVersion: options.targetVersion })), payloads: clone(payloads) }
}
export function jobManifest(job) {
  const { jobId, ownerKey, generation, kind, options, totalParts, completedParts, preparedParts, lastPartId, status } = job
  return clone({ jobId, ownerKey, generation, kind, options, totalParts, completedParts, preparedParts, lastPartId, status })
}
export function planUnitJob({ profile, ownerKey = profile.ownerKey, to, convert = true, opId }) {
  if (!['kg', 'lb'].includes(to)) fail('invalid-unit')
  const state = codec.decodeState(profile.documents, { generation: profile.control.generation })
  return createJob({ ownerKey, generation: profile.control.generation, kind: 'unit', opId,
    paths: [...new Set(['settings/unit', ...Object.keys(profile.documents).filter(p => profile.documents[p].dataUnit)])],
    payloads: profile.documents, options: { from: state.unit, to, convert, sourceVersion: profile.control.unitVersion, targetVersion: profile.control.unitVersion + 1,
      baseRevision: profile.control.dataRevision, stamp: highestStamp(state) + 1 } })
}
/** A pure, repeatable transaction transform. The explicit domain action rounds once. */
export function transformUnitRecord(path, record, job) {
  const o = job.options
  if (record.unitVersion === o.targetVersion) return clone(record)
  if (record.unitVersion !== o.sourceVersion) fail('unit-version-mismatch')
  const next = clone(record)
  if (path === 'settings/unit') {
    next.payload = { value: o.to }; next.stamps.edited.unit = o.stamp
  } else if (record.dataUnit && record.deletedAt === null) {
    const state = codec.decodeState({ [path]: record }, { displayUnit: o.from })
    const converted = o.convert ? convertStateUnit(state, o.to) : { ...state, unit: o.to }
    next.payload = codec.encodeState(converted, { generation: record.generation, unitVersion: o.targetVersion }).documents[path]?.payload || next.payload
    if (path.startsWith('exerciseState/') && Object.hasOwn(next.payload, 'barWeights') && !Object.hasOwn(converted.barWeights || {}, record.payload.id)) delete next.payload.barWeights
  }
  if (record.dataUnit) next.dataUnit = o.to
  next.unitVersion = o.targetVersion
  return next
}
/** Do not infer historical provenance for an edit made before first server proof. */
export function normalizeOperation(operation, history, targetVersion) {
  const out = clone(operation)
  if (out.unitVersion === targetVersion) return out
  if (out.unitProvenance === 'unproven') fail('unit-provenance-unknown')
  while (out.unitVersion < targetVersion) {
    const job = history.find(j => j.kind === 'unit' && j.generation === out.generation && j.options.sourceVersion === out.unitVersion && j.options.targetVersion === out.unitVersion + 1)
    if (!job) fail('unit-history-missing')
    for (const path of out.paths) {
      const record = out.payloads[path]
      out.payloads[path] = record.dataUnit || path === 'settings/unit' ? transformUnitRecord(path, record, job) : { ...record, unitVersion: job.options.targetVersion }
    }
    out.unitVersion = job.options.targetVersion
  }
  if (out.unitVersion !== targetVersion) fail('unit-version-mismatch')
  return out
}
export function resumeUnitPlan(manifest, profile) {
  if (manifest.kind !== 'unit') fail('invalid-job')
  const paths = [...new Set(['settings/unit', ...Object.keys(profile.documents).filter(p => profile.documents[p].dataUnit)])]
  const job = createJob({ ...manifest, opId: 'resume', paths, payloads: profile.documents })
  if (job.totalParts !== manifest.totalParts) fail('job-plan-mismatch')
  return { ...job, ...clone(manifest), parts: job.parts }
}


import { DEF } from '../../store/state-defaults.js'
import { prepareLegacyState } from './legacy-migration.js'
import { mergeStates, stampRestore, stampReplace, inUnitOf } from '../sync-merge.js'
import { sanitizeAccent } from '../accent.js'

/** Keep domain sources and transport projection provenance in the envelope. */
export function reconcileJobUnits(current, profile, history) {
  const next = clone(current), target = profile.control.unitVersion
  const source = next.unitProjectionVersion ?? next.lastConfirmedControl?.unitVersion
  if (source != null && source < target) {
    let version = source
    while (version < target) {
      const job = history.find(j => j.kind === 'unit' && j.generation === profile.control.generation && j.options.sourceVersion === version && j.status === 'complete')
      if (!job) fail('unit-history-missing')
      next.state = job.options.convert ? convertStateUnit(next.state, job.options.to) : { ...next.state, unit: job.options.to }
      version = job.options.targetVersion
    }
    next.unitProjectionVersion = target
  }
  next.pendingOperations = next.pendingOperations.map(op => {
    if (op.generation !== profile.control.generation || op.unitVersion === target) return op
    try { return normalizeOperation(op, history.filter(j => j.status === 'complete'), target) }
    catch (error) { return { ...op, blockedReason: error.code } }
  })
  return next
}

// A replace may delete only the preview's known contents. Preserve the complete
// current record when it changed after that baseline, including unsent edits.
function preservePreviewChanges(next, before, baseline, options) {
  const known = codec.encodeState(inUnitOf(baseline, before), options).documents
  const current = codec.encodeState(before, options).documents
  const encoded = codec.encodeState(next, options)
  for (const path of new Set([...Object.keys(known), ...Object.keys(current)])) {
    if (JSON.stringify(known[path]) === JSON.stringify(current[path])) continue
    if (current[path]) encoded.documents[path] = current[path]
    else delete encoded.documents[path]
  }
  return codec.decodeState(encoded.documents, { ...options, localOverlay: encoded.localOverlay })
}
export function createJobCoordinator({ context, durable, flush, current, remote, newId, now, syncNow }) {
  const requireContext = () => { const ctx = context(); if (!ctx?.envelope) fail('local-not-ready'); return ctx }
  const authenticated = ctx => ctx.user && ctx.owner.uid && remote
  async function reset() {
    const ctx = requireContext(); await flush(ctx)
    const existing = ctx.envelope.pendingJobs.find(j => j.kind === 'reset')
    if (!existing) {
      const opId = newId(), time = now()
      await durable(ctx, value => {
        if (value.pendingJobs.some(j => j.kind === 'reset')) return value
        const baseGeneration = value.lastConfirmedControl?.generation ?? null
        const state = { ...clone(DEF), lang: value.state.lang, langAuto: value.state.langAuto === true, weighIn: false, gifSize: 'mini', resetAt: Math.max(time, highestStamp(value.state) + 1) }
        const job = { jobId: key(opId), ownerKey: value.ownerKey, kind: 'reset', generation: baseGeneration, status: 'pending',
          reset: { opId, baseGeneration, nextGeneration: baseGeneration == null ? null : baseGeneration + 1 }, paths: Object.keys(value.remoteMetadataByPath) }
        return { ...value, state, localMetadata: { ...value.localMetadata, activeSessionToken: null }, cloudGeneration: baseGeneration == null ? value.cloudGeneration : baseGeneration + 1, remoteMetadataByPath: {}, pendingOperations: [],
          pendingJobs: ctx.owner.uid ? [...value.pendingJobs.filter(j => j.kind === 'cleanup'), job] : [], unitProjectionVersion: value.lastConfirmedControl?.unitVersion || 1,
          recoveryCopies: [...value.recoveryCopies, { recoveryId: job.jobId, reason: 'reset', ownerKey: value.ownerKey, state: clone(value.state), pendingOperations: clone(value.pendingOperations), pendingJobs: clone(value.pendingJobs) }] }
      })
    }
    if (authenticated(ctx)) { await runReset(ctx); await runCleanup(ctx) }
  }
  async function runReset(ctx) {
    let job = ctx.envelope.pendingJobs.find(j => j.kind === 'reset')
    if (!job) return
    if (job.reset.baseGeneration === null) {
      const profile = await remote.readProfileFromServer(ctx.owner); current(ctx)
      await durable(ctx, value => ({ ...value, cloudGeneration: profile.control.generation + 1,
        pendingJobs: value.pendingJobs.map(j => j.jobId === job.jobId ? { ...j, generation: profile.control.generation, reset: { ...j.reset, baseGeneration: profile.control.generation, nextGeneration: profile.control.generation + 1 } } : j) }))
      job = ctx.envelope.pendingJobs.find(j => j.kind === 'reset')
    }
    const control = await remote.commitReset(ctx.owner, clone(job.reset)); current(ctx)
    await durable(ctx, value => {
      if (!value.pendingJobs.some(j => j.jobId === job.jobId) || value.cloudGeneration !== control.generation) return value
      return { ...value, lastConfirmedControl: clone(control), pendingJobs: value.pendingJobs.map(j => j.jobId !== job.jobId ? j :
        { jobId: job.jobId, ownerKey: value.ownerKey, kind: 'cleanup', generation: job.reset.baseGeneration, status: 'pending', paths: [], completedParts: 0 }) }
    })

  }
  async function runCleanup(ctx) {
    if (ctx.cleaning) return ctx.cleaning
    const work = (async () => {
      for (const original of ctx.envelope.pendingJobs.filter(j => j.kind === 'cleanup')) {
        while (true) {
          let job = ctx.envelope.pendingJobs.find(j => j.jobId === original.jobId && j.kind === 'cleanup')
          if (!job) break
          if (!job.paths.length) {
            const paths = await remote.readOldGenerationPaths(ctx.owner, { generation: job.generation }); current(ctx)
            await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.flatMap(j => {
              if (j.jobId !== job.jobId || j.paths.length) return [j]
              return paths.length ? [{ ...j, paths: clone(paths) }] : []
            }) }))
            job = ctx.envelope.pendingJobs.find(j => j.jobId === original.jobId)
            if (!job) break
          }
          const paths = clone(job.paths)
          await remote.deleteOldGeneration(ctx.owner, { generation: job.generation, paths }); current(ctx)
          await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.map(j =>
            j.jobId === job.jobId && JSON.stringify(j.paths) === JSON.stringify(paths) ? { ...j, paths: [], completedParts: j.completedParts + 1 } : j) }))
        }
      }
    })().finally(() => { if (ctx.cleaning === work) ctx.cleaning = null })
    ctx.cleaning = work
    return work
  }
  async function changeUnit(to, { convert = true } = {}) {
    const ctx = requireContext(); await flush(ctx)
    if (!['kg','lb'].includes(to)) fail('invalid-unit')
    if (ctx.envelope.state.unit === to) return
    if (ctx.envelope.pendingJobs.some(j => j.kind === 'unit')) fail('unit-job-active')
    const opId = newId(), time = now()
    await durable(ctx, value => {
      if (!value.lastConfirmedControl && authenticated(ctx)) fail('unit-provenance-unknown')
      const control = value.lastConfirmedControl || { generation: value.cloudGeneration, unitVersion: 1, dataRevision: 0 }
      const job = planUnitJob({ profile: { control, documents: codec.encodeState(value.state, control).documents }, ownerKey: value.ownerKey, to, convert, opId })
      const state = convert ? convertStateUnit(value.state, to) : { ...value.state, unit: to }
      state.unitSet = { at: Math.max(time, highestStamp(value.state) + 1), from: value.state.unit, to, convert }; state.edited = { ...state.edited, unit: state.unitSet.at }
      job.options.stamp = state.unitSet.at
      return { ...value, state, unitProjectionVersion: job.options.targetVersion, pendingJobs: authenticated(ctx) || ctx.owner.uid ? [...value.pendingJobs, job] : value.pendingJobs }
    })
    if (authenticated(ctx)) await syncNow()
  }
  async function importBackup(backup, { mode = 'replace', mergeWith = null } = {}) {
    if (!['merge','replace'].includes(mode)) fail('invalid-import-mode')
    const ctx = requireContext(); await flush(ctx)
    const source = sanitizeAccent(await prepareLegacyState({ ...clone(DEF), ...clone(backup) })); current(ctx)
    if (authenticated(ctx) && source.unit !== ctx.envelope.state.unit) await changeUnit(source.unit)
    const opId = newId(), time = now(), importedActiveToken = source.active ? newId() : null
    await durable(ctx, value => {
      const preview = mergeWith?.state || null, before = value.state
      const stamp = Math.max(time, highestStamp(before) + 1, highestStamp(source) + 1, highestStamp(preview) + 1)
      const baseline = preview && (mergeWith.localState ? mergeStates(mergeWith.localState, preview, { retainAllDeletions: true }) : preview)
      const others = baseline ? [baseline] : [before]
      let next = clone(source)
      if (mode === 'merge') next = mergeStates(next, preview ? (mergeWith.local ? mergeStates(before, preview, { retainAllDeletions: true }) : preview) : before, { prefer: 'a', retainAllDeletions: true })
      stampRestore(next, others, stamp, { retainAllDeletions: true })
      if (mode === 'replace') stampReplace(next, others, stamp, { retainAllDeletions: true })
      if (mode === 'replace' && baseline) next = preservePreviewChanges(next, before, baseline, { generation: value.cloudGeneration, unitVersion: value.unitProjectionVersion ?? value.lastConfirmedControl?.unitVersion ?? 1 })
      next.active = before.active ? inUnitOf({ unit: before.unit, active: before.active }, next).active : next.active || null
      next._ts = stamp
      const unitVersion = value.unitProjectionVersion ?? value.lastConfirmedControl?.unitVersion ?? 1
      const operation = codec.prepareOperation(before, next, { ownerKey: value.ownerKey, generation: value.cloudGeneration, unitVersion, opId, kind: 'import' })
      const paths = operation?.paths || []
      const job = createJob({ ownerKey: value.ownerKey, generation: value.cloudGeneration, kind: 'import', opId, paths, payloads: operation?.payloads || {}, referenceDocuments: Object.fromEntries(Object.entries(value.remoteMetadataByPath).map(([path, meta]) => [path, meta.record])), options: { sourceVersion: unitVersion, targetVersion: unitVersion } })
      job.source = clone(source)
      if (operation?.blockedReason) { job.blockedReason = operation.blockedReason; job.status = 'blocked' }
      return { ...value, state: next, localMetadata: { ...value.localMetadata, activeSessionToken: before.active ? value.localMetadata?.activeSessionToken || importedActiveToken : importedActiveToken }, pendingJobs: ctx.owner.uid && paths.length ? [...value.pendingJobs, job] : value.pendingJobs }
    })
    if (authenticated(ctx)) await syncNow()
  }
  async function run(ctx, profile) {
    if (!remote.readJobs) return profile
    const manifests = await remote.readJobs(ctx.owner); current(ctx)
    const activeJob = manifests.find(j => j.jobId === profile.control.activeUnitJob)
    if (activeJob && !ctx.envelope.pendingJobs.some(j => j.jobId === activeJob.jobId)) {
      const job = activeJob.preparedParts < activeJob.totalParts ? resumeUnitPlan(activeJob, profile) : { ...activeJob, parts: await remote.readJobParts(ctx.owner, activeJob) }
      current(ctx); await durable(ctx, value => ({ ...value, pendingJobs: [...value.pendingJobs, job] }))
    }
    const ordered = [...ctx.envelope.pendingJobs].sort((a, b) => Number(b.jobId === activeJob?.jobId) - Number(a.jobId === activeJob?.jobId))
    for (const original of ordered) {
      if (['reset','cleanup'].includes(original.kind) || !ctx.envelope.pendingJobs.some(j => j.jobId === original.jobId)) continue
      let job = original
      if (job.generation !== profile.control.generation) {
        await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.filter(j => j.jobId !== job.jobId), recoveryCopies: [...value.recoveryCopies, { recoveryId: job.jobId, reason: 'generation-mismatch', job: clone(job) }] })); continue
      }
      if (job.blockedReason) {
        if (!blockedImportError(job)) fail(job.blockedReason)
        if (job.options.sourceVersion !== profile.control.unitVersion) fail('unit-version-mismatch')
        return profile
      }
      if (job.kind === 'unit' && !manifests.some(j => j.jobId === job.jobId)) {
        if (job.options.sourceVersion < profile.control.unitVersion) {
          const history = await remote.readJobs(ctx.owner); current(ctx)
          const equivalent = history.some(done => done.kind === 'unit' && done.status === 'complete' && done.generation === job.generation
            && ['from','to','convert','sourceVersion','targetVersion'].every(k => done.options[k] === job.options[k]))
          await durable(ctx, value => {
            if (equivalent) return { ...value, pendingJobs: value.pendingJobs.filter(j => j.jobId !== job.jobId) }
            // This projected version has different semantics on the server. Keep
            // its source and all projected edits intact in owner-specific recovery.
            const projected = value.pendingOperations.filter(op => op.generation === job.generation && op.unitVersion >= job.options.targetVersion)
            const affectedJobs = value.pendingJobs.filter(j => j.generation === job.generation && j.kind !== 'cleanup' && j.kind !== 'reset')
            const overlay = codec.encodeState(value.state, { generation: value.cloudGeneration, unitVersion: value.unitProjectionVersion }).localOverlay
            overlay.fields.active = null; delete overlay.fields.unitSet
            return { ...value, state: codec.decodeState(profile.documents, { generation: profile.control.generation, localOverlay: overlay }),
              unitProjectionVersion: profile.control.unitVersion,
              pendingOperations: value.pendingOperations.filter(op => !projected.some(p => p.opId === op.opId)),
              pendingJobs: value.pendingJobs.filter(j => !affectedJobs.some(old => old.jobId === j.jobId)),
              recoveryCopies: [...value.recoveryCopies, { recoveryId: `unit-conflict:${job.jobId}`, ownerKey: value.ownerKey, reason: 'unit-intent-conflict',
                state: clone(value.state), pendingOperations: clone(projected), pendingJobs: clone(affectedJobs) }] }
          })
          continue
        }
        if (job.options.sourceVersion !== profile.control.unitVersion) fail('unit-version-mismatch')
        const planned = planUnitJob({ profile, ownerKey: ctx.owner.ownerKey, to: job.options.to, convert: job.options.convert, opId: 'replan' })
        job = { ...planned, jobId: job.jobId, options: { ...planned.options, stamp: job.options.stamp } }
        await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.map(j => j.jobId === job.jobId ? job : j) }))
      }
      try {
        await remote.beginJob(ctx.owner, job); current(ctx)
        for (const part of job.parts) {
          await remote.commitJobPart(ctx.owner, job, part); current(ctx)
          await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.map(j => j.jobId === job.jobId ? { ...j, parts: j.parts.map(p => p.partId === part.partId ? { ...p, status: 'complete' } : p) } : j) }))
        }
      } catch (error) {
        current(ctx)
        const blockedReason = `${error.code}:${error.path}`
        if (error.importSource !== true || !blockedImportError({ ...job, blockedReason })) throw error
        if (job.options.sourceVersion !== profile.control.unitVersion) fail('unit-version-mismatch')
        if (profile.control.activeUnitJob) fail('unit-job-active')
        await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.map(j => j.jobId === job.jobId ? { ...j, status: 'blocked', blockedReason } : j) }))
        return profile
      }
      await remote.finishJob(ctx.owner, job); current(ctx)
      await durable(ctx, value => ({ ...value, pendingJobs: value.pendingJobs.filter(j => j.jobId !== job.jobId) }))
      profile = await remote.readProfileFromServer(ctx.owner); current(ctx)
    }
    return profile
  }
  return { reset, changeUnit, importBackup, runReset, runCleanup, run }
}
