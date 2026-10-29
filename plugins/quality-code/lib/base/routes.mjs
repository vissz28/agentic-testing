// Is this path a screen of the app? Read from the router the code declares (React Router, Vue Router, Angular, a routes
// array) and from the folders of a file-based router (Next, Nuxt, SvelteKit, Remix). Files are only read, never run.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.svelte-kit', 'e2e', 'e2e-tests', 'test', 'tests', '__tests__', 'cypress'])
const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/
const TEST = /\.(?:spec|test|cy)\.[^/]+$/
const PATH_DECL = /\bpath\s*[=:]\s*\{?\s*(['"`])([^'"`\n$]*)\1/g
const FILE_ROUTERS = ['src/pages', 'pages', 'src/routes', 'routes', 'app/routes', 'src/app', 'app']
const MAX_FILES = 6000
const MAX_BYTES = 400_000

const segs = p => String(p).split(/[?#]/)[0].split('/').filter(Boolean)
const isParam = s => /^(?::|\[|\*|\{)/.test(s) || s === '*'

/** True when the requested segments fit a declared pattern ("/orders/:id" fits "/orders/12"). */
export function fits(pattern, route) {
  const p = segs(pattern), r = segs(route)
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*' || /^\[\.\.\./.test(p[i])) return true
    if (i >= r.length) return p.slice(i).every(s => /^:.*\?$/.test(s) || /^\[\[/.test(s))
    if (!isParam(p[i]) && p[i].toLowerCase() !== r[i].toLowerCase()) return false
  }
  return p.length === r.length
}

function* walk(root, rel, budget) {
  let entries = []
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (budget.n <= 0) return
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) yield* walk(root, p, budget) }
    else if (CODE.test(e.name) && !TEST.test(e.name)) { budget.n--; yield p }
  }
}

/** The routes the code declares: { declared: [pattern], pieces: [relative piece], fileBased: [pattern] }. */
export function declaredRoutes(root) {
  const declared = new Set(), pieces = new Set(), fileBased = new Set()
  const budget = { n: MAX_FILES }
  for (const f of walk(root, '', budget)) {
    let src = ''
    try { if (statSync(join(root, f)).size > MAX_BYTES) continue; src = readFileSync(join(root, f), 'utf8') } catch { continue }
    for (const m of src.matchAll(PATH_DECL)) {
      const v = m[2].trim()
      if (!v || /\s/.test(v) || /^(?:https?:)?\/\//.test(v) || /[\\^]/.test(v) && !v.startsWith('/')) continue
      // A nested route is written relative to its parent: keep both the whole and the piece.
      ;(v.startsWith('/') ? declared : pieces).add(v)
    }
  }
  // File-based routers: pages/orders/[id].jsx → /orders/[id]; app/orders/page.tsx → /orders
  for (const dir of FILE_ROUTERS) {
    const abs = join(root, dir)
    let isDir = false
    try { isDir = statSync(abs).isDirectory() } catch {}
    if (!isDir) continue
    for (const f of walk(root, dir, { n: MAX_FILES })) {
      const parts = relative(abs, join(root, f)).split(sep).join('/').replace(/\.[^.]+$/, '').split('/')
      const last = parts.at(-1)
      if (dir.endsWith('app') && last !== 'page' && last !== '+page') continue
      if (/^_|^layout$|^api$/.test(last) && parts[0] !== 'api') continue
      const clean = parts.filter(s => s !== 'page' && s !== '+page' && s !== 'index' && !/^\(.*\)$/.test(s))
      fileBased.add(`/${clean.join('/')}`)
    }
  }
  return { declared: [...declared], pieces: [...pieces], fileBased: [...fileBased] }
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/**
 * { status, matches, suggestions }: found (a declared path or file route fits), likely (every segment is a declared piece of
 * a nested route), not_found (the router is known and does not have it), unknown (no router declarations were found).
 */
export function checkRoute(root, route, found = declaredRoutes(root)) {
  const r = `/${segs(route).join('/')}`
  const all = [...found.declared, ...found.fileBased]
  if (!all.length && !found.pieces.length) return { status: 'unknown', route: r, matches: [], suggestions: [] }
  const matches = all.filter(p => fits(p, r))
  if (matches.length) return { status: 'found', route: r, matches, suggestions: [] }
  const rs = segs(r)
  const pieceSegs = new Set(found.pieces.flatMap(p => segs(p).map(s => s.toLowerCase())).concat(all.flatMap(p => segs(p).map(s => s.toLowerCase()))))
  if (rs.length && rs.every(s => pieceSegs.has(s.toLowerCase()) || /^\d+$/.test(s) || /^[0-9a-f-]{8,}$/i.test(s))) return { status: 'likely', route: r, matches: [], suggestions: [] }
  const pool = [...new Set([...all, ...found.pieces.map(p => `/${segs(p).join('/')}`)])]
  const suggestions = pool.map(p => [p, lev(p.toLowerCase(), r.toLowerCase())]).sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, d]) => d <= Math.max(4, Math.floor(r.length / 2))).map(([p]) => p)
  return { status: 'not_found', route: r, matches: [], suggestions }
}
