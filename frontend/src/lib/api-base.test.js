// @vitest-environment happy-dom
// Issue #238: openGym behind a reverse proxy that serves it under a subpath. The assets were
// already relative; the API call was not, so it went to the proxy's own root where nothing
// answers it. The base is read from where the app is being served.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { appBase } from './app-base.js'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = pathname => appBase({ pathname })

describe('the app knows where it is served from', () => {
  it('is the site root for an ordinary deployment', () => {
    expect(at('/')).toBe('/')
    expect(at('/index.html')).toBe('/')
  })

  it('keeps the proxy prefix of a subpath deployment', () => {
    expect(at('/myGym/')).toBe('/myGym/')
    expect(at('/myGym/index.html')).toBe('/myGym/')
    expect(at('/a/b/c/')).toBe('/a/b/c/')
  })

  it('drops a stale deep path rather than inventing a base from it', () => {
    // nginx sends these back to the app root before React boots; this is the belt and braces.
    expect(at('/myGym/plan/r/x')).toBe('/myGym/plan/r/')
    expect(at('/plan')).toBe('/')
  })

  it('survives a missing or odd location', () => {
    expect(appBase(null)).toBe('/')
    expect(at('')).toBe('/')
  })
})

// What the web container does with a request, read off web/nginx.conf.template itself.
// A path, not a URL: under happy-dom `URL` is the DOM's, which node:fs will not take.
const NGINX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../web/nginx.conf.template'), 'utf8')

it('serves static frontend without an API proxy or backend build dependency', () => {
  expect(NGINX.replace(/#.*$/gm, '')).not.toMatch(/proxy_pass|api_upstream/)
  const docker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../web/Dockerfile'), 'utf8')
  expect(docker).not.toMatch(/COPY api\//)
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) expect(docker.split('FROM nginx:')[0]).toContain('ARG VITE_FIREBASE_' + key)
})

// Each { } block's own directives, its nested blocks left out. Comments go first, and so do
// ${VAR} placeholders, whose braces are envsubst's, not nginx's.
function blocksOf(conf) {
  const out = [], stack = ['']
  for (const ch of conf.replace(/#.*$/gm, '').replace(/\$\{\w+\}/g, 'X')) {
    if (ch === '{') stack.push('')
    else if (ch === '}') out.push(stack.pop())
    else stack[stack.length - 1] += ch
  }
  return out
}

// An image keeps for 30 days, said by one Cache-Control: the one that can carry `immutable`.
// `expires` adds a Cache-Control of its own (and an Expires header) beside it.
describe('the cache lifetime nginx gives an image', () => {
  it('is said once, by the explicit header, with no expires beside it', () => {
    expect(NGINX.replace(/#.*$/gm, '')).not.toMatch(/\bexpires\b/)
    const media = blocksOf(NGINX).filter(b => /\bimmutable\b/.test(b))
    expect(media.length).toBe(1)
    expect(media[0]).toMatch(/\badd_header\s+Cache-Control\s+"public, max-age=2592000, immutable"\s*;/)
  })
})

// The template as nginx gets it for a given BASE_PATH, comments left out. Its PCRE patterns are
// valid JavaScript too, apart from \Q…\E (PCRE's quotes for literal text), which `quoted` turns
// into the same text escaped. Otherwise they run here the way nginx runs them.
const render = base => NGINX.replace(/#.*$/gm, '').replace(/\$\{BASE_PATH\}/g, base).replace(/\$\{\w+\}/g, 'X')
const quoted = pattern => pattern.replace(/\\Q([\s\S]*?)(?:\\E|$)/g, (_, text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))

// Under BASE_PATH every static location takes the prefix off with a rewrite before it looks on
// disk. Read as a pattern, BASE_PATH=/g+ym never matched /g+ym itself: /g+ym/ was not found, went
// to @root, and @root sent it back to /g+ym/, forever; the assets and images 404'd.
describe('the file nginx looks for under BASE_PATH', () => {
  const REWRITE = /\brewrite\s+(\S+)\s+(\S+)\s+break\s*;/g
  // All three rewrites (the app's prefix block and the two cache blocks) give the same answer.
  function onDisk(base, uri) {
    const got = [...render(base).matchAll(REWRITE)].map(([, pattern, to]) => {
      const m = new RegExp(quoted(pattern)).exec(uri)
      return m ? to.replace(/\$(\d)/g, (_, i) => m[i]) : uri
    })
    expect(got.length).toBe(3)
    expect(new Set(got).size).toBe(1)
    return got[0]
  }

  it('takes the prefix off, so the shell at the prefix is found rather than redirected to itself', () => {
    expect(onDisk('/g+ym', '/g+ym/')).toBe('/')
    expect(onDisk('/g+ym', '/g+ym/assets/index.js')).toBe('/assets/index.js')
    expect(onDisk('/g+ym', '/g+ym/icon-180.png')).toBe('/icon-180.png')
    expect(onDisk('/gym', '/gym/icon-180.png')).toBe('/icon-180.png')
    expect(onDisk('/a/b', '/a/b/index.html')).toBe('/index.html')
  })

  it('reads BASE_PATH as text, not as a pattern', () => {
    expect(onDisk('/g.ym', '/g.ym/assets/index.js')).toBe('/assets/index.js')
    expect(onDisk('/g.ym', '/gXym/assets/index.js')).toBe('/gXym/assets/index.js')
    expect(onDisk('/gym', '/gymnasium/index.js')).toBe('/gymnasium/index.js')
  })

  it('changes nothing at the site root', () => {
    for (const uri of ['/', '/index.html', '/assets/index.js', '/icon-180.png', '//x.js'])
      expect(onDisk('', uri)).toBe(uri)
  })
})

// nginx's automatic /api -> /api/ redirect was absolute, built from its own scheme and port:
// http://host:8080/api/, unreachable behind an https proxy. Relative is set once for the whole
// server, so no location can leave it out.
describe('the redirects nginx sends', () => {
  it('carry a relative Location, for every location', () => {
    const [server] = blocksOf(NGINX).filter(b => /\blisten\b/.test(b))
    expect(server).toMatch(/\babsolute_redirect\s+off\s*;/)
    expect(NGINX.replace(/#.*$/gm, '')).not.toMatch(/\babsolute_redirect\s+on\b/)
  })
})

// A BASE_PATH of "/gym/" or "gym" renders location prefixes nginx never matches: the container
// came up and 404'd under the prefix, silently. The web image now refuses to start on one, from a
// script nginx's entrypoint runs before it renders the template. Run here with sh, as it is there.
describe('the web container refuses a BASE_PATH it cannot serve', () => {
  const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../../web')
  // Windows has no POSIX sh on PATH; Git Bash runs the same container script.
  const shell = process.platform === 'win32'
    ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe')
    : 'sh'
  const check = value => {
    const env = { PATH: process.env.PATH }
    if (value !== undefined) env.BASE_PATH = value
    return spawnSync(shell, [join(WEB, '05-check-base-path.sh')], { env, encoding: 'utf8' })
  }

  it.each([[undefined], [''], ['/gym'], ['/a/b'], ['/g+ym']])('starts with BASE_PATH=%s', value => {
    const r = check(value)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it.each([['/gym/', 'ends with "/"'], ['/', 'ends with "/"'], ['gym', 'does not start with "/"'], ['gym/', 'ends with "/"']])(
    'refuses BASE_PATH=%s, and says why', (value, why) => {
      const r = check(value)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(`BASE_PATH="${value}" ${why}`)
      expect(r.stderr).toContain('BASE_PATH=/gym')
    })

  it('is installed where the entrypoint runs it, and executable', () => {
    expect(readFileSync(join(WEB, '05-check-base-path.sh'), 'utf8')).not.toContain('\r')
    // Not executable, the entrypoint skips it with a log line and nginx starts anyway. Its 05
    // sorts before 20-envsubst-on-templates.sh, nginx's own step that renders the template.
    const dockerfile = readFileSync(join(WEB, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/^COPY --chmod=755 web\/05-check-base-path\.sh \/docker-entrypoint\.d\/$/m)
  })
})
