import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stampSw } from './sw-stamp.mjs'

test('checker rejects an old backend bundle and validates retained static artifacts/config/dependencies', async () => {
  assert.ok(existsSync(new URL('./check-cloud-bundle.mjs', import.meta.url)), 'cloud artifact checker exists')
  const { checkCloudBundle } = await import('./check-cloud-bundle.mjs')
  const root = mkdtempSync(join(tmpdir(), 'cloud-check-'))
  const write = (path, value) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), value) }
  const pkg = { dependencies: { firebase: '12.19.0' } }
  try {
    write('package.json', JSON.stringify(pkg)); write('dist/index.html', '<script src="./assets/main.js"></script>')
    write('dist/cloud-build.json', JSON.stringify({ mode: 'local', firebase: {}, demo: false }))
    write('dist/sw.js', stampSw("const CACHE='__BUILD__'; const LAZY = '__LAZY__'", { stamp: 'ok', lazy: ['./assets/main.js'] }))
    write('dist/assets/main.js', "fetch('/api/coach/chat'); fetch('/api/data'); installApk('https://gitlab.com/old/releases/app.apk')")
    assert.ok(checkCloudBundle(root).some(s => /retired runtime/.test(s)), 'old runtime fixture must fail')
    write('dist/assets/main.js', 'firestore.googleapis.com; historical Coach-authored training remains recoverable')
    assert.deepEqual(checkCloudBundle(root), [])
    write('src/main.js', "import './lib/coach-api.js'")
    assert.ok(checkCloudBundle(root).some(s => /retired import/.test(s)))
    write('src/main.js', "import './lib/history.js'")
    pkg.dependencies['@aparajita/capacitor-secure-storage'] = '7.1.6'; write('package.json', JSON.stringify(pkg))
    assert.ok(checkCloudBundle(root).some(s => /retired dependency/.test(s)))
    delete pkg.dependencies['@aparajita/capacitor-secure-storage']; write('package.json', JSON.stringify(pkg))
    write('dist/cloud-build.json', JSON.stringify({ mode: 'firebase', firebase: { apiKey: 'key', authDomain: 'domain', projectId: 'project', appId: 'app' }, demo: false }))
    assert.ok(checkCloudBundle(root).some(s => /public config/.test(s)), 'metadata alone does not prove compiled config')
    write('dist/assets/main.js', 'firestore.googleapis.com; "key"; "domain"; "project"; "app"')
    assert.deepEqual(checkCloudBundle(root), [])
    // Vite 8 emits these simple public values as template literals in a real build.
    write('dist/assets/main.js', 'firestore.googleapis.com; `key`; `domain`; `project`; `app`')
    assert.deepEqual(checkCloudBundle(root), [], 'compiled template literals carry the configured values')
    write('dist/assets/main.js', 'firestore.googleapis.com; `key-extra`; `domain`; `project`; `app`')
    assert.ok(checkCloudBundle(root).some(s => /public config/.test(s)), 'a substring is not the configured literal')
    write('dist/assets/main.js', 'firestore.googleapis.com; `key${suffix}`; `domain`; `project`; `app`')
    assert.ok(checkCloudBundle(root).some(s => /public config/.test(s)), 'interpolated text is not a static configured literal')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
