import { initializeApp } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore'
import { EMULATOR_PROJECT_ID, AUTH_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST } from './model.js'

const sdkDefault = {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  connectAuthEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, connectFirestoreEmulator,
}
const clients = new WeakMap()

/** Read public Firebase configuration only. Incomplete configuration keeps local mode. */
export function readFirebaseConfig(env = import.meta.env) {
  const options = {}
  for (const [option, key] of Object.entries({ apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', appId: 'APP_ID' })) {
    const value = env?.[`VITE_FIREBASE_${key}`]
    if (typeof value === 'string' && value.trim()) options[option] = value.trim()
  }
  return { configured: Object.keys(options).length === 4, options }
}

/** Initialize once, before any Auth/Firestore operations. SDK cache supplements the app archive. */
export function createFirebaseClient({ config, emulator = false, sdk = sdkDefault }) {
  // DEV comes from Vite, never from user-supplied Firebase options or NODE_ENV at runtime.
  if (emulator && (import.meta.env?.DEV !== true || config?.options?.projectId !== EMULATOR_PROJECT_ID)) throw new Error('unsafe-firebase-emulator')
  if (!config?.configured) return null
  const options = { ...config.options }
  const signature = JSON.stringify([options.apiKey, options.authDomain, options.projectId, options.appId, emulator])
  const previous = clients.get(sdk)
  if (previous) {
    if (previous.signature !== signature) throw new Error('firebase-client-config-mismatch')
    return previous.client
  }
  const browser = typeof window !== 'undefined'
  const app = sdk.initializeApp(options, 'opengym')
  const auth = sdk.initializeAuth(app, {
    persistence: browser ? [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence] : sdk.inMemoryPersistence,
  })
  if (emulator) sdk.connectAuthEmulator(auth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  const localCache = browser && typeof indexedDB !== 'undefined' && !emulator
    ? sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() })
    : sdk.memoryLocalCache()
  const db = sdk.initializeFirestore(app, { localCache })
  if (emulator) {
    const [host, port] = FIRESTORE_EMULATOR_HOST.split(':')
    sdk.connectFirestoreEmulator(db, host, Number(port))
  }
  const client = { app, auth, db }
  clients.set(sdk, { signature, client })
  return client
}
