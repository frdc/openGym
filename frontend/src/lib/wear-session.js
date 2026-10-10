import { validateWearCommand } from './wear-protocol.js'

export function createWearController({ readSnapshot, completeCurrent, editCurrent, timerAction, flushLocal, publish, reply }) {
  let disposed = false, chain = Promise.resolve()
  const results = new Map()
  async function apply(command) {
    const state = readSnapshot()
    const key = `${command?.contextToken}:${command?.requestId}`
    let response = results.get(key)
    if (!response) {
      let code = disposed ? 'unavailable' : validateWearCommand(command, state)
      if (!code) {
        // Consume before mutation: a failed disk save must not toggle the row again on retry.
        results.set(key, { v: 1, requestId: command.requestId, status: 'error', code: 'unconfirmed', revision: state.revision })
        try {
          if (command.action === 'complete') await completeCurrent(command.target, command)
          else if (command.action === 'edit-set') {
            if (!editCurrent) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
            await editCurrent(command.target, command)
          }
          else await timerAction(command.action)
          await flushLocal()
          if (disposed || readSnapshot().contextToken !== state.contextToken) code = 'stale-context'
        } catch (error) { code = error?.code || 'unavailable' }
      }
      response = { v: 1, requestId: command?.requestId || '', status: code ? 'error' : 'ok', code: code || null, revision: readSnapshot().revision }
      if (command?.requestId) results.set(key, response)
      while (results.size > 128) results.delete(results.keys().next().value)
    }
    if (response.status === 'ok' && readSnapshot().contextToken !== command?.contextToken) response = { ...response, status: 'error', code: 'stale-context' }
    await publish()
    await reply(response)
    return response
  }
  return {
    handle(command) { const run = chain.then(() => apply(command)); chain = run.catch(() => {}); return run },
    dispose() { disposed = true },
  }
}
