import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { detectConventions, flowOf, runFlow, testNameOf } from '../../lib/base/conventions.mjs'
import { validateConfig } from '../../lib/base/config.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'] } }
function project(files = [], config = CFG) {
  const root = mkdtempSync(join(tmpdir(), 'qc-conv-'))
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify(config))
  for (const f of files) { mkdirSync(join(root, dirname(f)), { recursive: true }); writeFileSync(join(root, f), '') }
  return root
}
const run = (root, ...args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-cc-')) }, encoding: 'utf8' })
const flowJson = out => JSON.parse(out.split('\n').find(l => l.startsWith('FLOW_JSON:')).slice('FLOW_JSON:'.length))

test('test file names of every backend and frontend language are recognised', () => {
  assert.deepEqual(testNameOf('pricing.spec.ts'), { pattern: '.spec.ts', style: 'suffix' })
  assert.deepEqual(testNameOf('pricing.test.mjs'), { pattern: '.test.mjs', style: 'suffix' })
  assert.equal(testNameOf('home.cy.ts').pattern, '.cy.ts')
  assert.equal(testNameOf('price_test.go').pattern, '_test.go')
  assert.equal(testNameOf('test_price.py').pattern, 'test_*.py')
  assert.equal(testNameOf('price_test.py').pattern, '*_test.py')
  assert.equal(testNameOf('PriceTest.java').pattern, 'Test.java')
  assert.equal(testNameOf('PriceTests.cs').pattern, 'Tests.cs')
  assert.equal(testNameOf('pricing.ts'), null)
  assert.equal(testNameOf('README.md'), null)
})

test('a project with no tests: nothing to follow', () => {
  const c = detectConventions(project(['src/pricing.ts']))
  assert.deepEqual(c, { specs: 0, pattern: null, style: null, folders: [], beside: false, keyed: false })
})

test('the most common pattern, the folders that hold specs, and tests in a test folder', () => {
  const c = detectConventions(project(['src/a.ts', 'test/unit/a.spec.ts', 'test/unit/b.spec.ts', 'test/integration/c.test.ts', 'node_modules/x/y.spec.ts']))
  assert.equal(c.specs, 3, 'node_modules is skipped')
  assert.equal(c.pattern, '.spec.ts')
  assert.deepEqual(c.folders, ['test/unit/', 'test/integration/'])
  assert.equal(c.beside, false)
  assert.equal(c.keyed, false)
})

test('tests next to the code, and names that already carry a ticket key', () => {
  const beside = detectConventions(project(['src/a.ts', 'src/a.spec.ts', 'src/b.spec.ts', 'src/util/c.spec.ts']))
  assert.equal(beside.beside, true)
  const keyed = detectConventions(project(['test/pricing.abc-123.spec.ts', 'test/stock.abc-124.spec.ts']))
  assert.equal(keyed.keyed, true)
})

test('the flow: the config says, else the project when it has tests, else Quality Code; --flow wins for one run', () => {
  const none = { specs: 0 }, some = { specs: 4 }
  assert.equal(flowOf({}, none), 'quality-code')
  assert.equal(flowOf({}, some), 'project')
  assert.equal(flowOf({ testFlow: 'quality-code' }, some), 'quality-code')
  assert.equal(flowOf({ testFlow: 'project' }, none), 'project')
  assert.equal(runFlow({ testFlow: 'project' }, some, 'quality-code'), 'quality-code')
  assert.equal(runFlow({}, some, 'bogus'), 'project')
})

test('testFlow in the config: project or quality-code, nothing else', () => {
  assert.equal(validateConfig({ ...CFG, testFlow: 'project' }).ok, true)
  assert.equal(validateConfig({ ...CFG, testFlow: 'quality-code' }).ok, true)
  const bad = validateConfig({ ...CFG, testFlow: 'mine' })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /testFlow "mine": must be "project"/)
})

test('config flow: says which flow, and why', () => {
  const root = project(['test/a.spec.ts', 'test/b.spec.ts'])
  let r = run(root, 'config', 'flow')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^flow: the project's own: 2 test files found, named \.spec\.ts/)
  assert.deepEqual([flowJson(r.stdout).flow, flowJson(r.stdout).source], ['project', 'detected'])
  r = run(root, 'config', 'flow', 'quality-code')
  assert.match(r.stdout, /^flow: Quality Code: the ticket key in the file name/)
  assert.deepEqual([flowJson(r.stdout).flow, flowJson(r.stdout).source], ['quality-code', 'run'])
  assert.equal(run(root, 'config', 'flow', 'mine').status, 2)
})

test('config flow: the config wins over detection, and a project with no tests keeps Quality Code\'s flow', () => {
  const set = project(['test/a.spec.ts'], { ...CFG, testFlow: 'quality-code' })
  const j = flowJson(run(set, 'config', 'flow').stdout)
  assert.deepEqual([j.flow, j.source, j.configured], ['quality-code', 'config', 'quality-code'])
  const empty = project(['src/a.ts'])
  assert.equal(flowJson(run(empty, 'config', 'flow').stdout).flow, 'quality-code')
  const forced = project(['src/a.ts'], { ...CFG, testFlow: 'project' })
  assert.match(run(forced, 'config', 'flow').stdout, /^flow: the project's own, but it has no tests yet/)
})

test('setup --detect reports the conventions, and --write keeps testFlow', () => {
  const root = project(['src/a.ts', 'test/a.spec.ts'])
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-cc-')) }
  const SETUP = new URL('../../bin/setup.mjs', import.meta.url).pathname
  const d = spawnSync(process.execPath, [SETUP, '--detect'], { cwd: root, env, encoding: 'utf8' })
  const detected = JSON.parse(d.stdout.split('\n').find(l => l.startsWith('SETUP_JSON:')).slice('SETUP_JSON:'.length))
  assert.equal(detected.conventions.specs, 1)
  assert.equal(detected.conventions.pattern, '.spec.ts')
  const w = spawnSync(process.execPath, [SETUP, '--write', JSON.stringify({ config: { ...CFG, testFlow: 'project' } })], { cwd: root, env, encoding: 'utf8' })
  assert.match(w.stdout, /^ok/m, w.stdout + w.stderr)
  assert.equal(flowJson(run(root, 'config', 'flow').stdout).configured, 'project')
  const bad = spawnSync(process.execPath, [SETUP, '--write', JSON.stringify({ config: { ...CFG, testFlow: 'mine' } })], { cwd: root, env, encoding: 'utf8' })
  assert.doesNotMatch(bad.stdout, /^ok/m)
  assert.match(bad.stdout + bad.stderr, /testFlow/)
})
