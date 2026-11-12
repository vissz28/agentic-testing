import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../lib/base/config.mjs'
import { approachOf, unitRunnerOf } from '../../lib/base/stack.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const base = { version: 2, jira: { site: 'https://e.atlassian.net', projects: ['ABC'] } }
function project(config, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qc-appr-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ ...base, ...config }))
  for (const [p, s] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s) }
  return root
}
const env = { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-appr-cfg-')) }
const errors = config => { const r = loadConfig(project(config), env); return r.ok ? [] : r.errors }
const fullstack = features => ({ frontend: 'playwright', backend: 'vitest', features })

test('a feature says how it is tested: e2e, unit or both, and where the team wrote its approach', () => {
  assert.deepEqual(errors(fullstack([{ label: 'orders', route: '/orders', approach: 'both', guide: 'docs/testing/orders.md' }])), [])
  assert.deepEqual(errors(fullstack([{ label: 'orders', approach: 'unit' }])), [])
  assert.match(errors(fullstack([{ label: 'orders', approach: 'fast' }])).join('\n'), /features\[0\]\.approach: must be "e2e", "unit" or "both"/)
  assert.match(errors(fullstack([{ label: 'orders', guide: '../x.md' }])).join('\n'), /features\[0\]\.guide .* must be a file inside the project/)
  assert.match(errors(fullstack([{ label: 'orders', guide: '/etc/x.md' }])).join('\n'), /must be a file inside the project/)
})

test('unit tests for a frontend feature need a JavaScript unit runner', () => {
  assert.match(errors({ frontend: 'playwright', features: [{ label: 'orders', route: '/orders', approach: 'unit' }] }).join('\n'), /needs a JavaScript unit test runner/)
  assert.deepEqual(errors({ frontend: 'playwright', features: [{ label: 'orders', route: '/orders', approach: 'e2e' }] }), [])
  assert.match(errors({ frontend: 'playwright', backend: 'pytest', features: [{ label: 'orders', approach: 'both' }] }).join('\n'), /needs a JavaScript unit test runner/)
  assert.deepEqual(errors({ backend: 'vitest', features: [{ label: 'orders', approach: 'unit' }] }), [])
})

test('approachOf: the feature\'s own, case-insensitive, both by default with a unit runner, e2e without one', () => {
  const c = { adapter: 'fullstack', backend: 'vitest', features: [{ label: 'orders', approach: 'both' }, { label: 'cart' }] }
  assert.equal(approachOf(c, 'ORDERS'), 'both')
  assert.equal(approachOf(c, 'cart'), 'both')
  assert.equal(approachOf(c, 'unknown'), 'both')
  assert.equal(approachOf({ adapter: 'playwright', features: [{ label: 'cart' }] }, 'cart'), 'e2e')
  assert.equal(approachOf({ adapter: 'fullstack', backend: 'vitest', features: [{ label: 'cart', approach: 'e2e' }] }, 'cart'), 'e2e')
  assert.equal(approachOf({ adapter: 'playwright', features: [{ label: 'orders', approach: 'unit' }] }, 'orders'), 'e2e')
  assert.equal(unitRunnerOf(c), 'vitest')
  assert.equal(unitRunnerOf({ adapter: 'playwright' }), null)
})

test('ticket.mjs approach: the line, the JSON, and whether the team guide exists', () => {
  const root = project(fullstack([{ label: 'orders', approach: 'both', guide: 'docs/testing/orders.md' }, { label: 'cart' }]), { 'docs/testing/orders.md': '# Orders\n' })
  const run = (...args) => spawnSync(process.execPath, [CLI, 'approach', ...args], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env }, encoding: 'utf8' })
  let r = run('orders')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^orders: unit tests and end-to-end tests; team guide docs\/testing\/orders\.md\n/)
  const json = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('APPROACH_JSON:')).slice('APPROACH_JSON:'.length))
  assert.deepEqual(json, { feature: 'orders', approach: 'both', unitRunner: 'vitest', guide: 'docs/testing/orders.md', guideFound: true, set: 'both' })
  r = run('cart')
  assert.match(r.stdout, /^cart: unit tests and end-to-end tests \(the default: no approach set for it\)\n/)
  assert.equal(run().status, 2)
})

test('testRules: own or plugin per side, checked by the config', () => {
  assert.deepEqual(errors({ frontend: 'playwright', backend: 'vitest', testRules: { backend: 'own', frontend: 'plugin' } }), [])
  assert.match(errors({ frontend: 'playwright', backend: 'vitest', testRules: { backend: 'ours' } }).join('\n'), /testRules\.backend: must be "own"/)
  assert.match(errors({ frontend: 'playwright', backend: 'vitest', testRules: { mobile: 'own' } }).join('\n'), /testRules\.mobile: unknown field/)
  assert.match(errors({ frontend: 'playwright', backend: 'vitest', testRules: 'own' }).join('\n'), /testRules: must be an object/)
})

test('ticket.mjs rules: what the team answered and the team\'s own guide files, per side', () => {
  const root = project({ frontend: 'playwright', backend: 'vitest', testRules: { frontend: 'plugin' }, playwright: { guide: 'docs/e2e.md' }, vitest: { layers: [{ name: 'service', folder: 'test/service/', guide: 'docs/service.md' }] } }, { 'docs/e2e.md': '#', 'docs/service.md': '#' })
  const r = spawnSync(process.execPath, [CLI, 'rules'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const json = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('RULES_JSON:')).slice('RULES_JSON:'.length))
  assert.deepEqual(json, { backend: { set: null, guides: ['docs/service.md'] }, frontend: { set: 'plugin', guides: ['docs/e2e.md'] } })
})
