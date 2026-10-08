// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
const slot = vi.hoisted(() => ({ store: null }))
vi.mock('./store/useStore.js', async original => {
 const actual = await original()
 const { createUIStoreFixture } = await import('./store/ui-test-runtime.js')
 slot.fixture = createUIStoreFixture(actual.createWorkoutStore, actual.freshState)
 const useStore = slot.fixture.useStore
 return { ...actual, useStore }
})
import { runtime, workout, deferred } from './store/cloud-test-runtime.js'
import { editCompletedSession } from './lib/session-edit.js'
import { saveWorkoutEdits, finishWorkout } from './sheets.jsx'
import { useUI } from './store/useUI.js'
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }) })
it('waits for confirmed local history durability before success or navigation', async () => {
 const h = await runtime({ initial: { workouts: [workout('edit')] } }); await slot.fixture.attach(h.store)
 h.store.getState().update(s => { editCompletedSession(s, 'edit'); s.active.entries[0].sets[0].w = 45 }, false); await h.store.getState().flushLocal()
 const gate = deferred(), commit = h.storage.commit; h.storage.commit = async (...args) => { await gate.promise; return commit(...args) }
 const exit = vi.fn(), saving = saveWorkoutEdits(exit)
 try { expect(exit).not.toHaveBeenCalled(); expect(useUI.getState().toastMsg).not.toBe('Workout updated') } finally { gate.resolve() }
 await saving
 expect(exit).toHaveBeenCalledOnce(); expect((await h.saved()).state.workouts[0].entries[0].sets[0].w).toBe(45)
})
it('keeps failed history intent and reports failure without navigation', async () => {
 const h = await runtime({ initial: { workouts: [workout('edit')] } }); await slot.fixture.attach(h.store)
 h.store.getState().update(s => { editCompletedSession(s, 'edit'); s.active.entries[0].sets[0].w = 45 }, false); await h.store.getState().flushLocal()
 h.storage.commit = async () => { throw Object.assign(new Error('storage-full'), { code: 'storage-full' }) }
 const exit = vi.fn(); await saveWorkoutEdits(exit)
 expect(exit).not.toHaveBeenCalled(); expect(h.store.getState().sync.local).toBe('error'); expect(h.store.getState().S.workouts[0].entries[0].sets[0].w).toBe(45)
})
it('finishes synchronously but opens its success summary only after local commit', async () => {
 const w = workout('finish'), h = await runtime({ initial: { active: { ...w, routineIds: [], cur: 0 } } }); await slot.fixture.attach(h.store)
 const gate = deferred(), commit = h.storage.commit; h.storage.commit = async (...args) => { await gate.promise; return commit(...args) }
 const finishing = finishWorkout()
 try { expect(h.store.getState().S.active).toBeNull(); expect(useUI.getState().sheets).toEqual([]) } finally { gate.resolve() }
 await finishing; expect(useUI.getState().sheets).toHaveLength(1)
 expect((await h.saved()).pendingOperations.at(-1).kind).toBe('finish')
})
it('cancels saved navigation when another draft replaces the editor during persistence', async () => {
 const h = await runtime({ initial: { workouts: [workout('edit')] } }); await slot.fixture.attach(h.store)
 h.store.getState().update(s => { editCompletedSession(s, 'edit'); s.active.entries[0].sets[0].w = 45 }, false); await h.store.getState().flushLocal()
 const gate = deferred(), commit = h.storage.commit; h.storage.commit = async (...args) => { await gate.promise; return commit(...args) }
 const exit = vi.fn(), saving = saveWorkoutEdits(exit)
 h.store.getState().update(s => { s.active = { id: 'replacement', entries: [] } }, false)
 gate.resolve(); await saving; expect(exit).not.toHaveBeenCalled(); expect(h.store.getState().S.active.id).toBe('replacement')
})
it('cancels A finish summary when Auth confirms B during persistence', async () => {
 const h = await runtime(); await slot.fixture.attach(h.store); await h.auth('a')
 h.store.getState().update(s => { s.active = { ...workout('finish'), routineIds: [], cur: 0 } }, false); await h.store.getState().flushLocal()
 const gate = deferred(), commit = h.storage.commit; h.storage.commit = async (...args) => { await gate.promise; return commit(...args) }
 const finishing = finishWorkout(), switching = h.auth('b'); gate.resolve(); await finishing; await switching
 expect(useUI.getState().sheets).toEqual([]); expect(h.store.getState().user.uid).toBe('b'); expect(h.store.getState().S.workouts).toEqual([])
})
it('failed finishing retains complete intent without opening a saved summary', async () => {
 const h = await runtime({ initial: { active: { ...workout('finish'), routineIds: [], cur: 0 } } }); await slot.fixture.attach(h.store)
 h.storage.commit = async () => { throw Object.assign(new Error('storage-full'), { code: 'storage-full' }) }
 await finishWorkout()
 expect(useUI.getState().sheets).toEqual([]); expect(h.store.getState().sync.local).toBe('error'); expect(h.store.getState().S.workouts[0].id).toBe('finish')
})
