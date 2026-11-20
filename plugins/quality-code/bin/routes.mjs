#!/usr/bin/env node
// Checks a path against the routes the code declares (read-only).
// check exits 0 found or likely, 1 not found (prints closest), 2 usage, 3 no router found.
// specs [--url URL] [spec…]: every route the frontend specs open, checked in the code and, when the app answers, opened in a browser.
// It exits 0 when every route is fine, 1 when one is not, 2 usage, 3 when the specs open no literal route.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig, projectRoot } from '../lib/config/config.mjs'
import { checkRoute, declaredRoutes, probeRoutes, specRoutes } from '../lib/base/routes.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { checkUrl } from '../lib/pipeline/smoke.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'
import { hasLineBreak } from '../lib/core/is.mjs'

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const [cmd, route] = argv
  if (cmd === 'list' && argv.length === 1) {
    const f = declaredRoutes(projectRoot(env, cwd))
    const all = [...new Set([...f.declared, ...f.fileBased])].sort()
    printLine(all.length ? all.join('\n') : 'No routes found in the code.')
    return 0
  }
  if (cmd === 'specs') return specs(argv.slice(1), env, cwd, printLine, printError)
  if (cmd !== 'check' || !route || argv.length !== 2 || !route.startsWith('/') || hasLineBreak(route)) {
    printError('usage: routes.mjs check </path> | routes.mjs list | routes.mjs specs [--url URL] [spec…] (the path starts with /, like /orders)')
    return 2
  }
  const r = checkRoute(projectRoot(env, cwd), route)
  const line = {
    found: `ok: ${r.route} is a route of the app (${r.matches.slice(0, 3).join(', ')}).`,
    likely: `ok: ${r.route} fits the app's nested routes (every part of it is a declared route piece).`,
    unknown: `no router found in the code, so ${r.route} cannot be checked. It is used as it is.`,
    not_found: `${r.route} is not a route the app declares.${r.suggestions.length ? ` Closest: ${r.suggestions.join(', ')}.` : ''}`,
  }[r.status]
  const open = r.status === 'not_found' ? '' : ` Open it as ${r.url}${r.hash ? ' (the app routes after #)' : r.base ? ` (the app is under ${r.base})` : ''}.`
  printLine(`${line}${r.hash || r.base ? open : ''}\n${tag('ROUTE', r)}`)
  return { not_found: 1, unknown: 3 }[r.status] ?? 0
}

const MAX_LIVE = 20

// The app's address: --url, else the env Playwright reads, else a literal baseURL in its config.
function baseUrlOf(root, env, url) {
  if (url) return url
  const v = env.PLAYWRIGHT_TEST_BASE_URL || env.BASE_URL
  if (v) return v
  for (const f of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs']) {
    try { const m = readFileSync(resolve(root, f), 'utf8').match(/\bbaseURL\s*:\s*(['"`])(https?:\/\/[^'"`\n$]+)\1/); if (m) return m[2] } catch {}
  }
  return null
}

async function specs(args, env, cwd, printLine, printError) {
  const i = args.indexOf('--url')
  let url = null
  if (i >= 0) {
    const u = checkUrl(args[i + 1])
    if (u.error) { printError(u.error); return 2 }
    url = u.url
    args = args.filter((_, j) => j !== i && j !== i + 1)
  }
  const root = projectRoot(env, cwd)
  let files = args
  if (!files.length) { try { files = projectSpecs(root, loadConfig(root, env).config).filter(s => s.adapter === 'playwright').map(s => s.path) } catch { files = [] } }
  const opened = specRoutes(root, files)
  if (!opened.size) { printLine(`The specs open no route written as a path ('/orders'), so there is nothing to check.\n${tag('ROUTES', { routes: [] })}`); return 3 }
  const found = declaredRoutes(root)
  const rows = [...opened].map(([route, by]) => ({ ...checkRoute(root, route, found), typed: route, specs: by }))
  const base = baseUrlOf(root, env, url)
  let live = { error: 'No app address: no --url, no PLAYWRIGHT_TEST_BASE_URL or BASE_URL, no literal baseURL in the Playwright config. Only the code was checked.' }
  if (base) live = await probeRoutes(root, base, rows.slice(0, MAX_LIVE).map(r => r.typed), found, { from: resolve(root, files[0]) })
  for (const r of rows) r.live = live.routes?.find(l => l.route === r.typed) ?? null
  const bad = rows.filter(r => r.status === 'not_found' || (r.live && !r.live.opens))
  for (const r of rows) {
    const code = { found: 'in the code', likely: 'fits a nested route', unknown: 'no router in the code', not_found: `not in the code${r.suggestions.length ? ` (closest: ${r.suggestions.join(', ')})` : ''}` }[r.status]
    const where = r.live ? (r.live.opens ? `opens at ${r.live.opens}` : `did not open (${r.live.tries.map(t => `${t.path} → ${t.mark === 'redirected' ? `went to ${t.final}` : t.mark === 'home' ? 'home page' : t.mark}`).join('; ')})`) : ''
    printLine(`${r.status === 'not_found' || (r.live && !r.live.opens) ? '!!' : 'ok'}  ${r.typed}  ${code}${where ? `, ${where}` : ''}${!r.live && r.status !== 'not_found' && (r.hash || r.base) ? `, open as ${r.url}` : ''}  [${r.specs.join(', ')}]`)
  }
  if (live.banners?.length) printLine(`A license banner covered the app and was hidden for this check: ${live.banners.map(b => `"${b}"`).join(', ')}. It is a dev-mode banner of a licensed UI kit, and it blocks the e2e tests too: hide it in the tests (the Playwright guide says how).`)
  if (live.error) printLine(live.error)
  else if (rows.length > MAX_LIVE) printLine(`Only the first ${MAX_LIVE} routes were opened in the browser.`)
  printLine(tag('ROUTES', { base, hash: found.hash, routerBase: found.base, home: live.home ?? null, banners: live.banners ?? [], error: live.error ?? null, routes: rows }))
  return bad.length ? 1 : 0
}

if (isMain(import.meta.url)) Promise.resolve(main()).then(code => { process.exitCode = code })
