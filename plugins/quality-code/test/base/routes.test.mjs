// Is a typed screen a route of the app? Read from the router the code declares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkRoute, declaredRoutes, fits } from '../../lib/base/routes.mjs'
import { main } from '../../bin/routes.mjs'

function app(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-routes-'))
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return d
}
const REACT = {
  'src/App.jsx': `<Routes><Route path="/" element={<Home/>} /><Route path="/transferDdt" element={<T/>} /><Route path="/orders/:id" element={<O/>} /><Route path="/tax-report" element={<R/>}><Route path=":taxReportId" element={<X/>} /></Route></Routes>`,
  'src/App.unit.test.jsx': `path="/only-in-a-test"`,
}

test('fits: parameters and wildcards', () => {
  assert.equal(fits('/orders/:id', '/orders/12'), true)
  assert.equal(fits('/orders/:id', '/orders'), false)
  assert.equal(fits('/orders', '/Orders'), true)
  assert.equal(fits('/files/*', '/files/a/b'), true)
  assert.equal(fits('/orders/[id]', '/orders/7'), true)
})

test('a route in a React router is found; one that is not gets the closest ones', () => {
  const d = app(REACT)
  assert.equal(checkRoute(d, '/transferDdt').status, 'found')
  assert.equal(checkRoute(d, '/orders/123').status, 'found')
  assert.equal(checkRoute(d, '/transferDdt?tab=1').status, 'found')
  const bad = checkRoute(d, '/transferDtt')
  assert.equal(bad.status, 'not_found')
  assert.deepEqual(bad.suggestions.slice(0, 1), ['/transferDdt'])
  assert.equal(checkRoute(d, '/only-in-a-test').status, 'not_found', 'test files are not the router')
})

test('a nested route written relative to its parent is likely', () => {
  const d = app(REACT)
  // :taxReportId is a piece of /tax-report; 42 is a parameter value
  assert.equal(checkRoute(d, '/tax-report/42').status, 'likely')
  assert.equal(checkRoute(d, '/nothing/42').status, 'not_found')
})

test('a file-based router: Next pages and the app router', () => {
  const d = app({ 'pages/index.js': 'x', 'pages/orders/[id].js': 'x', 'pages/orders/new.js': 'x', 'pages/_app.js': 'x', 'app/settings/page.tsx': 'x', 'app/(auth)/login/page.tsx': 'x' })
  const r = declaredRoutes(d).fileBased
  for (const want of ['/', '/orders/[id]', '/orders/new', '/settings', '/login']) assert.ok(r.includes(want), `${want} in ${r.join(', ')}`)
  assert.ok(!r.includes('/_app'))
  assert.equal(checkRoute(d, '/orders/99').status, 'found')
  assert.equal(checkRoute(d, '/settings').status, 'found')
})

test('no router in the code: the route cannot be checked', () => {
  assert.equal(checkRoute(app({ 'src/a.js': 'export const a = 1' }), '/x').status, 'unknown')
})

test('the script: exit codes and lines', () => {
  const d = app(REACT)
  const run = argv => { let out = '', err = ''; const code = main(argv, { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: s => { err += s } }); return { code, out, err } }
  assert.equal(run(['check', '/transferDdt']).code, 0)
  const bad = run(['check', '/transferDtt'])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /\/transferDtt is not a route the app declares\. Closest: \/transferDdt/)
  assert.equal(run(['check', 'transferDdt']).code, 2)
  assert.equal(run(['check']).code, 2)
  assert.match(run(['list']).out, /\/transferDdt/)
  assert.equal(main(['check', '/x'], { CLAUDE_PROJECT_DIR: app({ 'a.js': '1' }) }, d, { stdout: () => {}, stderr: () => {} }), 3)
})

test('a hash router: the route is opened after /#, and /#/x is read as /x', () => {
  const d = app({ 'src/main.jsx': `import { HashRouter } from 'react-router-dom'\n<HashRouter><Routes><Route path="/orders" element={<O/>} /></Routes></HashRouter>` })
  const r = checkRoute(d, '/#/orders')
  assert.equal(r.status, 'found')
  assert.equal(r.route, '/orders')
  assert.equal(r.url, '/#/orders')
  assert.equal(checkRoute(d, '/orders?tab=1').url, '/#/orders?tab=1')
  let out = ''
  main(['check', '/orders'], { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: () => {} })
  assert.match(out, /Open it as \/#\/orders \(the app routes after #\)/)
})

test('a literal basename: the route is opened under it; a variable one is not guessed', () => {
  const d = app({ 'src/App.jsx': `<BrowserRouter basename="/stock/warehouse"><Routes><Route path="/orders" element={<O/>} /></Routes></BrowserRouter>` })
  assert.equal(checkRoute(d, '/orders').url, '/stock/warehouse/orders')
  assert.equal(checkRoute(d, '/stock/warehouse/orders').status, 'found')
  const v = app({ 'src/App.jsx': `<BrowserRouter basename={basename}><Routes><Route path="/orders" element={<O/>} /></Routes></BrowserRouter>` })
  assert.equal(checkRoute(v, '/orders').url, '/orders')
  const vue = app({ 'src/router.js': `createRouter({ history: createWebHashHistory('/app/'), routes: [{ path: '/orders' }] })` })
  assert.equal(checkRoute(vue, '/orders').url, '/app/#/orders')
})

// A fake @playwright/test whose browser runs a hash-router app: /#/orders shows Orders, anything else falls back to Home.
// Its page reports a license banner hidden by the init script.
function fakePlaywright(d) {
  mkdirSync(join(d, 'node_modules/@playwright/test'), { recursive: true })
  writeFileSync(join(d, 'node_modules/@playwright/test/index.js'), `
const screen = u => { const h = new URL(u).hash.slice(1) || '/'; return h === '/orders' ? 'Orders list' : 'Home' }
const final = u => { const x = new URL(u); return x.hash && x.hash !== '#/orders' ? x.origin + '/#/' : u }
const newPage = async () => { let at = ''
  return { goto: async u => { at = final(u); return { status: () => 200 } }, url: () => at, title: async () => 'App',
    innerText: async () => screen(at), waitForTimeout: async () => {}, close: async () => {}, evaluate: async () => ['MUI X Missing license key'] } }
exports.chromium = { launch: async () => ({ close: async () => {}, newContext: async () => ({ addInitScript: async () => {}, newPage }) }) }`)
}

test('specs: the routes the specs open, checked in the code and opened in the browser', async () => {
  const d = app({ 'src/main.jsx': `<HashRouter><Route path="/orders" element={<O/>} /></HashRouter>`, 'e2e/a.spec.ts': `await page.goto('/orders')\nawait page.goto('/missing')\nawait page.goto(url)` })
  writeFileSync(join(d, 'package.json'), '{}')
  fakePlaywright(d)
  const run = async argv => { let out = '', err = ''; const code = await main(argv, { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: s => { err += s } }); return { code, out, err } }
  const r = await run(['specs', '--url', 'http://app.test', 'e2e/a.spec.ts'])
  assert.equal(r.code, 1)
  assert.match(r.out, /^ok {2}\/orders {2}in the code, opens at \/#\/orders/m)
  assert.match(r.out, /^!! {2}\/missing {2}not in the code, did not open \(\/missing → home page; \/#\/missing → went to http:\/\/app\.test\/#\/\)/m)
  const json = JSON.parse(r.out.split('ROUTES_JSON:')[1])
  assert.equal(json.hash, true)
  assert.deepEqual(json.routes.map(x => x.typed), ['/orders', '/missing'], 'a computed goto is not read')
  assert.match(r.out, /A license banner covered the app and was hidden for this check: "MUI X Missing license key"/)
  assert.deepEqual(json.banners, ['MUI X Missing license key'], 'one banner, however many pages showed it')
  assert.equal((await run(['specs', '--url', 'ftp://x'])).code, 2)
})

test('specs: with no app address only the code is checked', async () => {
  const d = app({ 'src/App.jsx': `<Route path="/orders" element={<O/>} />`, 'e2e/a.spec.ts': `await page.goto('/orders')` })
  let out = ''
  const code = await main(['specs', 'e2e/a.spec.ts'], { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: () => {} })
  assert.equal(code, 0)
  assert.match(out, /ok {2}\/orders {2}in the code {2}\[e2e\/a\.spec\.ts\]/)
  assert.match(out, /No app address/)
})

test('specs with no spec named: the frontend specs of the project config are read', async () => {
  const cfg = { version: 2, frontend: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
  const d = app({ 'src/App.jsx': `<Route path="/orders" element={<O/>} />`, 'e2e/a.spec.ts': `await page.goto('/orders')`, '.claude/quality-code.json': JSON.stringify(cfg) })
  let out = ''
  const code = await main(['specs'], { CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-routes-cfg-')) }, d, { stdout: s => { out += s }, stderr: () => {} })
  assert.equal(code, 0, out)
  assert.match(out, /ok {2}\/orders {2}in the code {2}\[e2e\/a\.spec\.ts\]/)
})
