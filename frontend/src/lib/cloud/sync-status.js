/** Framework-free, detached status snapshots. A cloud success never confirms a local write. */
export function createSyncStatus(onStatus) {
  let value = { ownerKey: null, localReady: false, local: 'loading', cloud: 'auth-required',
    localRevision: 0, pendingCount: 0, blockedCount: 0, localError: null, cloudError: null, retryAt: null }
  const listeners = new Set(onStatus ? [onStatus] : [])
  const get = () => structuredClone(value)
  const notify = fn => { try { fn(get()) } catch { /* observers cannot undo a durable commit */ } }
  return {
    get,
    update(patch) { value = { ...value, ...structuredClone(patch) }; for (const fn of listeners) notify(fn) },
    subscribe(fn) { listeners.add(fn); notify(fn); return () => listeners.delete(fn) },
  }
}
