import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function filesUnder(dir, prefix = '') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? filesUnder(join(dir, item.name), prefix + item.name + '/') : [prefix + item.name]).sort()
}
export function checkCopy(dir, { mobile = true } = {}) {
  const problems = [], html = join(dir, 'index.html')
  if (!existsSync(html)) return [`${dir}: no index.html`]
  const text = readFileSync(html, 'utf8')
  if (mobile && !/<meta\s+name="opengym-flavor"\s+content="mobile"/.test(text))
    problems.push(`${dir}/index.html is not the mobile build (no opengym-flavor meta)`)
  for (const [, ref] of text.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g))
    if (!existsSync(join(dir, ref))) problems.push(`${dir}/index.html loads ${ref}, which is missing`)
  const sw = join(dir, 'sw.js')
  if (!existsSync(sw)) return [...problems, `${dir}: no sw.js`]
  const source = readFileSync(sw, 'utf8')
  if (source.includes('__BUILD__') || source.includes('__LAZY__')) problems.push(`${dir}/sw.js has unstamped placeholders`)
  let lazy = []
  try {
    const literal = source.match(/\bconst LAZY\s*=\s*("(?:[^"\\]|\\.)*")/)[1]
    lazy = JSON.parse(JSON.parse(literal))
    if (!Array.isArray(lazy) || lazy.some(p => typeof p !== 'string' || !/^\.\/assets\/[\w./-]+\.(?:js|css)$/.test(p) || p.includes('..'))) throw new Error('invalid lazy path')
  } catch { problems.push(`${dir}/sw.js has no valid lazy precache list`); lazy = [] }
  for (const file of filesUnder(join(dir, 'assets')).filter(p => /\.(?:js|css)$/.test(p)))
    if (!lazy.includes('./assets/' + file)) problems.push(`${dir}/assets/${file} missing from SW precache`)
  for (const file of lazy) if (!existsSync(join(dir, file))) problems.push(`${dir}/sw.js precaches missing ${file}`)
  return problems
}
export function checkMobileBundle(root, { ios = false } = {}) {
  const dist = join(root, 'dist'), copies = ['android/app/src/main/assets/public', ...(ios ? ['ios/App/App/public'] : [])]
  const problems = checkCopy(dist), original = filesUnder(dist)
  for (const copy of copies) {
    const dir = join(root, copy); problems.push(...checkCopy(dir))
    // Capacitor adds cordova.js/plugin files. Every Vite output must match exactly.
    for (const file of original) {
      const target = join(dir, file)
      if (!existsSync(target) || !readFileSync(join(dist, file)).equals(readFileSync(target))) problems.push(`${copy}/${file} differs from dist or is missing`)
    }
    for (const file of filesUnder(join(dir, 'assets'))) if (!original.includes('assets/' + file)) problems.push(`${copy}/assets/${file} is stale`)
  }
  return problems
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), root = resolve(args.find(arg => arg !== '--ios') || join(dirname(fileURLToPath(import.meta.url)), '..'))
  const problems = checkMobileBundle(root, { ios: args.includes('--ios') })
  if (problems.length) { for (const p of problems) console.error('✗ ' + p); process.exitCode = 1 }
  else console.log('Mobile bundle OK: dist and Android byte-identical' + (args.includes('--ios') ? ', iOS checked.' : '; iOS excluded (explicit --ios required).'))
}
