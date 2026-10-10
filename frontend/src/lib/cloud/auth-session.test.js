import { describe, expect, it, vi } from 'vitest'
import { createAuthSession } from './auth-session.js'

const restored = { uid: 'uid-a', email: 'a@example.test', displayName: 'Ana', accessToken: 'secret', refreshToken: 'secret' }
function fixture() {
  let next, error
  const auth = { currentUser: null }, calls = [], unsubscribe = vi.fn()
  const sdk = {
    onAuthStateChanged(value, callback, onError) { expect(value).toBe(auth); next = callback; error = onError; return unsubscribe },
    async signInWithEmailAndPassword(value, email, password) { calls.push(['login', value, email, password]); return { user: restored } },
    async createUserWithEmailAndPassword(value, email, password) { calls.push(['register', value, email, password]); return { user: { ...restored } } },
    async updateProfile(user, profile) { calls.push(['profile', profile]); Object.assign(user, profile) },
    async sendPasswordResetEmail(value, email) { calls.push(['reset', value, email]) },
    async signOut(value) { calls.push(['signOut', value]) },
  }
  const users = [], session = createAuthSession({ client: { auth }, onUser: user => users.push(user), sdk })
  return { auth, sdk, calls, users, session, unsubscribe, emit: user => next(user), fail: value => error(value) }
}
describe('Auth session', () => {
  it('waits for a delayed restored owner instead of treating currentUser=null as logout', async () => {
    const f = fixture(), ready = vi.fn()
    f.session.ready.then(ready)
    await Promise.resolve()
    expect(f.users).toEqual([]); expect(ready).not.toHaveBeenCalled()
    f.emit(restored)
    expect(await f.session.ready).toEqual({ uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' })
    expect(f.users).toEqual([{ uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' }])
  })
  it('resolves readiness once while delivering later account switches and confirmed logout', async () => {
    const f = fixture()
    f.emit(restored); f.emit({ uid: 'uid-b', email: null, displayName: null }); f.emit(null)
    expect((await f.session.ready).uid).toBe('uid-a')
    expect(f.users.map(user => user?.uid ?? null)).toEqual(['uid-a', 'uid-b', null])
  })
  it('waits for restoration before issuing a login operation', async () => {
    const f = fixture(), result = f.session.login('a@example.test', 'password')
    await Promise.resolve()
    expect(f.calls).toEqual([])
    f.emit(null)
    expect(await result).toEqual({ uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' })
    expect(f.calls).toEqual([['login', f.auth, 'a@example.test', 'password']])
    expect(f.users).toEqual([null]) // Only the SDK listener determines account ownership.
  })
  it('registers and applies the requested display name through the SDK', async () => {
    const f = fixture(); f.emit(null)
    expect(await f.session.register('a@example.test', 'password', 'Ada')).toEqual({ uid: 'uid-a', email: 'a@example.test', displayName: 'Ada' })
    expect(f.calls).toEqual([['register', f.auth, 'a@example.test', 'password'], ['profile', { displayName: 'Ada' }]])
  })
  it('returns a sanitized login result when the SDK listener changes owner before its operation resolves', async () => {
    const f = fixture(); f.emit(null)
    f.sdk.signInWithEmailAndPassword = async () => { f.emit(restored); return { user: restored } }
    expect(await f.session.login('a@example.test', 'password')).toEqual({ uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' })
    expect(f.users).toEqual([null, { uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' }])
  })
  it('rejects an in-flight result after stop and ignores its queued owner callback', async () => {
    const f = fixture(); f.emit(null)
    let finish
    f.sdk.signInWithEmailAndPassword = () => new Promise(resolve => { finish = resolve })
    const login = f.session.login('a@example.test', 'password')
    await Promise.resolve()
    const result = expect(login).rejects.toMatchObject({ code: 'auth/session-stopped' })
    f.session.stop(); f.emit(restored); finish({ user: restored })
    await result
    expect(f.users).toEqual([null])
  })
  it.each([
    ['login', 'signInWithEmailAndPassword', 'auth/operation-not-allowed'],
    ['register', 'createUserWithEmailAndPassword', 'auth/email-already-in-use'],
    ['resetPassword', 'sendPasswordResetEmail', 'auth/invalid-email'],
    ['signOut', 'signOut', 'auth/network-request-failed'],
  ])('exposes the original SDK %s error', async (operation, method, code) => {
    const f = fixture(), failure = Object.assign(new Error(code), { code })
    f.sdk[method] = async () => { throw failure }; f.emit(restored)
    await expect(f.session[operation]('a@example.test', 'password')).rejects.toBe(failure)
    expect(f.users).toHaveLength(1)
  })
  it('exposes profile update failure after registration', async () => {
    const f = fixture(), failure = Object.assign(new Error('profile'), { code: 'auth/network-request-failed' })
    f.sdk.updateProfile = async () => { throw failure }; f.emit(null)
    await expect(f.session.register('a@example.test', 'password', 'Ada')).rejects.toBe(failure)
    expect(failure.accountCreated).toBe(true)
    expect(failure.user).toEqual({ uid: 'uid-a', email: 'a@example.test', displayName: 'Ana' })
  })
  it('lets the SDK own reset and sign-out and does not synthesize a logout', async () => {
    const f = fixture(); f.emit(restored)
    await f.session.resetPassword('a@example.test'); await f.session.signOut()
    expect(f.calls).toEqual([['reset', f.auth, 'a@example.test'], ['signOut', f.auth]])
    expect(f.users).toHaveLength(1)
    f.emit(null); expect(f.users.at(-1)).toBeNull()
  })
  it('unsubscribes idempotently and ignores already queued callbacks after stop', async () => {
    const f = fixture(); f.emit(restored); await f.session.ready
    f.session.stop(); f.session.stop(); f.emit(null); f.emit({ uid: 'uid-b' })
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(f.users).toHaveLength(1)
    await expect(f.session.login('a@example.test', 'password')).rejects.toMatchObject({ code: 'auth/session-stopped' })
    expect(f.calls).toEqual([])
  })
  it('rejects pending readiness and operations on stop without accepting a late restored owner', async () => {
    const f = fixture(), login = f.session.login('a@example.test', 'password')
    const pending = expect(f.session.ready).rejects.toMatchObject({ code: 'auth/session-stopped' })
    const operation = expect(login).rejects.toMatchObject({ code: 'auth/session-stopped' })
    f.session.stop(); f.emit(restored)
    await pending; await operation
    expect(f.users).toEqual([]); expect(f.calls).toEqual([])
  })
  it('surfaces listener initialization errors through readiness', async () => {
    const f = fixture(), failure = new Error('persistence-failed')
    const result = expect(f.session.ready).rejects.toBe(failure)
    f.fail(failure); await result
    expect(f.users).toEqual([])
  })
  it('supports local mode and rejects account operations without any SDK use', async () => {
    const onUser = vi.fn(), session = createAuthSession({ client: null, onUser, sdk: {} })
    expect(await session.ready).toBeNull(); expect(onUser).not.toHaveBeenCalled()
    await expect(session.login('a@example.test', 'password')).rejects.toMatchObject({ code: 'auth/not-configured' })
    session.stop()
  })
})
