// What a branch changed, as CI needs it: the side of each file and the specs it touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHARED_CONFIG, moduleOf, planChanges, sideOfCode } from '../../lib/base/changes.mjs'

const jira = { site: 'https://x.atlassian.net', projects: ['ABC'] }
const full = { version: 1, adapter: 'fullstack', jira, playwright: { folder: 'e2e/' } }
const be = { version: 1, adapter: 'vitest', jira }
const fe = { version: 1, adapter: 'playwright', jira, playwright: { folder: 'e2e/' } }
const py = { version: 1, adapter: 'fullstack', backend: 'pytest', jira, playwright: { folder: 'e2e/' } }

test('a one-sided project: every code file is that side', () => {
  assert.equal(sideOfCode('src/a.ts', be), 'backend')
  assert.equal(sideOfCode('src/a.tsx', fe), 'frontend')
})

test('a fullstack project: the extension and the folder say the side, else both', () => {
  assert.equal(sideOfCode('web/src/App.vue', full), 'frontend')
  assert.equal(sideOfCode('src/components/Button.ts', full), 'frontend')
  assert.equal(sideOfCode('server/orders.ts', full), 'backend')
  assert.equal(sideOfCode('src/api/orders.ts', full), 'backend')
  assert.equal(sideOfCode('src/shared/money.ts', full), 'both', 'the path does not say: both sides run')
  assert.equal(sideOfCode('app/service/orders.py', py), 'backend', "pytest's own code files are the backend's")
})

test('shared config and dependency files are recognised', () => {
  for (const f of ['package.json', 'web/package-lock.json', 'tsconfig.build.json', 'vitest.config.ts', 'playwright.config.ts', 'pom.xml', 'go.mod', 'requirements-dev.txt', 'App/App.csproj', '.claude/quality-code.json']) assert.ok(SHARED_CONFIG.test(f), f)
  for (const f of ['README.md', 'src/a.ts', 'docs/package.json.md']) assert.equal(SHARED_CONFIG.test(f), false, f)
})

const known = [
  { path: 'test/unit/a.spec.ts', adapter: 'vitest' },
  { path: 'test/integration/b.spec.ts', adapter: 'vitest' },
  { path: 'e2e/orders/c.spec.ts', adapter: 'playwright' },
  { path: 'e2e/home.spec.ts', adapter: 'playwright' },
]
const cfg = { ...full, vitest: { layers: [{ name: 'unit', folder: 'test/unit/' }, { name: 'integration', folder: 'test/integration/' }] } }
const f = (path, kind = 'test', status = 'M') => ({ path, kind, status })

test('changed specs are grouped by side; deleted ones and files outside the test folders are left out', () => {
  const p = planChanges([f('test/unit/a.spec.ts'), f('e2e/orders/c.spec.ts', 'test', 'A'), f('test/integration/b.spec.ts', 'test', 'D'), f('other/x.spec.ts')], cfg, known)
  assert.deepEqual([...p.backend.specs.keys()], ['test/unit/a.spec.ts'])
  assert.deepEqual([...p.frontend.specs.keys()], ['e2e/orders/c.spec.ts'])
  assert.equal(p.backend.source || p.frontend.source, false)
})

test('source files mark their side; an undecided path marks both; docs mark nothing', () => {
  let p = planChanges([f('server/orders.ts', 'code')], cfg, known)
  assert.deepEqual([p.backend.source, p.frontend.source], [true, false])
  p = planChanges([f('src/shared/money.ts', 'code')], cfg, known)
  assert.deepEqual([p.backend.source, p.frontend.source], [true, true])
  p = planChanges([f('README.md', 'other'), f('docs/a.md', 'other')], cfg, known)
  assert.deepEqual([p.backend.source, p.frontend.source, p.backend.shared], [false, false, false])
})

test('a shared config file marks both sides', () => {
  const p = planChanges([f('package.json', 'other')], cfg, known)
  assert.deepEqual([p.backend.shared, p.frontend.shared], [true, true])
})

test('the module is the backend layer or the first e2e folder', () => {
  assert.equal(moduleOf(cfg, '/nowhere', 'test/unit/a.spec.ts', 'vitest'), 'unit')
  assert.equal(moduleOf(cfg, '/nowhere', 'test/integration/b.spec.ts', 'vitest'), 'integration')
  assert.equal(moduleOf(cfg, '/nowhere', 'e2e/orders/c.spec.ts', 'playwright'), 'orders')
  assert.equal(moduleOf(cfg, '/nowhere', 'e2e/home.spec.ts', 'playwright'), 'e2e')
})
