/** Stable record identity, never an authorization token. Copies with duplicate IDs
 * are ambiguous: replace every copy rather than choosing the first as original. */
export function identifyWearTargets(S) {
  if (!S.active || !Array.isArray(S.active.entries)) return S
  const objects = S.active.entries.flatMap(entry => [entry, ...(entry.sets || [])])
  const counts = new Map()
  for (const object of objects) if (typeof object.logId === 'string' && object.logId) counts.set(object.logId, (counts.get(object.logId) || 0) + 1)
  if (objects.every(object => counts.get(object.logId) === 1)) return S
  const next = structuredClone(S)
  for (const object of next.active.entries.flatMap(entry => [entry, ...(entry.sets || [])])) {
    if (counts.get(object.logId) !== 1) object.logId = crypto.randomUUID()
  }
  return next
}
