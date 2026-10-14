// Parity for the shared checks: the merged modules, under the warehouse configs, give the verdicts
// the old warehouse scripts gave on the captured fixtures. Allowed differences: spec §9.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanDiff } from '../core/checks/honesty.mjs'
import { grade } from '../core/checks/suite-honesty.mjs'
import { violation, rulesFor } from '../core/checks/boundary.mjs'
import { classify, overall } from '../core/checks/flaky.mjs'
import { planMutants } from '../core/checks/mutation.mjs'
import { keySource } from '../core/checks/keys.mjs'
import { dialectFor } from '../core/checks/dialects/index.mjs'

const DIR = new URL('./parity/', import.meta.url).pathname
const read = p => readFileSync(join(DIR, p), 'utf8')
const CONFIGS = { fe: JSON.parse(read('configs/warehouse-frontend.json')), be: JSON.parse(read('configs/warehouse-backend.json')) }
const D = { fe: dialectFor('playwright'), be: dialectFor('vitest') }
const E = JSON.parse(read('checks/expected.json'))

describe('honesty', () => {
  for (const h of E.honesty) test(h.fixture, () => {
    assert.deepEqual(scanDiff(read(`checks/${h.fixture}`), D[h.repo], keySource(CONFIGS[h.repo])), h.violations)
  })
})
describe('suite-honesty', () => {
  for (const s of E.suite) test(`${s.fixture}${s.key ? ` --key ${s.key}` : ''}`, () => {
    const r = grade([{ path: 'work.spec.ts', src: read(`checks/${s.fixture}`) }], { key: s.key }, D[s.repo])
    assert.equal(r.status, s.exit === 0 ? 'pass' : 'fail')
    assert.equal(r.data.percent, s.percent)
    assert.deepEqual(r.findings.filter(f => f.kind === 'hollow test').map(f => f.test), s.hollow)
  })
})
describe('boundary', () => {
  for (const b of E.boundary) test(`${b.repo} ${b.variant} ${b.path}`, () => {
    const rules = rulesFor(CONFIGS[b.repo], '/nonexistent')
    if (b.variant === 'mocked') rules.allow = ['src/**/*.spec.ts']
    const v = violation(b.path, rules)
    // Ruling §9 (16): dist/ and node_modules/ are always forbidden; the old frontend guard did not know them.
    const expectForbidden = b.repo === 'fe' && /^(dist|node_modules)\//.test(b.path) ? true : b.forbidden
    // Ruling §9 (12): a bare `src` (no slash) was allowed by the old backend guard (startsWith('src/'))
    // but is forbidden by the old frontend guard and by the merged one. The merged behaviour wins, so
    // the old backend answer is not compared.
    if (b.repo === 'be' && b.path === 'src') return
    assert.equal(Boolean(v), expectForbidden)
    if (b.why) assert.equal(v.why, b.why)
  })
})
test('flaky classification', () => {
  for (const [p, f, v] of E.flaky.classify) assert.equal(classify(p, f), v, `${p}/${f}`)
  for (const [vs, v] of E.flaky.overall) assert.equal(overall(vs), v, vs.join())
})
describe('mutation plans', () => {
  for (const m of E.mutation) test(`${m.fixture}${m.key ? ` --key ${m.key}` : ''}${m.thorough ? ' thorough' : ''}`, () => {
    assert.deepEqual(planMutants(read(`checks/${m.fixture}`), m.passed, { key: m.key, thorough: m.thorough }, D[m.repo]), m.mutants)
  })
})
test('the captured data covers the failure paths', () => {
  for (const k of ['honesty', 'suite', 'boundary', 'mutation']) assert.ok(E[k].length > 0, k)
  assert.ok(E.flaky.classify.length > 0 && E.flaky.overall.length > 0)
  assert.ok(E.suite.some(s => s.exit === 1 && s.hollow.length > 0))
  assert.ok(E.boundary.filter(b => b.forbidden).length >= 10)
})
