// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ addListener: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: native }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); native.addListener.mockReset() })
it('flushes on native background, resumes on foreground and removes only its listener', async () => {
 vi.stubEnv('VITE_MOBILE','1'); vi.resetModules()
 let callback; const remove = vi.fn(); native.addListener.mockImplementation(async (_, fn) => { callback = fn; return { remove } })
 const { onAppActive } = await import('./mobile.js'), active = vi.fn(), inactive = vi.fn(), stop = onAppActive(active, inactive)
 await vi.waitFor(() => expect(callback).toEqual(expect.any(Function)))
 callback({ isActive: false }); callback({ isActive: true }); expect(inactive).toHaveBeenCalledOnce(); expect(active).toHaveBeenCalledOnce()
 stop(); callback({ isActive: true }); expect(active).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce()
})
it('removes a registration that resolves after disposal without dispatching stale events', async () => {
 vi.stubEnv('VITE_MOBILE','1'); vi.resetModules()
 let resolve, callback; const remove = vi.fn(); native.addListener.mockImplementation((_, fn) => { callback = fn; return new Promise(r => { resolve = r }) })
 const { onAppActive } = await import('./mobile.js'), active = vi.fn(), stop = onAppActive(active)
 await vi.waitFor(() => expect(resolve).toEqual(expect.any(Function)))
 stop(); callback({ isActive: true }); resolve({ remove }); await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce()); expect(active).not.toHaveBeenCalled()
})
