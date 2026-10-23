// The generic tier: any other JavaScript runner (Jest, Mocha, Cypress) through the shared checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runPipeline } from '../../lib/pipeline/pipeline.mjs'
import { formatCard } from '../../lib/pipeline/card.mjs'
import { flipMutations } from '../../lib/base/dialects/generic.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'
import { runnerLabel, runnerOf } from '../../lib/base/runners.mjs'
import { validateConfig } from '../../lib/base/config.mjs'
import { e2eFolder } from '../../lib/base/e2e-folder.mjs'
import { countAssertions, scoreSpec } from '../../lib/pipeline/checks/suite-honesty.mjs'
import { scanDiff } from '../../lib/pipeline/checks/honesty.mjs'
import { planMutants } from '../../lib/pipeline/checks/mutation.mjs'
import { HOW, genericRunner, parseCypress, parseMocha, runGeneric } from '../../lib/pipeline/runners/generic.mjs'
import { result } from '../../lib/base/result.mjs'
import { calls, fakeBin } from '../fake-bin.mjs'
import { ENV } from '../git-env.mjs'

const base = { version: 1, jira: { site: 'https://e.atlassian.net', projects: ['ABC'] } }
const unit = dialectFor('jest')
const e2e = dialectFor('cypress')
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('runners: the config names another runner per kind; Vitest and Playwright stay the default and the specialized', () => {
  assert.equal(runnerOf({ adapter: 'vitest' }), 'vitest')
  assert.equal(runnerOf({ adapter: 'vitest', runners: { unit: 'jest' } }), 'jest')
  assert.equal(runnerOf({ adapter: 'fullstack', runners: { e2e: 'cypress' } }, 'playwright'), 'cypress')
  assert.equal(runnerOf({ adapter: 'fullstack', runners: { e2e: 'cypress' } }, 'vitest'), 'vitest')
  assert.deepEqual(['vitest', 'jest', 'cypress'].map(runnerLabel), ['Vitest', 'Jest (generic checks)', 'Cypress (generic checks)'])
  assert.equal(validateConfig({ ...base, adapter: 'vitest', runners: { unit: 'mocha' } }).ok, true)
  assert.equal(validateConfig({ ...base, adapter: 'fullstack', runners: { unit: 'jest', e2e: 'cypress' } }).ok, true)
  for (const [runners, adapter, re] of [
    [{ unit: 'karma' }, 'vitest', /runners\.unit: must be "vitest", "jest", "mocha"/],
    [{ unit: 'cypress' }, 'vitest', /runners\.unit: must be/],
    [{ e2e: 'cypress' }, 'vitest', /runners\.e2e: only allowed with "adapter": "playwright" or "fullstack"/],
    [{ api: 'jest' }, 'vitest', /runners\.api: unknown field/],
    ['jest', 'vitest', /runners: must be an object/],
  ]) assert.match(validateConfig({ ...base, adapter, runners }).errors.join('\n'), re, JSON.stringify(runners))
})

// AGT-128 beside the generic tier: runners.unit is a JavaScript runner, so only for a Vitest backend.
test('runners with the non-JavaScript backends: runners.unit is refused beside them, runners.e2e still works', async () => {
  const { isSpecialized } = await import('../../lib/base/runners.mjs')
  for (const [cfg, backend] of [[{ adapter: 'pytest' }, 'pytest'], [{ adapter: 'fullstack', backend: 'go' }, 'Go']]) {
    const errs = validateConfig({ ...base, ...cfg, runners: { unit: 'jest' } }).errors.join('\n')
    assert.match(errs, new RegExp(`runners\\.unit: "jest" runs JavaScript tests, and this project's backend is ${backend}`), JSON.stringify(cfg))
  }
  assert.equal(validateConfig({ ...base, adapter: 'fullstack', backend: 'pytest', runners: { e2e: 'cypress' } }).ok, true)
  assert.equal(validateConfig({ ...base, adapter: 'fullstack', backend: 'vitest', runners: { unit: 'jest' } }).ok, true)
  const cfg = { adapter: 'fullstack', backend: 'pytest', runners: { e2e: 'cypress' } }
  assert.equal(runnerOf(cfg, 'pytest'), 'pytest')
  assert.equal(runnerOf(cfg, 'playwright'), 'cypress')
  for (const b of ['pytest', 'junit', 'go', 'dotnet']) {
    assert.equal(isSpecialized(b), true, b)
    assert.equal(dialectFor(b).name, b)
  }
  assert.deepEqual(['pytest', 'junit', 'go', 'dotnet', 'jest'].map(runnerLabel), ['pytest', 'JUnit', 'Go', '.NET', 'Jest (generic checks)'])
})
test('an x- or f- prefix is a skip or a focus only on a JavaScript test word: Go\'s func TestX is no fit', async () => {
  const marks = scoreSpec('// ABC-1 sums\nfunc TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 { t.Errorf("got %d", got) }\n}\n', dialectFor('go'))
  assert.ok(marks.length >= 1)
  assert.ok(marks.every(m => m.mod !== 'only'), JSON.stringify(marks))
  const { groups } = await import('../../lib/pipeline/checks/suite-honesty.mjs')
  assert.deepEqual(groups('func TestSum(t *testing.T) {\n}\n', dialectFor('go')).map(g => g.mod), [null])
  assert.equal(scoreSpec("fit('ABC-1 a', () => { expect(1).toBe(1) })\n", unit)[0].mod, 'only')
})

test('dialect: Vitest and Playwright keep their own; every other runner gets the generic one of its kind', () => {
  assert.equal(dialectFor('vitest').name, 'vitest')
  assert.equal(dialectFor('playwright').name, 'playwright')
  assert.deepEqual([unit.name, e2e.name, dialectFor('mocha').name], ['generic', 'generic', 'generic'])
  assert.equal(unit.expected.fieldNames, true, 'a unit test reads the fields the ticket names')
  assert.equal(e2e.expected.readsActual, true, 'an e2e test reads what the screen shows')
  assert.ok(e2e.expected.matchers.includes('should'))
})

test('flips: expect matchers, Chai chains, and Cypress .should that only ever waits to fail', () => {
  const kinds = s => flipMutations(s).map(f => `${f.kind} ${f.text}`)
  assert.deepEqual(kinds('expect(sum(1, 2)).toBe(3)'), ['invert-matcher expect(sum(1, 2)).not.toBe(3)', 'num→n+1 expect(sum(1, 2)).toBe(4)'])
  assert.deepEqual(kinds('expect(sum(1, 2)).to.equal(3)'), ['invert-matcher expect(sum(1, 2)).to.not.equal(3)', 'num→n+1 expect(sum(1, 2)).to.equal(4)'])
  assert.deepEqual(kinds('expect(x).to.not.equal(3)'), ['drop-not expect(x).to.equal(3)', 'num→n+1 expect(x).to.not.equal(4)'])
  assert.deepEqual(kinds('expect(ok).to.be.true'), ['invert-matcher expect(ok).to.not.be.true', 'truthy→falsy expect(ok).to.be.false'])
  assert.deepEqual(kinds("expect(list).to.include('a')"), ["invert-matcher expect(list).to.not.include('a')", "corrupt-string expect(list).to.include('a★MUT')"])
  // A retried .should is never negated: it would pass while the screen loads.
  assert.deepEqual(kinds(".should('have.text', 'Orders')"), ["corrupt-string .should('have.text', 'Orders★MUT')"])
  assert.deepEqual(kinds(".should('have.length', 3)"), ["num→n+1 .should('have.length', 4)"])
  assert.deepEqual(kinds(".should('be.visible').and('contain', 'x')"), [".should('have.length', 999).and('contain', 'x')"].map(t => `impossible-count ${t}`))
  assert.deepEqual(kinds(".should('not.exist')"), ["drop-not .should('exist')"])
  assert.deepEqual(kinds('.should(($el) => { expect($el).to.have.length(1) })'), [], 'a callback: its own expect is mutated instead')
})

test('suite honesty: Chai property chains and Cypress .should count; x- and f- prefixes skip and focus', () => {
  assert.equal(countAssertions('expect(ok).to.be.true'), 0, 'not without the generic tier')
  assert.equal(countAssertions('expect(ok).to.be.true', { chai: true }), 1)
  assert.equal(countAssertions("cy.get('#a').should('be.visible').and('contain', 'x')", { chai: true }), 1)
  assert.equal(countAssertions('expect(x)', { chai: true }), 0, 'a bare expect asserts nothing')
  const src = "describe('ABC-1 Sums', () => {\n  it('a', () => { expect(1).to.equal(1) })\n  xit('b', () => { expect(1).toBe(1) })\n  fit('c', () => { cy.get('x').should('exist') })\n  it.todo('d')\n  it('e', () => { sum(1, 2) })\n})\nxdescribe('ABC-2 Off', () => {\n  it('f', () => {})\n})\n"
  assert.deepEqual(scoreSpec(src, unit).map(t => [t.title, t.mod, t.expects]), [['a', null, 1], ['b', 'skip', 1], ['c', 'only', 1], ['d', 'todo', 0], ['e', null, 0], ['f', 'skip', 0]])
})

test('honesty: a removed .should or Chai assertion, a new xit or fit', () => {
  const diff = ["+++ b/cypress/e2e/a.cy.ts", "-    cy.get('#total').should('have.text', '8')", "+  xit('pays', () => {", "+  fit('lists', () => {", "+++ b/test/a.spec.ts", '-    expect(sum(1, 2)).to.equal(3)'].join('\n')
  assert.deepEqual(scanDiff(diff, e2e, '(?:ABC)-\\d+').map(v => `${v.file} ${v.kind}`), [
    'cypress/e2e/a.cy.ts assertion removed', 'cypress/e2e/a.cy.ts test newly skipped', 'cypress/e2e/a.cy.ts test newly skipped', 'test/a.spec.ts assertion removed'])
})

test('mutation plan: one mutant per assertion of a green test, in each style', () => {
  const src = "describe('ABC-1 Orders', () => {\n  it('shows the total', () => {\n    cy.visit('/')\n    cy.get('#total').should('have.text', '8')\n  })\n  it('counts', () => {\n    expect(count()).to.equal(2)\n  })\n})\n"
  const m = planMutants(src, ['shows the total', 'counts'], { key: 'ABC-1' }, e2e)
  assert.deepEqual(m.map(x => [x.title, x.kind]), [['shows the total', 'corrupt-string'], ['counts', 'invert-matcher']])
})

test('parseMocha: status from failures and pending, the describe path from the full title, a failed hook as a broken file', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qc-mocha-')))
  const f = join(root, 'test/a.spec.js')
  const t = (title, err = {}) => ({ title, fullTitle: `ABC-1 Sums ${title}`, file: f, err })
  const json = { tests: [t('adds'), t('fails', { message: 'expected 2 to equal 3\n  at x' }), t('later')], failures: [t('fails', { message: 'expected 2 to equal 3\n  at x' }), { title: '"before all" hook', fullTitle: 'ABC-2 "before all" hook', file: join(root, 'test/b.spec.js'), err: { message: 'db down' } }], pending: [t('later')] }
  assert.deepEqual(parseMocha(json, root), {
    tests: [
      { title: 'adds', path: ['ABC-1 Sums'], file: 'test/a.spec.js', status: 'passed', message: '' },
      { title: 'fails', path: ['ABC-1 Sums'], file: 'test/a.spec.js', status: 'failed', message: 'expected 2 to equal 3' },
      { title: 'later', path: ['ABC-1 Sums'], file: 'test/a.spec.js', status: 'skipped', message: '' },
    ],
    broken: [{ file: 'test/b.spec.js', message: 'db down' }],
  })
})

test('parseCypress: a test per title path, a spec that failed to load as broken, a run that never started as an error', () => {
  const json = { runs: [
    { spec: { relative: 'cypress/e2e/a.cy.js' }, error: null, tests: [{ title: ['ABC-1 Orders', 'shows'], state: 'passed' }, { title: ['ABC-1 Orders', 'fails'], state: 'failed', displayError: 'AssertionError: expected 1\n at x' }, { title: ['ABC-1 Orders', 'later'], state: 'pending' }] },
    { spec: { relative: 'cypress/e2e/b.cy.js' }, error: 'Error: Webpack Compilation Error\nmore', tests: [] },
  ] }
  assert.deepEqual(parseCypress(json), {
    tests: [
      { title: 'shows', path: ['ABC-1 Orders'], file: 'cypress/e2e/a.cy.js', status: 'passed', message: '' },
      { title: 'fails', path: ['ABC-1 Orders'], file: 'cypress/e2e/a.cy.js', status: 'failed', message: 'AssertionError: expected 1' },
      { title: 'later', path: ['ABC-1 Orders'], file: 'cypress/e2e/a.cy.js', status: 'skipped', message: '' },
    ],
    broken: [{ file: 'cypress/e2e/b.cy.js', message: 'Error: Webpack Compilation Error' }],
  })
  assert.deepEqual(parseCypress({ status: 'failed', message: 'Could not find Cypress test run results' }), { tests: [], broken: [], error: 'Could not find Cypress test run results' })
})

test('runGeneric: Jest by exact path with its JSON report and -t for one test; Mocha with its JSON reporter and --grep', async () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'qc-gen-')))
  fakeBin(d, 'jest', { report: { testResults: [{ name: join(d, 'test/a.spec.js'), status: 'passed', assertionResults: [{ ancestorTitles: ['ABC-1 Sums'], title: 'adds', status: 'passed' }] }] } })
  const r = await runGeneric(d, 'jest', ['test/a.spec.js'], { testName: 'adds', timeoutMs: 20000 })
  assert.deepEqual(r, { ran: true, tests: [{ title: 'adds', path: ['ABC-1 Sums'], file: 'test/a.spec.js', status: 'passed', message: '' }], broken: [] })
  const args = calls(d, 'jest')[0]
  assert.deepEqual(args.slice(-2), ['--runTestsByPath', 'test/a.spec.js'], 'exact paths: a mutant beside the spec is never matched by the spec\'s pattern')
  assert.ok(args.includes('--json') && args.includes('-t'))
  fakeBin(d, 'mocha', { report: { tests: [{ title: 'adds', fullTitle: 'ABC-1 Sums adds', file: join(d, 'test/a.spec.js'), err: {} }], failures: [], pending: [] } })
  const m = await runGeneric(d, 'mocha', ['test/a.spec.js'], { testName: 'adds', timeoutMs: 20000 })
  assert.equal(m.tests[0].status, 'passed')
  assert.deepEqual(calls(d, 'mocha')[0].slice(0, 3), ['test/a.spec.js', '--reporter', 'json'])
  assert.ok(calls(d, 'mocha')[0].includes('--grep'))
  assert.deepEqual(await runGeneric(mkdtempSync(join(tmpdir(), 'qc-gen-')), 'jest', ['a.spec.js'], { timeoutMs: 1000 }), { ran: false, error: 'Jest is not installed in this project' })
})

test('runGeneric: Cypress through its Module API, with its artifacts kept out of the project; a down app said plainly', async () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'qc-cy-')))
  const fake = (body, log = '') => {
    put(d, 'node_modules/cypress/package.json', JSON.stringify({ name: 'cypress', main: 'index.js', bin: { cypress: 'index.js' } }))
    put(d, 'node_modules/cypress/index.js', `module.exports = { run: async opts => { require('fs').writeFileSync(${JSON.stringify(join(d, 'opts.json'))}, JSON.stringify(opts)); ${log ? `console.log(${JSON.stringify(log)});` : ''} return ${JSON.stringify(body)} } }`)
  }
  fake({ runs: [{ spec: { relative: 'cypress/e2e/a.cy.js' }, tests: [{ title: ['ABC-1 Orders', 'shows'], state: 'passed' }] }] })
  const r = await runGeneric(d, 'cypress', ['cypress/e2e/a.cy.js'], { timeoutMs: 20000 })
  assert.deepEqual(r.tests, [{ title: 'shows', path: ['ABC-1 Orders'], file: 'cypress/e2e/a.cy.js', status: 'passed', message: '' }])
  const opts = JSON.parse(readFileSync(join(d, 'opts.json'), 'utf8'))
  assert.equal(opts.spec, 'cypress/e2e/a.cy.js')
  assert.ok(!opts.config.screenshotsFolder.startsWith(d) && !opts.config.videosFolder.startsWith(d), 'screenshots and videos go to a temp folder')
  fake({ status: 'failed', message: 'Could not find Cypress test run results' }, 'Cypress could not verify that this server is running:\n  > http://localhost:5199')
  assert.deepEqual(await runGeneric(d, 'cypress', ['cypress/e2e/a.cy.js'], { timeoutMs: 20000 }), { ran: false, error: 'the app is not reachable at http://localhost:5199: start it, then run again' })
  assert.deepEqual(Object.keys(HOW), ['jest', 'mocha', 'cypress'])
})

test('genericRunner: specs grouped by the config that runs them (vitest.configs for Jest)', async () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'qc-gen-')))
  fakeBin(d, 'jest', { report: { testResults: [] } })
  const run = genericRunner(d, { adapter: 'vitest', runners: { unit: 'jest' }, vitest: { configs: [{ match: 'test/int/**', config: 'jest.int.config.js' }] } }, 'jest')
  await run({ files: ['test/a.spec.js', 'test/int/b.spec.js'] })
  const c = calls(d, 'jest')
  assert.equal(c.length, 2)
  assert.ok(!c[0].includes('--config'))
  assert.equal(c[1][c[1].indexOf('--config') + 1], 'jest.int.config.js')
})

test('pipeline: a Jest project runs the generic checks, its card says so, and Stryker is not applicable', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  const SPEC = "describe('ABC-1 Sums', () => {\n  it('adds', () => {\n    expect(sum(1, 2)).toBe(3)\n  })\n})\n"
  put(d, 'test/a.spec.js', SPEC)
  const config = { adapter: 'vitest', runners: { unit: 'jest' }, jira: { projects: ['ABC'] } }
  const runTests = async ({ files, testName }) => {
    const changed = readFileSync(join(d, files[0]), 'utf8') !== SPEC
    return { ran: true, broken: [], tests: [{ title: 'adds', path: ['ABC-1 Sums'], file: files[0], status: testName && changed ? 'failed' : 'passed', message: '' }] }
  }
  const ok = async () => result('types', 'pass', 'no TypeScript specs', [], { applicable: false })
  const r = await runPipeline({ specs: ['test/a.spec.js'], key: 'ABC-1', target: 'src/sum.js' }, { config, dialect: dialectFor(runnerOf(config)), root: d, runTests, typeCheck: ok })
  assert.equal(r.verdict, 'green')
  assert.deepEqual(r.runners, ['jest'])
  const stryker = r.steps.find(s => s.check === 'stryker')
  assert.deepEqual([stryker.status, stryker.data.applicable, stryker.summary], ['pass', false, 'not applicable: Stryker runs with Vitest only, not Jest'])
  assert.match(formatCard(r, { specs: ['test/a.spec.js'], key: 'ABC-1' }).split('\n')[0], /· Jest \(generic checks\) · ticket ABC-1$/)
  const vitest = await runPipeline({ specs: ['test/a.spec.js'], key: 'ABC-1' }, { config: { ...config, runners: undefined }, dialect: dialectFor('vitest'), root: d, runTests, typeCheck: ok, runStryker: async () => ({ ran: false, error: 'Stryker is not installed' }) })
  assert.equal(vitest.runners, undefined, 'the specialized suite is not named on the card, as before')
})

test('e2e folder: a Cypress project\'s specs are in cypress/e2e/ unless playwright.folder says otherwise', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-cy-'))
  const cfg = { ...base, adapter: 'playwright', runners: { e2e: 'cypress' } }
  assert.deepEqual(e2eFolder(d, cfg), { ok: true, folder: 'cypress/e2e/', source: 'cypress' })
  assert.equal(e2eFolder(d, { ...cfg, playwright: { folder: 'cy/' } }).folder, 'cy/')
})
