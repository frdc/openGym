import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteApp } from 'firebase/app'
import { createFirebaseClient, readFirebaseConfig } from './firebase-client.js'
import { createAuthSession } from './auth-session.js'

const env = {
  VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-opengym.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-opengym', VITE_FIREBASE_APP_ID: 'demo-app-id',
}
const config = () => readFirebaseConfig(env)
function fakeSdk() {
  const calls = [], app = {}, auth = {}, db = {}
  return {
    calls, app, auth, db,
    indexedDBLocalPersistence: 'indexeddb-auth', browserLocalPersistence: 'local-auth', inMemoryPersistence: 'memory-auth',
    initializeApp(options, name) { calls.push(['app', options, name]); return app },
    initializeAuth(value, options) { calls.push(['auth', value, options]); return auth },
    initializeFirestore(value, options) { calls.push(['firestore', value, options]); return db },
    memoryLocalCache() { return 'memory-cache' },
    persistentMultipleTabManager() { return 'multiple-tabs' },
    persistentLocalCache(options) { calls.push(['persistent-cache', options]); return 'persistent-cache' },
    connectAuthEmulator(value, url, options) { calls.push(['auth-emulator', value, url, options]) },
    connectFirestoreEmulator(value, host, port) { calls.push(['firestore-emulator', value, host, port]) },
  }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Firebase configuration and initialization', () => {
  it('keeps empty and incomplete public configuration local without initializing SDK', () => {
    const sdk = fakeSdk()
    expect(readFirebaseConfig({})).toEqual({ configured: false, options: {} })
    expect(readFirebaseConfig({ VITE_FIREBASE_API_KEY: 'key' }).configured).toBe(false)
    expect(createFirebaseClient({ config: readFirebaseConfig({}), sdk })).toBeNull()
    expect(sdk.calls).toEqual([])
  })
  it('reads only public App/Auth/Firestore options and trims their values', () => {
    expect(readFirebaseConfig({ ...env, VITE_FIREBASE_API_KEY: ' demo-api-key ', SECRET: 'never', VITE_FIREBASE_STORAGE_BUCKET: 'unused' })).toEqual({
      configured: true, options: { apiKey: 'demo-api-key', authDomain: 'demo-opengym.firebaseapp.com', projectId: 'demo-opengym', appId: 'demo-app-id' },
    })
  })
  it('reuses one client and rejects changing its project or emulator target', () => {
    vi.stubEnv('DEV', true)
    const sdk = fakeSdk(), first = createFirebaseClient({ config: config(), sdk })
    expect(createFirebaseClient({ config: config(), sdk })).toBe(first)
    expect(sdk.calls.map(c => c[0])).toEqual(['app', 'auth', 'firestore'])
    expect(() => createFirebaseClient({ config: readFirebaseConfig({ ...env, VITE_FIREBASE_PROJECT_ID: 'another' }), sdk })).toThrow('firebase-client-config-mismatch')
    expect(() => createFirebaseClient({ config: config(), emulator: true, sdk })).toThrow('firebase-client-config-mismatch')
    expect(sdk.calls).toHaveLength(3)
  })
  it('uses memory persistence/cache in Node so tests never rely on browser storage', () => {
    const sdk = fakeSdk()
    createFirebaseClient({ config: config(), sdk })
    expect(sdk.calls[1]).toEqual(['auth', sdk.app, { persistence: sdk.inMemoryPersistence }])
    expect(sdk.calls[2]).toEqual(['firestore', sdk.app, { localCache: 'memory-cache' }])
  })
  it('uses official persistent browser Auth and supplemental multiple-tab Firestore cache', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('indexedDB', {})
    const sdk = fakeSdk()
    createFirebaseClient({ config: config(), sdk })
    expect(sdk.calls[1]).toEqual(['auth', sdk.app, { persistence: ['indexeddb-auth', 'local-auth'] }])
    expect(sdk.calls[2]).toEqual(['persistent-cache', { tabManager: 'multiple-tabs' }])
    expect(sdk.calls[3]).toEqual(['firestore', sdk.app, { localCache: 'persistent-cache' }])
  })
  it('falls back to supplemental memory cache when browser IndexedDB is unavailable', () => {
    vi.stubGlobal('window', {})
    const sdk = fakeSdk()
    createFirebaseClient({ config: config(), sdk })
    expect(sdk.calls.at(-1)).toEqual(['firestore', sdk.app, { localCache: 'memory-cache' }])
  })
  it.each([
    [false, 'demo-opengym'], [true, 'workout-tracker-e0c6c'], [true, 'another'],
  ])('rejects unsafe emulator mode before initializing or connecting (dev=%s, project=%s)', (dev, projectId) => {
    vi.stubEnv('DEV', dev)
    const sdk = fakeSdk()
    expect(() => createFirebaseClient({ config: readFirebaseConfig({ ...env, VITE_FIREBASE_PROJECT_ID: projectId }), emulator: true, sdk })).toThrow('unsafe-firebase-emulator')
    expect(sdk.calls).toEqual([])
  })
  it('connects demo emulators only in DEV and uses memory Firestore cache', () => {
    vi.stubEnv('DEV', true); vi.stubGlobal('window', {}); vi.stubGlobal('indexedDB', {})
    const sdk = fakeSdk()
    expect(createFirebaseClient({ config: config(), emulator: true, sdk })).toEqual({ app: sdk.app, auth: sdk.auth, db: sdk.db })
    expect(sdk.calls.map(c => c[0])).toEqual(['app', 'auth', 'auth-emulator', 'firestore', 'firestore-emulator'])
    expect(sdk.calls[2]).toEqual(['auth-emulator', sdk.auth, 'http://127.0.0.1:9099', { disableWarnings: true }])
    expect(sdk.calls[3]).toEqual(['firestore', sdk.app, { localCache: 'memory-cache' }])
    expect(sdk.calls[4]).toEqual(['firestore-emulator', sdk.db, '127.0.0.1', 8081])
  })
  it('exposes SDK initialization errors unchanged', () => {
    const sdk = fakeSdk(), failure = new Error('storage-unavailable')
    sdk.initializeAuth = () => { throw failure }
    expect(() => createFirebaseClient({ config: config(), sdk })).toThrow(failure)
  })
  it('loads the actual modular SDK in Node without requests or browser cache', async () => {
    const client = createFirebaseClient({ config: config() })
    expect(client.app.options.projectId).toBe('demo-opengym')
    expect(client.auth.app).toBe(client.app)
    expect(client.db.app).toBe(client.app)
    const users = [], session = createAuthSession({ client, onUser: user => users.push(user) })
    expect(await session.ready).toBeNull()
    expect(users).toEqual([null])
    expect(client.auth.currentUser).toBeNull()
    session.stop()
    await deleteApp(client.app)
  })
})
