// Checks a path against declared routes and file-based routers (Next, Nuxt, SvelteKit, Remix). Reads files, never runs them.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { collapseSpaces, localToForwardSlashes } from '../core/text.mjs'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.svelte-kit', 'e2e', 'e2e-tests', 'test', 'tests', '__tests__', 'cypress'])
const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/
const TEST = /\.(?:spec|test|cy)\.[^/]+$/
const PATH_DECL = /\bpath\s*[=:]\s*\{?\s*(['"`])([^'"`\n$]*)\1/g
const FILE_ROUTERS = ['src/pages', 'pages', 'src/routes', 'routes', 'app/routes', 'src/app', 'app']
const MAX_FILES = 6000
const MAX_BYTES = 400_000
// Hash routers put the route after #: /#/orders, not /orders.
const HASH = /\b(?:HashRouter|createHashRouter|createWebHashHistory|createHashHistory|withHashLocation)\b|\buseHash\s*:\s*true\b|\bmode\s*:\s*['"]hash['"]/
// A literal router base: <BrowserRouter basename="/app">, createWebHistory('/app/'). A variable one cannot be read.
const BASE = /\b(?:basename\s*[=:]\s*\{?\s*|createWeb(?:Hash)?History\(\s*)(['"`])(\/[^'"`\n$]*)\1/

const segs = p => String(p).split(/[?#]/)[0].split('/').filter(Boolean)
const isParam = s => /^(?::|\[|\*|\{)/.test(s) || s === '*'

/** "/orders/:id" fits "/orders/12". */
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

export function declaredRoutes(root) {
  const declared = new Set(), pieces = new Set(), fileBased = new Set()
  let hash = false, base = ''
  const budget = { n: MAX_FILES }
  for (const f of walk(root, '', budget)) {
    let src = ''
    try { if (statSync(join(root, f)).size > MAX_BYTES) continue; src = readFileSync(join(root, f), 'utf8') } catch { continue }
    hash ||= HASH.test(src)
    base ||= (src.match(BASE)?.[2] ?? '').replace(/\/+$/, '')
    for (const m of src.matchAll(PATH_DECL)) {
      const v = m[2].trim()
      if (!v || /\s/.test(v) || /^(?:https?:)?\/\//.test(v) || /[\\^]/.test(v) && !v.startsWith('/')) continue
      // Relative paths are nested-route pieces.
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
      const parts = localToForwardSlashes(relative(abs, join(root, f))).replace(/\.[^.]+$/, '').split('/')
      const last = parts.at(-1)
      if (dir.endsWith('app') && last !== 'page' && last !== '+page') continue
      if (/^_|^layout$|^api$/.test(last) && parts[0] !== 'api') continue
      const clean = parts.filter(s => s !== 'page' && s !== '+page' && s !== 'index' && !/^\(.*\)$/.test(s))
      fileBased.add(`/${clean.join('/')}`)
    }
  }
  return { declared: [...declared], pieces: [...pieces], fileBased: [...fileBased], hash, base }
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** status: found, likely (every segment is a nested-route piece), not_found, or unknown (no router found).
 * url is what the browser opens: the base, then /# for a hash router, then the route. */
export function checkRoute(root, route, found = declaredRoutes(root)) {
  const { hash = false, base = '' } = found
  // Typed as the browser shows it (/app/#/orders): keep only the route.
  let typed = String(route)
  if (base && typed.toLowerCase().startsWith(`${base.toLowerCase()}/`)) typed = typed.slice(base.length)
  typed = typed.replace(/^\/?#(?=\/|$)/, '')
  const r = `/${segs(typed).join('/')}`
  const rest = typed.match(/[?#].*$/)?.[0] ?? ''
  const at = { route: r, url: `${base}${hash ? '/#' : ''}${r}${rest}`, hash, base }
  const all = [...found.declared, ...found.fileBased]
  if (!all.length && !found.pieces.length) return { status: 'unknown', ...at, matches: [], suggestions: [] }
  const matches = all.filter(p => fits(p, r))
  if (matches.length) return { status: 'found', ...at, matches, suggestions: [] }
  const rs = segs(r)
  const pieceSegs = new Set(found.pieces.flatMap(p => segs(p).map(s => s.toLowerCase())).concat(all.flatMap(p => segs(p).map(s => s.toLowerCase()))))
  if (rs.length && rs.every(s => pieceSegs.has(s.toLowerCase()) || /^\d+$/.test(s) || /^[0-9a-f-]{8,}$/i.test(s))) return { status: 'likely', ...at, matches: [], suggestions: [] }
  const pool = [...new Set([...all, ...found.pieces.map(p => `/${segs(p).join('/')}`)])]
  const suggestions = pool.map(p => [p, lev(p.toLowerCase(), r.toLowerCase())]).sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, d]) => d <= Math.max(4, Math.floor(r.length / 2))).map(([p]) => p)
  return { status: 'not_found', ...at, matches: [], suggestions }
}

const GOTO = /\b(?:page\.goto|cy\.visit)\(\s*(['"`])(\/[^'"`\n$]*)\1/g

/** The literal routes the specs open → Map route → [spec]. A computed one (a variable, ${…}) cannot be read. */
export function specRoutes(root, specs) {
  const out = new Map()
  for (const f of specs) {
    let src = ''
    try { src = readFileSync(resolve(root, f), 'utf8') } catch { continue }
    for (const m of src.matchAll(GOTO)) out.set(m[2], [...new Set([...(out.get(m[2]) ?? []), f])])
  }
  return out
}

const tail = u => { const x = new URL(u); return ((x.hash.startsWith('#/') ? x.hash.slice(1) : x.pathname).replace(/\/+$/, '') || '/').toLowerCase() }

// Runs in the page. Dev builds of licensed UI kits (MUI X, AG Grid, Syncfusion, DevExtreme, Kendo, Handsontable)
// lay a license banner or watermark over the app. Hidden, not removed: the app's framework still owns the node.
export function hideLicenseBanners() {
  const LICENSE = /licen[cs]e key|trial version|evaluation (?:purposes|version|copy)|for development purposes only|no valid licen[cs]e|unlicensed|licen[cs]e (?:is )?(?:missing|expired|invalid|not found)/i
  const MAX_TEXT = 400
  window.__qcBanners = window.__qcBanners || []
  const sweep = () => {
    if (!document.body) return
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n; (n = walker.nextNode());) {
      if (!LICENSE.test(n.data)) continue
      // The largest overlay around the text that is still only the banner (short text, positioned or on top).
      let box = null
      for (let el = n.parentElement; el && el !== document.body && (el.innerText || '').length <= MAX_TEXT; el = el.parentElement) {
        const st = getComputedStyle(el)
        if (/fixed|absolute|sticky/.test(st.position) || Number(st.zIndex) >= 1000) box = el
      }
      if (!box || box.dataset.qcHidden) continue
      box.dataset.qcHidden = '1'
      window.__qcBanners.push((box.innerText || n.data).trim().split(/\s+/).join(' ').slice(0, 120))
      box.style.setProperty('display', 'none', 'important')
    }
  }
  let queued = false
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; sweep() }, 50) } }).observe(document, { childList: true, subtree: true, characterData: true })
  document.addEventListener('DOMContentLoaded', sweep)
}

/** Opens each route in a real browser, as a path and after /#, under the url's own path and the router's base.
 * A license banner over the app is hidden first, and named in banners.
 * mark: opens, home (the router fell back to the home page), redirected, http <status>, error. The page text is kept for the agent to judge. */
export async function probeRoutes(root, base, routes, found = declaredRoutes(root), { timeoutMs = 15_000, from = join(root, 'package.json') } = {}) {
  let chromium
  try { chromium = createRequire(from)('@playwright/test').chromium } catch { return { error: 'Playwright is not installed in this project, so the routes cannot be opened.' } }
  const prefixes = [...new Set([new URL(base).pathname.replace(/\/+$/, ''), found.base ?? ''])]
  const browser = await chromium.launch().catch(e => ({ error: e.message.split('\n')[0] }))
  if (browser.error) return { error: `The browser did not start: ${browser.error}` }
  const context = await browser.newContext()
  await context.addInitScript(hideLicenseBanners)
  const banners = new Set()
  const visit = async path => {
    const page = await context.newPage()
    try {
      const res = await page.goto(new URL(path, base).href, { waitUntil: 'load', timeout: timeoutMs })
      await page.waitForTimeout(1000) // an SPA routes after load
      for (const b of await page.evaluate(() => window.__qcBanners ?? []).catch(() => [])) banners.add(b)
      const text = collapseSpaces(await page.innerText('body').catch(() => '')).trim()
      return { path, status: res?.status() ?? 200, final: page.url(), title: await page.title(), text: text.slice(0, 160), full: text }
    } catch (e) { return { path, error: e.message.split('\n')[0] } } finally { await page.close() }
  }
  try {
    const home = await visit(`${prefixes[0]}/`)
    if (home.error) return { error: `The app did not open at ${base}: ${home.error}`, banners: [...banners] }
    const out = []
    for (const route of routes) {
      const r = route.split(/[?#]/)[0].toLowerCase()
      const tries = []
      for (const pre of prefixes) for (const path of [`${pre}${route}`, `${pre}/#${route}`]) {
        const v = await visit(path)
        v.mark = v.error ? 'error' : v.status >= 400 ? `http ${v.status}` : r !== '/' && !tail(v.final).endsWith(r) ? 'redirected'
          : r !== '/' && v.full === home.full && !tail(home.final).endsWith(r) ? 'home' : 'opens'
        delete v.full
        tries.push(v)
      }
      out.push({ route, opens: tries.find(t => t.mark === 'opens')?.path ?? null, tries })
    }
    return { home: { final: home.final, title: home.title, text: home.text }, routes: out, banners: [...banners] }
  } finally { await browser.close() }
}
