import { it, expect, vi } from 'vitest'
import { createWearController } from './wear-session.js'

const snapshot = () => ({ v: 1, active: true, contextToken: 'c', revision: 1, current: { entryIdx: 0, setIdx: 0, side: null, canComplete: true } })
const command = () => ({ v: 1, requestId: 'r', contextToken: 'c', revision: 1, action: 'complete', target: { entryIdx: 0, setIdx: 0, side: null } })
function fixture(overrides = {}) {
  const options = { readSnapshot: snapshot, completeCurrent: vi.fn(), timerAction: vi.fn(), flushLocal: vi.fn(), publish: vi.fn(), reply: vi.fn(), ...overrides }
  return { ...options, controller: createWearController(options) }
}
it('deduplicates concurrent requests and flushes before success', async () => {
  const f = fixture(); await Promise.all([f.controller.handle(command()), f.controller.handle(command())])
  expect(f.completeCurrent).toHaveBeenCalledTimes(1)
  expect(f.flushLocal).toHaveBeenCalledTimes(1)
  expect(f.reply.mock.calls[0][0].status).toBe('ok')
  expect(f.flushLocal.mock.invocationCallOrder[0]).toBeLessThan(f.reply.mock.invocationCallOrder[0])
})
it('routes edits independently, deduplicates them and waits for durable save', async () => {
  const f = fixture({ readSnapshot: () => ({ ...snapshot(), current: { ...snapshot().current, canEdit: true, loadUnit: 'kg' } }), editCurrent: vi.fn() })
  const edit = { ...command(), action: 'edit-set', field: 'w', value: 12.5, unit: 'kg' }
  await Promise.all([f.controller.handle(edit), f.controller.handle(edit)])
  expect(f.editCurrent).toHaveBeenCalledExactlyOnceWith(edit.target, edit)
  expect(f.timerAction).not.toHaveBeenCalled()
  expect(f.completeCurrent).not.toHaveBeenCalled()
  expect(f.flushLocal).toHaveBeenCalledOnce()
  expect(f.flushLocal.mock.invocationCallOrder[0]).toBeLessThan(f.reply.mock.invocationCallOrder[0])
})
it('never confirms success when storage fails', async () => {
  const f = fixture({ flushLocal: vi.fn().mockRejectedValue(new Error('disk')) })
  await f.controller.handle(command()); expect(f.reply.mock.calls[0][0].status).toBe('error')
  await f.controller.handle(command()); expect(f.completeCurrent).toHaveBeenCalledTimes(1)
})
it('does not retry an edit mutation after failed durable storage', async () => {
  const f = fixture({ readSnapshot: () => ({ ...snapshot(), current: { ...snapshot().current, canEdit: true } }), editCurrent: vi.fn(), flushLocal: vi.fn().mockRejectedValue(new Error('disk')) })
  const edit = { ...command(), action: 'edit-set', field: 'r', value: 12 }
  expect((await f.controller.handle(edit)).status).toBe('error')
  expect((await f.controller.handle(edit)).status).toBe('error')
  expect(f.editCurrent).toHaveBeenCalledOnce()
})
it('rejects context changed while saving', async () => {
  let s = snapshot()
  const f = fixture({ readSnapshot: () => s, flushLocal: () => { s = { ...s, contextToken: 'new' } } })
  await f.controller.handle(command()); expect(f.reply.mock.calls[0][0].code).toBe('stale-context')
})
it('rejects stale revision and unavailable handler without applying', async () => {
  const f = fixture(); await f.controller.handle({ ...command(), revision: 0 }); expect(f.completeCurrent).not.toHaveBeenCalled()
  f.controller.dispose(); await f.controller.handle(command()); expect(f.completeCurrent).not.toHaveBeenCalled()
})
