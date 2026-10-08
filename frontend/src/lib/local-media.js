import { getMediaStore } from './media-store.js'
import { referencedHashes } from './media-refs.js'

/** Bind every async flow to its initiating owner/session, including A -> B -> A. */
export function captureMediaContext(appStore) {
  const context = appStore.getState().getContext()
  if (!context.localReady || !context.ownerKey) return null
  return { ...context, media: getMediaStore(context.ownerKey), current: () => {
    const now = appStore.getState().getContext()
    return now.localReady && now.ownerKey === context.ownerKey && now.epoch === context.epoch
  } }
}

let activeStore = null
/** Inspect all retention sources. Physical GC is deferred until reference attachment and
 * deletion have a shared boundary across editors, archive commits and peer tabs. */
export async function localMediaGc(ownerKey, { appStore = activeStore } = {}) {
  if (!appStore) return
  const captured = captureMediaContext(appStore)
  if (!captured || captured.ownerKey !== ownerKey) return
  try {
    const snapshot = await appStore.getState().mediaRetentionSnapshot()
    if (!captured.current()) return
    const records = await captured.media.list()
    if (!captured.current()) return
    const keep = new Set(referencedHashes(appStore.getState().S))
    for (const source of snapshot.sources) if (source.ownerKey === ownerKey) for (const h of referencedHashes(source.state)) keep.add(h)
    for (const rec of records) if (captured.media.isHeld(rec.hash) || rec.putAt >= Date.now() - 3600000) keep.add(rec.hash)
    // Even an unreferenced old entry cannot be safely unlinked from this snapshot: another
    // tab can attach it without changing these bytes. Preserve it until a shared lock exists.
  } catch { /* Unreadable archive/index/previous slot: preserve all bytes. */ }
}

export function startLocalMedia({ appStore, getOwner = () => appStore.getState().getContext().ownerKey }) {
  activeStore = appStore
  let stopped = false, timer = null
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!stopped && appStore.getState().getContext().localReady) void localMediaGc(getOwner(), { appStore })
    }, 1000)
  }
  const off = appStore.subscribe(schedule)
  schedule()
  return () => { stopped = true; clearTimeout(timer); off(); if (activeStore === appStore) activeStore = null }
}
