// The backend registry and what reads it: config, stack, boundary, branch kinds, the spec listing, the rubric.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BACKEND_ADAPTERS, BACKENDS, backendOf, isBackend, runnerLabel } from '../../lib/base/backends.mjs'
import { adapterOptions, commandOf, layersOf, timeoutSecondsOf, validateConfig } from '../../lib/base/config.mjs'
import { adapterOfSpec, adaptersForSide, adaptersOf, sideOfAdapter, specsByAdapter, stackOf } from '../../lib/base/stack.mjs'
import { rulesFor, violation } from '../../lib/base/boundary.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'
import { kindOf } from '../../bin/branch.mjs'
import { projectSpecs } from '../../lib/report/quality-program.mjs'
import { buildBrief, formatReport, rubricFor } from '../../lib/ticket/score.mjs'
import { sides } from '../config-fields.mjs'

const base = { version: 2, jira: { site: 'https://example.atlassian.net', projects: ['ABC'] } }
const valid = extra => validateConfig({ ...base, ...extra })
const OTHERS = ['pytest', 'junit', 'go', 'dotnet']
const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('the registry: vitest and the four other backends, each with every field', () => {
  assert.deepEqual(BACKEND_ADAPTERS, ['vitest', 'pytest', 'junit', 'go', 'dotnet'])
  assert.deepEqual(BACKEND_ADAPTERS.map(a => BACKENDS[a].label), ['Vitest', 'pytest', 'JUnit', 'Go', '.NET'])
  for (const a of BACKEND_ADAPTERS) {
    const b = BACKENDS[a]
    for (const k of ['label', 'language', 'testFile', 'codeFile', 'defaultLayers', 'stryker', 'typeCheck', 'guide']) assert.ok(k in b, `${a}.${k}`)
    assert.ok(b.testFile instanceof RegExp && b.codeFile instanceof RegExp, a)
    assert.equal(b.guide, `${a}-writing.md`)
    assert.ok(b.defaultLayers.length >= 1 && b.defaultLayers.every(l => l.name && l.folder.endsWith('/')), a)
  }
  assert.equal(BACKENDS.vitest.stryker, true)
  assert.equal(BACKENDS.vitest.typeCheck, 'tsc')
  for (const a of OTHERS) { assert.equal(BACKENDS[a].stryker, false, a); assert.equal(BACKENDS[a].typeCheck, null, a) }
  assert.equal(BACKENDS.go.defaultLayers[0].folder, './')
  assert.ok(isBackend('pytest') && !isBackend('playwright') && !isBackend('fullstack') && !isBackend('toString'))
  assert.equal(runnerLabel('playwright'), 'Playwright')
  assert.equal(runnerLabel('dotnet'), '.NET')
})

test('the test file names of each stack, and code that is not a test', () => {
  const tests = {
    pytest: ['tests/test_orders.py', 'app/orders_test.py'],
    junit: ['src/test/java/com/acme/OrderTest.java', 'src/test/java/OrderTests.java', 'src/test/java/OrderIT.java', 'src/test/kotlin/OrderTest.kt'],
    go: ['orders/total_test.go'],
    dotnet: ['tests/Orders.Tests/OrderTests.cs', 'tests/OrderTest.cs', 'tests/OrderTests.fs'],
  }
  const code = { pytest: ['app/orders.py', 'tests/conftest.py'], junit: ['src/main/java/Order.java', 'src/main/java/Latest.java'], go: ['orders/total.go'], dotnet: ['src/Order.cs', 'src/Contest.cs'] }
  for (const a of OTHERS) {
    for (const p of tests[a]) assert.ok(BACKENDS[a].testFile.test(p), `${a} test ${p}`)
    for (const p of code[a]) { assert.ok(!BACKENDS[a].testFile.test(p), `${a} not test ${p}`); assert.ok(BACKENDS[a].codeFile.test(p), `${a} code ${p}`) }
  }
})

test('backendOf: the adapter on a backend project, backend on fullstack, null on frontend', () => {
  assert.equal(backendOf({ adapter: 'pytest', backend: 'pytest' }), 'pytest')
  assert.equal(backendOf({ adapter: 'vitest', backend: 'vitest' }), 'vitest')
  assert.equal(backendOf({ frontend: 'playwright', backend: 'vitest' }), 'vitest')
  assert.equal(backendOf({ frontend: 'playwright', backend: 'go' }), 'go')
  assert.equal(backendOf({ adapter: 'playwright', frontend: 'playwright' }), null)
  assert.equal(backendOf(null), null)
})

test('config: every backend is an adapter, with its own block of options', () => {
  for (const a of OTHERS) {
    const r = valid({ ...sides(a), [a]: { layers: [{ name: 'unit', folder: 'src/test/' }], timeoutSeconds: 120, command: 'make test FILES="{files}" REPORT={report} ONLY={test}' } })
    assert.equal(r.ok, true, `${a}: ${r.errors?.join(' | ')}`)
    assert.equal(timeoutSecondsOf(r.config), 120)
    assert.equal(commandOf(r.config), 'make test FILES="{files}" REPORT={report} ONLY={test}')
    assert.deepEqual(layersOf(r.config), [{ name: 'unit', folder: 'src/test/' }])
    assert.deepEqual(adapterOptions(r.config), r.config[a])
    // Defaults: the backend's own layers and timeout.
    const d = valid({ ...sides(a) }).config
    assert.deepEqual(layersOf(d), BACKENDS[a].defaultLayers)
    assert.equal(timeoutSecondsOf(d), BACKENDS[a].timeoutSeconds)
    assert.equal(commandOf(d), null)
  }
  assert.equal(valid({ backend: 'pytest', pytest: { typeCheck: 'mypy {files}' } }).ok, true)
  assert.deepEqual(valid({ backend: 'go', go: { layers: [{ name: 'unit', folder: './' }] } }).errors, undefined)
})

test('config: a backend block only on its own project, with only its own fields', () => {
  assert.deepEqual(valid({ backend: 'vitest', pytest: {} }).errors, ['pytest: only allowed with "backend": "pytest"'])
  assert.deepEqual(valid({ frontend: 'playwright', backend: 'vitest', junit: {} }).errors, ['junit: only allowed with "backend": "junit"'])
  assert.deepEqual(valid({ backend: 'go', go: [] }).errors, ['go: must be an object'])
  assert.deepEqual(valid({ backend: 'junit', junit: { typeCheck: 'x', stryker: {} } }).errors, [
    'junit.typeCheck: unknown field (only "layers", "timeoutSeconds" or "command")',
    'junit.stryker: unknown field (only "layers", "timeoutSeconds" or "command")',
  ])
  assert.deepEqual(valid({ backend: 'dotnet', dotnet: { timeoutSeconds: 5, command: 'dotnet test\nrm -rf /' } }).errors, [
    'dotnet.timeoutSeconds: must be a whole number from 10 to 3600',
    'dotnet.command: must be one line of text, the project\'s test command, like "make test"',
  ])
  assert.deepEqual(valid({ backend: 'pytest', pytest: { command: 'pytest {files} --junitxml={out}', typeCheck: '' } }).errors, [
    'pytest.command: unknown placeholder {out} (only {files}, {report} and {test})',
    'pytest.typeCheck: must be one line of text, the type-check command, like "mypy {files}"',
  ])
  assert.deepEqual(valid({ backend: 'pytest', pytest: { layers: [{ name: 'Unit', folder: 'tests' }] } }).errors, [
    'pytest.layers[0].name "Unit" must be lower-case letters, digits and "-", starting with a letter, like "unit"',
    'pytest.layers[0].folder "tests" must end with "/"',
  ])
  // The vitest block stays Vitest's: a fullstack project on another backend has none.
  const fsPy = { frontend: 'playwright', backend: 'pytest' }
  assert.deepEqual(valid({ ...fsPy, vitest: {} }).errors, ['vitest: only allowed with "backend": "vitest"'])
})

test('config: backend names a backend runner, alone or with a frontend', () => {
  const r = valid({ frontend: 'playwright', backend: 'pytest', pytest: { layers: [{ name: 'api', folder: 'api/tests/' }] } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.deepEqual(layersOf(r.config), [{ name: 'api', folder: 'api/tests/' }])
  assert.deepEqual(valid({ frontend: 'playwright', backend: 'playwright' }).errors, ['backend: must be "vitest", "pytest", "junit", "go" or "dotnet" (found "playwright")'])
  assert.equal(valid({ frontend: 'playwright', backend: 'vitest', vitest: { layers: [{ name: 'unit', folder: 'test/' }] } }).ok, true)
})

test('config: Vitest keeps its layers, defaults and timeouts', () => {
  const v = valid({ backend: 'vitest' }).config
  assert.deepEqual(layersOf(v), [{ name: 'unit', folder: 'test/' }])
  assert.equal(timeoutSecondsOf(v), 300)
  assert.equal(timeoutSecondsOf(valid({ frontend: 'playwright' }).config), 600)
  assert.deepEqual(layersOf(valid({ frontend: 'playwright' }).config), [{ name: 'unit', folder: 'test/' }])
  assert.deepEqual(valid({ backend: 'vitest', vitest: { layers: [{ name: 'unit', folder: 'src/' }] } }).errors, ['vitest.layers[0].folder "src/" is inside the forbidden "src/"'])
})

test('stack: every backend is the backend side; fullstack runs its backend with Playwright', () => {
  for (const a of BACKEND_ADAPTERS) {
    assert.equal(sideOfAdapter(a), 'backend', a)
    assert.equal(stackOf({ adapter: a, ...(a === 'playwright' ? { frontend: a } : { backend: a }) }), 'backend', a)
    assert.deepEqual(adaptersOf({ adapter: a, ...(a === 'playwright' ? { frontend: a } : { backend: a }) }), [a])
  }
  const fs = { frontend: 'playwright', backend: 'go', playwright: { folder: 'e2e/' } }
  assert.deepEqual(adaptersOf(fs), ['go', 'playwright'])
  assert.deepEqual(adaptersOf({ frontend: 'playwright', backend: 'vitest' }), ['vitest', 'playwright'])
  assert.deepEqual(adaptersForSide('backend', fs), ['go'])
  assert.deepEqual(adaptersForSide('fullstack', fs), ['go', 'playwright'])
  assert.deepEqual(adaptersForSide(null, fs), ['go', 'playwright'])
  assert.deepEqual(adaptersForSide('frontend', fs), ['playwright'])
  assert.deepEqual(adaptersForSide('backend'), ['vitest'])
  assert.deepEqual(adaptersForSide('backend', { adapter: 'dotnet', backend: 'dotnet' }), ['dotnet'])
  const d = mkdtempSync(join(tmpdir(), 'qc-be-'))
  assert.equal(adapterOfSpec(fs, d, 'orders/total_test.go'), 'go')
  assert.equal(adapterOfSpec(fs, d, 'e2e/orders.spec.ts'), 'playwright')
  assert.deepEqual(specsByAdapter(fs, d, ['e2e/a.spec.ts', 'orders/total_test.go']), [['go', ['orders/total_test.go']], ['playwright', ['e2e/a.spec.ts']]])
})

test('every backend has a dialect of the vitest shape; compiled stacks mutate in place', () => {
  // Every key Vitest's has; a dialect may add the checks' optional hooks (suite.marks, mutation.ranges, …).
  const V = dialectFor('vitest')
  const shape = d => ({
    name: typeof d.name, groupRe: d.groupRe instanceof RegExp, honesty: Object.keys(V.honesty).every(k => k in d.honesty), suite: Object.keys(V.suite).every(k => k in d.suite),
    mutation: ['expectRe', 'testRe', 'rank', 'flips', 'eligible', 'plan'].every(k => k in d.mutation),
  })
  for (const a of OTHERS) {
    const d = dialectFor(a)
    assert.equal(d.name, a)
    assert.deepEqual(shape(d), shape(dialectFor('vitest')), a)
    assert.equal(d.mutation.inPlace, a !== 'pytest', a)
  }
  assert.notEqual(dialectFor('vitest').mutation.inPlace, true)
})

test('branch kinds: each backend\'s test names are tests, its sources code; JS/TS as always', () => {
  assert.equal(kindOf('tests/test_orders.py', 'pytest'), 'test')
  assert.equal(kindOf('app/orders.py', 'pytest'), 'code')
  assert.equal(kindOf('src/test/java/com/acme/OrderTest.java', 'junit'), 'test')
  assert.equal(kindOf('src/main/java/com/acme/Order.java', 'junit'), 'code')
  assert.equal(kindOf('src/main/kotlin/Order.kt', 'junit'), 'code')
  assert.equal(kindOf('orders/total_test.go', 'go'), 'test')
  assert.equal(kindOf('orders/total.go', 'go'), 'code')
  assert.equal(kindOf('tests/Orders.Tests/OrderTests.cs', 'dotnet'), 'test')
  assert.equal(kindOf('src/Orders/Order.cs', 'dotnet'), 'code')
  assert.equal(kindOf('README.md', 'go'), 'other')
  // A Python file is "other" to a Vitest project, as before; fullstack passes its backend along.
  assert.equal(kindOf('app/orders.py', 'vitest'), 'other')
  assert.equal(kindOf('tests/test_orders.py', 'playwright', ['e2e/'], 'pytest'), 'test')
  assert.equal(kindOf('app/orders.py', 'playwright', ['e2e/'], 'pytest'), 'code')
  assert.equal(kindOf('e2e/helpers.ts', 'playwright', ['e2e/'], 'pytest'), 'test')
})

test('boundary: a backend\'s test files go through a forbidden code folder; Vitest\'s rules stay as they are', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-bd-'))
  const junit = rulesFor({ adapter: 'junit', backend: 'junit' }, d)
  assert.equal(violation('src/test/java/com/acme/OrderTest.java', junit), null)
  assert.ok(violation('src/main/java/com/acme/Order.java', junit))
  assert.ok(violation('src/test/java/Helpers.java', junit))
  const go = rulesFor({ frontend: 'playwright', backend: 'go' }, d)
  assert.equal(violation('src/orders/total_test.go', go), null)
  assert.ok(violation('src/orders/total.go', go))
  assert.ok(violation('.claude/quality-code.json', go), 'the plugin\'s own files stay out of reach')
  const vitest = rulesFor({ adapter: 'vitest', backend: 'vitest' }, d)
  assert.equal(vitest.tests, null)
  assert.ok(violation('src/orders.spec.ts', vitest))
})

test('the spec listing walks each backend\'s layers by its own test names; Go\'s "./" is the whole repo', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-ps-'))
  put(d, 'orders/total_test.go'); put(d, 'orders/total.go'); put(d, 'total_test.go'); put(d, 'vendor/x/y_test.go'); put(d, 'e2e/orders.spec.ts')
  assert.deepEqual(projectSpecs(d, { adapter: 'go', backend: 'go' }).map(s => s.path).sort(), ['orders/total_test.go', 'total_test.go'])
  assert.deepEqual(projectSpecs(d, { frontend: 'playwright', backend: 'go', playwright: { folder: 'e2e/' } }).sort((a, b) => (a.path < b.path ? -1 : 1)),
    [{ path: 'e2e/orders.spec.ts', adapter: 'playwright' }, { path: 'orders/total_test.go', adapter: 'go' }, { path: 'total_test.go', adapter: 'go' }])
  const p = mkdtempSync(join(tmpdir(), 'qc-py-'))
  put(p, 'tests/test_orders.py'); put(p, 'tests/conftest.py'); put(p, 'tests/unit/orders_test.py'); put(p, 'tests/a.spec.ts')
  assert.deepEqual(projectSpecs(p, { adapter: 'pytest', backend: 'pytest' }).map(s => s.path).sort(), ['tests/test_orders.py', 'tests/unit/orders_test.py'])
})

test('rubric: every backend scores with the backend rubric, as Vitest does', () => {
  const ticket = { key: 'ABC-1', summary: 'Orders total', issuetype: 'Story', labels: [], text: { description: '## Acceptance criteria\nScenario: total\nGiven an order of 3 items at 40.00 each\nWhen the total is computed\nThen the total is 108.00\n## Context\nOrders get a volume discount.' } }
  const v = buildBrief(valid({ backend: 'vitest' }).config, ticket)
  for (const a of OTHERS) {
    const c = valid({ ...sides(a) }).config
    assert.equal(rubricFor(c).id, 'vitest', a)
    const b = buildBrief(c, ticket)
    assert.deepEqual({ ...b }, { ...v }, a)
    assert.equal(formatReport(b), formatReport(v), a)
  }
  const fs = valid({ frontend: 'playwright', backend: 'pytest' }).config
  const be = buildBrief(fs, { ...ticket, summary: '[BE] Orders total' })
  assert.equal(be.rubric, 'vitest')
  assert.equal(be.score, buildBrief(valid({ frontend: 'playwright', backend: 'vitest' }).config, { ...ticket, summary: '[BE] Orders total' }).score)
  assert.match(formatReport(be), /Side: backend: pytest tests of the code/)
  assert.match(formatReport(buildBrief(valid({ frontend: 'playwright', backend: 'vitest' }).config, { ...ticket, summary: '[BE] Orders total' })), /Side: backend: Vitest tests of the code/)
})
