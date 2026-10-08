import { sha256Hex } from '../sha256.js'
import { isMissingFile, normalizeStorageError, reduceEnvelope, revisionListeners, storageError, validateEnvelope, validateOwnerKey } from './offline-store.js'

// A single native bridge may have several Storage instances. Share its per-owner
// write lock, so each reducer runs against the last readback-confirmed revision.
const bridges = new WeakMap()
export function createFsStorage({ loadFilesystem = () => import('@capacitor/filesystem'), hash = sha256Hex } = {}) {
  let opening, fs, locks
  const pending = new Map(), observers = revisionListeners()
  async function open() {
    if (!opening) opening = Promise.resolve().then(loadFilesystem).then(mod => {
      fs = mod
      if (!bridges.has(fs.Filesystem)) bridges.set(fs.Filesystem, new Map())
      locks = bridges.get(fs.Filesystem)
    }).catch(error => { opening = null; throw normalizeStorageError(error) })
    await opening
  }
  async function digest(text) {
    const value = await hash(new TextEncoder().encode(text))
    if (!/^[a-f0-9]{64}$/.test(value)) throw storageError('invalid-hash')
    return value
  }
  async function directory(ownerKey) { validateOwnerKey(ownerKey); return 'opengym-offline/' + await digest(ownerKey) }
  async function readSlot(path, ownerKey) {
    let raw
    try { raw = (await fs.Filesystem.readFile({ path, directory: fs.Directory.Data, encoding: fs.Encoding.UTF8 })).data }
    catch (error) { if (isMissingFile(error)) return null; throw normalizeStorageError(error) }
    let slot
    try { slot = JSON.parse(raw) } catch (error) { throw storageError('storage-corrupt', error) }
    // Preserve even partially understood future evidence instead of recycling this slot.
    if (slot?.envelope?.schemaVersion > 1) throw storageError('unsupported-schema')
    try {
      validateEnvelope(slot?.envelope, ownerKey)
      if (slot.checksum !== await digest(JSON.stringify(slot.envelope))) throw new Error('checksum')
    } catch (error) { throw storageError('storage-corrupt', error) }
    return slot.envelope
  }
  async function latest(ownerKey, inspectRecovery = false) {
    const dir = await directory(ownerKey), slots = [], corrupt = []
    for (let index = 0; index < 2; index++) {
      try { const envelope = await readSlot(`${dir}/slot-${index}.json`, ownerKey); if (envelope) slots.push({ envelope, index }) }
      catch (error) { if (error.code !== 'storage-corrupt') throw error; corrupt.push(error) }
    }
    slots.sort((a, b) => b.envelope.localRevision - a.envelope.localRevision)
    if (corrupt.length && (inspectRecovery || !slots.length)) throw corrupt[0]
    if (slots.length === 2 && slots[0].envelope.localRevision === slots[1].envelope.localRevision && JSON.stringify(slots[0].envelope) !== JSON.stringify(slots[1].envelope)) throw storageError('storage-corrupt')
    return { dir, envelope: slots[0]?.envelope ?? null, index: slots[0]?.index ?? 1, envelopes: slots.map(slot => slot.envelope) }
  }
  async function read(ownerKey) {
    await open()
    await locks.get(ownerKey)?.catch(() => {})
    return structuredClone((await latest(ownerKey)).envelope)
  }
  // Media GC must retain references from both slots. Fail closed if any existing
  // slot cannot be inspected, even when ordinary read can restore its sibling.
  async function readRecoveryEnvelopes(ownerKey) {
    await open()
    await locks.get(ownerKey)?.catch(() => {})
    return structuredClone((await latest(ownerKey, true)).envelopes)
  }
  function commit(ownerKey, reducer) {
    const operation = (async () => {
      validateOwnerKey(ownerKey)
      await open()
      const write = (locks.get(ownerKey) || Promise.resolve()).catch(() => {}).then(async () => {
        const current = await latest(ownerKey)
        const envelope = reduceEnvelope(ownerKey, current.envelope, reducer)
        const content = JSON.stringify(envelope), checksum = await digest(content)
        const path = `${current.dir}/slot-${1 - current.index}.json`
        await fs.Filesystem.writeFile({ path, directory: fs.Directory.Data, encoding: fs.Encoding.UTF8, recursive: true, data: JSON.stringify({ envelope, checksum }) })
        const verified = await readSlot(path, ownerKey)
        if (JSON.stringify(verified) !== content) throw storageError('storage-corrupt')
        observers.notify(verified)
        return structuredClone(verified)
      }).catch(error => { throw normalizeStorageError(error) })
      locks.set(ownerKey, write)
      return await write
    })()
    pending.set(ownerKey, operation)
    operation.catch(() => {})
    return operation
  }
  return { open, read, readRecoveryEnvelopes, commit, async flush(ownerKey) { validateOwnerKey(ownerKey); await pending.get(ownerKey) }, subscribe: observers.subscribe }
}
