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
