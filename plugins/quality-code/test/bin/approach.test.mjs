import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../lib/base/config.mjs'
import { approachOf, unitRunnerOf } from '../../lib/base/stack.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const base = { version: 1, jira: { site: 'https://e.atlassian.net', projects: ['ABC'] } }
function project(config, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qc-appr-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ ...base, ...config }))
  for (const [p, s] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s) }
  return root
}
const env = { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-appr-cfg-')) }
const errors = config => { const r = loadConfig(project(config), env); return r.ok ? [] : r.errors }
const fullstack = features => ({ adapter: 'fullstack', features })

test('a feature says how it is tested: e2e, unit or both, and where the team wrote its approach', () => {
  assert.deepEqual(errors(fullstack([{ label: 'orders', route: '/orders', approach: 'both', guide: 'docs/testing/orders.md' }])), [])
  assert.deepEqual(errors(fullstack([{ label: 'orders', approach: 'unit' }])), [])
  assert.match(errors(fullstack([{ label: 'orders', approach: 'fast' }])).join('\n'), /features\[0\]\.approach: must be "e2e", "unit" or "both"/)
  assert.match(errors(fullstack([{ label: 'orders', guide: '../x.md' }])).join('\n'), /features\[0\]\.guide .* must be a file inside the project/)
  assert.match(errors(fullstack([{ label: 'orders', guide: '/etc/x.md' }])).join('\n'), /must be a file inside the project/)
})

test('unit tests for a frontend feature need a JavaScript unit runner', () => {
  assert.match(errors({ adapter: 'playwright', features: [{ label: 'orders', route: '/orders', approach: 'unit' }] }).join('\n'), /needs a JavaScript unit test runner/)
  assert.deepEqual(errors({ adapter: 'playwright', features: [{ label: 'orders', route: '/orders', approach: 'e2e' }] }), [])
  assert.match(errors({ adapter: 'fullstack', backend: 'pytest', features: [{ label: 'orders', approach: 'both' }] }).join('\n'), /needs a JavaScript unit test runner/)
  assert.deepEqual(errors({ adapter: 'vitest', features: [{ label: 'orders', approach: 'unit' }] }), [])
})

test('approachOf: the feature\'s own, case-insensitive, both by default with a unit runner, e2e without one', () => {
  const c = { adapter: 'fullstack', features: [{ label: 'orders', approach: 'both' }, { label: 'cart' }] }
  assert.equal(approachOf(c, 'ORDERS'), 'both')
  assert.equal(approachOf(c, 'cart'), 'both')
  assert.equal(approachOf(c, 'unknown'), 'both')
  assert.equal(approachOf({ adapter: 'playwright', features: [{ label: 'cart' }] }, 'cart'), 'e2e')
  assert.equal(approachOf({ adapter: 'fullstack', features: [{ label: 'cart', approach: 'e2e' }] }, 'cart'), 'e2e')
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
