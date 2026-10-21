const failure = code => Object.assign(new Error(code), { code })

/** One explicit round trip. Delivery to Data Layer alone is never success. */
export function createWearSync({ request }) {
  let operation = null
  const finish = (error, result) => {
    const current = operation
    if (!current) return
    operation = null
    clearTimeout(current.timeout); clearInterval(current.retry)
    if (error) current.reject(error); else current.resolve(result)
  }
  const receive = ({ nodeId, response } = {}) => {
    const op = operation
    if (!op || response?.v !== 1 || response.requestId !== op.payload.requestId || response.contextToken !== op.payload.contextToken) return
    if (!op.node) { op.early.push({ nodeId, response }); return }
    if (nodeId !== op.node) return
    if (!op.isCurrent()) { finish(failure('stale-context')); return }
    if (response.status === 'error') finish(failure(response.code === 'sync-conflict' ? 'sync-conflict' : 'sync-unconfirmed'))
    else if (response.status === 'ok' && Number.isInteger(response.heartPending) && response.heartPending >= 0) finish(null, { heartPending: response.heartPending })
  }
  return {
    get active() { return !!operation },
    get requestId() { return operation?.payload.requestId },
    start(contextToken, isCurrent) {
      if (operation) return Promise.reject(failure('sync-busy'))
      if (!contextToken || !isCurrent()) return Promise.reject(failure('stale-context'))
      return new Promise((resolve, reject) => {
        const op = operation = { resolve, reject, isCurrent, early: [], node: null, sending: false,
          payload: { v: 1, requestId: crypto.randomUUID(), contextToken, sentAt: Date.now() } }
        const send = async () => {
          if (operation !== op || op.sending) return
          if (!isCurrent()) { finish(failure('stale-context')); return }
          op.sending = true
          try {
            const result = await request(op.payload)
            if (operation !== op) return
            if (!result?.nodeId || op.node && op.node !== result.nodeId) throw failure('sync-unconfirmed')
            op.node = result.nodeId
            for (const event of op.early.splice(0)) receive(event)
          } catch (error) { if (operation === op) finish(error) }
          finally { op.sending = false }
        }
        op.timeout = setTimeout(() => finish(failure('sync-timeout')), 30000)
        op.retry = setInterval(send, 2000)
        void send()
      })
    },
    receive,
    dispose() { finish(failure('sync-unconfirmed')) },
  }
}
