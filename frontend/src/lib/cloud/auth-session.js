import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, signOut } from 'firebase/auth'

const sdkDefault = { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, signOut }
const userInfo = user => user ? { uid: user.uid, email: user.email ?? null, displayName: user.displayName ?? null } : null
const sessionError = code => Object.assign(new Error(code), { code })

/** SDK owns persistence and tokens; the store adds its legacy `id = uid` alias separately.
 * ready/login/register expose only {uid,email,displayName}, never a Firebase credential.
 * Only confirmed SDK listener events change the consumer's current owner.
 */
export function createAuthSession({ client, onUser, sdk = sdkDefault }) {
  let stopped = false, settled = false, unsubscribe = () => {}, resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Stopping an unused session must not create an unhandled rejection; callers still receive it.
  ready.catch(() => {})
  if (!client) { settled = true; resolveReady(null) }
  else {
    unsubscribe = sdk.onAuthStateChanged(client.auth, user => {
      if (stopped) return
      const normalized = userInfo(user)
      if (!settled) { settled = true; resolveReady(normalized) }
      onUser?.(normalized)
    }, error => {
      if (stopped || settled) return
      settled = true; rejectReady(error)
    })
  }
  function assertActive() {
    if (stopped) throw sessionError('auth/session-stopped')
    if (!client) throw sessionError('auth/not-configured')
  }
  async function run(action) {
    assertActive()
    await ready
    assertActive()
    const result = await action()
    assertActive()
    return result
  }
  return {
    ready,
    login: (email, password) => run(async () => userInfo((await sdk.signInWithEmailAndPassword(client.auth, email, password)).user)),
    register: (email, password, displayName) => run(async () => {
      const { user } = await sdk.createUserWithEmailAndPassword(client.auth, email, password)
      if (displayName !== undefined) {
        assertActive()
        try { await sdk.updateProfile(user, { displayName }) }
        catch (error) {
          // Account creation already succeeded. Preserve the SDK error and expose the usable identity.
          error.accountCreated = true; error.user = userInfo(user)
          throw error
        }
      }
      return userInfo(user)
    }),
    resetPassword: email => run(() => sdk.sendPasswordResetEmail(client.auth, email)),
    signOut: () => run(() => sdk.signOut(client.auth)),
    stop() {
      if (stopped) return
      stopped = true; unsubscribe()
      if (!settled) { settled = true; rejectReady(sessionError('auth/session-stopped')) }
    },
  }
}
