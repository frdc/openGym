import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCopy, filesUnder } from './check-mobile-bundle.mjs'

// Vite/Rolldown may print simple public config strings as template literals.
// Keep exact delimiters; interpolated or merely matching substrings are not evidence.
const containsConfig = (code, value) => code.includes(JSON.stringify(value))
  || (/^[A-Za-z0-9._:/-]+$/.test(value) && code.includes('`' + value + '`'))
export function checkCloudBundle(root) {
  const dist = join(root, 'dist'), problems = checkCopy(dist, { mobile: false })
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.dependencies?.firebase !== '12.19.0') problems.push('Firebase must remain pinned to reviewed 12.19.0')
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
    if (/secure-storage|anthropic|openai|generative-ai|modelcontextprotocol/.test(name)) problems.push(`retired dependency: ${name}`)
  const files = filesUnder(dist).filter(p => /\.(?:js|html|css)$/.test(p))
  const code = files.filter(p => p.endsWith('.js')).map(p => readFileSync(join(dist, p), 'utf8')).join('\n')
  for (const file of files) {
    const text = readFileSync(join(dist, file), 'utf8')
    if (/\/api\/(?:coach|data|pair|auth|media|me\b)|installApk|opengym-remote\.json|api\.anthropic\.com|api\.openai\.com|gitlab\.com\/api\/v4\/projects/.test(text))
      problems.push(`${file}: retired runtime in artifact`)
  }
  for (const file of filesUnder(join(root, 'src')).filter(p => /\.[cm]?jsx?$/.test(p) && !/\.test\./.test(p))) {
    const text = readFileSync(join(root, 'src', file), 'utf8')
    if (/(?:from\s*|import\s*\(?\s*)['"][^'"]*(?:\/coach(?:-[\w-]+)?\.js|\/api\/coach\/|\/(?:api|remote|update|push)\.js)['"]/.test(text))
      problems.push(`${file}: retired import`)
  }
  const metadata = join(dist, 'cloud-build.json')
  if (!existsSync(metadata)) problems.push('missing cloud-build.json: rebuild adapted frontend')
  else {
    const build = JSON.parse(readFileSync(metadata, 'utf8')), keys = ['apiKey', 'authDomain', 'projectId', 'appId']
    if (build.demo) problems.push('demo artifact is not ordinary cloud/local build evidence')
    if (!['local', 'firebase'].includes(build.mode)) problems.push('invalid build mode')
    if (build.mode === 'firebase' && keys.some(k => typeof build.firebase?.[k] !== 'string' || !build.firebase[k].trim() || !containsConfig(code, build.firebase[k])))
      problems.push('Firebase public config missing from compiled artifact')
    if (build.mode === 'local' && Object.keys(build.firebase || {}).length) problems.push('incomplete Firebase public config; supply all four values or none')
  }
  if (!code.includes('firestore.googleapis.com')) problems.push('official Firebase Firestore runtime absent from artifact')
  return problems
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))
  const problems = checkCloudBundle(root)
  if (problems.length) { for (const p of problems) console.error('✗ ' + p); process.exitCode = 1 }
  else console.log('Cloud bundle OK: adapted static artifact, public build config, dependencies and all SW code chunks checked.')
}
