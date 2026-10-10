import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { lazyAssets, stampSw } from './sw-stamp.mjs'
import { checkMobileBundle } from './check-mobile-bundle.mjs'

test('mobile runner uses Node entrypoints with explicit environment on every platform', async () => {
  assert.ok(existsSync(new URL('./build-mobile.mjs', import.meta.url)), 'cross-platform runner exists')
  const { buildMobile } = await import('./build-mobile.mjs')
  const calls = [], env = { PATH: 'keep', VITE_FIREBASE_PROJECT_ID: 'public-project' }
  assert.equal(buildMobile({ root: resolve('fixture'), env, spawn: (...args) => { calls.push(args); return { status: 0 } } }), 0)
  assert.equal(calls.length, 3)
  for (const [command, , options] of calls) {
    assert.equal(command, process.execPath); assert.equal(options.shell, false)
    assert.equal(options.env.VITE_MOBILE, '1'); assert.equal(options.env.PATH, 'keep')
    assert.equal(options.env.VITE_FIREBASE_PROJECT_ID, 'public-project')
    assert.match(options.env.VITE_IMG_BASE, /7455efae41b330c265e7cd4b78dfa848e7ce5ebd\/images\/$/)
    assert.match(options.env.VITE_GIF_BASE, /7455efae41b330c265e7cd4b78dfa848e7ce5ebd\/videos\/$/)
  }
  assert.deepEqual(calls[1][1].slice(1), ['sync', 'android'])
  assert.deepEqual(env, { PATH: 'keep', VITE_FIREBASE_PROJECT_ID: 'public-project' })
})
test('runner stops at first failed command and preserves exit code; signals and spawn errors fail', async () => {
  assert.ok(existsSync(new URL('./build-mobile.mjs', import.meta.url)), 'cross-platform runner exists')
  const { buildMobile } = await import('./build-mobile.mjs')
  for (const outcome of [{ status: 7 }, { status: null, signal: 'SIGTERM' }, { error: new Error('spawn') }]) {
    let count = 0
    const code = buildMobile({ spawn: () => { count++; return outcome } })
    assert.equal(code, outcome.status || 1); assert.equal(count, 1)
  }
})
test('all retained lazy JS and CSS includes locale, instruction and name packs', () => {
  const bundle = Object.fromEntries(['locales', 'instr', 'exercise-names'].map(name => [`assets/${name}.js`, { type: 'chunk', moduleIds: [`/src/${name}/pt.js`] }]))
  bundle['assets/main.css'] = { type: 'asset' }; bundle['icon.svg'] = { type: 'asset' }
  assert.deepEqual(lazyAssets(bundle), ['assets/exercise-names.js', 'assets/instr.js', 'assets/locales.js', 'assets/main.css'].map(p => './' + p))
})
test('manifest contains exact Firebase, no retired vault or AI SDK and cross-platform mobile command', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  assert.equal(pkg.dependencies.firebase, '12.19.0')
  assert.equal(pkg.dependencies['@aparajita/capacitor-secure-storage'], undefined)
  assert.equal(pkg.scripts['build:mobile'], 'node scripts/build-mobile.mjs')
  assert.equal(pkg.overrides['@firebase/firestore@4.17.2']['@grpc/grpc-js'], '1.13.6')
})
test('actual Android assets must match dist and include every lazy chunk; iOS is explicit opt-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-mobile-'))
  const write = (name, body) => { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), body) }
  const sw = stampSw("const CACHE='__BUILD__'; const LAZY = '__LAZY__'", { stamp: '123', lazy: ['./assets/main.js', './assets/locale.js'] })
  const files = { 'index.html': '<meta name="opengym-flavor" content="mobile"><script src="./assets/main.js"></script>', 'assets/main.js': 'main', 'assets/locale.js': 'locale', 'sw.js': sw }
  try {
    for (const prefix of ['dist', 'android/app/src/main/assets/public']) for (const [name, bytes] of Object.entries(files)) write(prefix + '/' + name, bytes)
    write('ios/App/App/public/index.html', 'stale iOS intentionally not synced on Windows')
    assert.deepEqual(checkMobileBundle(root), [])
    write('android/app/src/main/assets/public/assets/locale.js', 'stale')
    assert.ok(checkMobileBundle(root).some(s => /differs|stale/.test(s)), 'stale Android lazy bytes must fail')
    write('android/app/src/main/assets/public/assets/locale.js', 'locale')
    write('dist/sw.js', stampSw("const CACHE='__BUILD__'; const LAZY = '__LAZY__'", { stamp: '123', lazy: ['./assets/main.js'] }))
    assert.ok(checkMobileBundle(root).some(s => /locale.js.*precache|precache.*locale.js/.test(s)), 'missing lazy precache must fail')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
