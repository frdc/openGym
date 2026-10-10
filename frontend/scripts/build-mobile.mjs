import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd'

// JS entrypoints avoid POSIX assignments, .cmd shells and quoting differences.
// Android is the validated target. See docs/MOBILE.md for explicit iOS sync/check.
export function buildMobile({ root = frontend, env = process.env, spawn = spawnSync } = {}) {
  const mobileEnv = { ...env, VITE_MOBILE: '1', VITE_IMG_BASE: catalog + '/images/', VITE_GIF_BASE: catalog + '/videos/' }
  const commands = [
    [join(root, 'node_modules/vite/bin/vite.js'), 'build'],
    [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'],
    [join(root, 'scripts/check-mobile-bundle.mjs'), root],
  ]
  for (const args of commands) {
    const result = spawn(process.execPath, args, { cwd: root, env: mobileEnv, stdio: 'inherit', shell: false })
    if (result.error || result.signal || result.status !== 0) return result.status || 1
  }
  return 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = buildMobile()
