import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configFor, filePattern, parseReport, playwrightRunner, titlePattern } from '../../../lib/pipeline/runners/playwright.mjs'
import { calls, fakeBin } from '../../fake-bin.mjs'

// The describe path each result carries is checked on its own (below); these compare the rest.
const bare = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'path' ? undefined : v)))

const cfg = (playwright = undefined) => ({ adapter: 'playwright', jira: { projects: ['ABC'] }, ...(playwright ? { playwright } : {}) })
const proj = () => mkdtempSync(join(tmpdir(), 'qc-pw-'))
// A Playwright test entry (one per project) and a spec, as the JSON reporter writes them.
const pt = (status, { project = '', expectedStatus = 'passed', message = '', result } = {}) => ({
  projectName: project, expectedStatus, status,
  results: [{ status: result ?? (status === 'unexpected' ? 'failed' : status === 'skipped' ? 'skipped' : 'passed'), ...(message ? { error: { message } } : {}) }],
})
const spec = (title, file, tests, tags = []) => ({ title, file, tags, tests })
const report = (rootDir, suites, errors = []) => ({ config: { rootDir }, suites, errors, stats: {} })
const fileSuite = (file, specs, suites = []) => ({ title: file, file, specs, suites })
const envOf = d => readFileSync(join(d, '.fake-playwright.env'), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('filePattern: escaped, anchored at the end and to a whole path segment', () => {
  const p = new RegExp(filePattern('e2e/a (b).spec.ts'))
  assert.ok(p.test('/repo/e2e/a (b).spec.ts'))
  assert.ok(p.test('e2e/a (b).spec.ts'))
  assert.ok(!p.test('/repo/xe2e/a (b).spec.ts'))
  assert.ok(!p.test('/repo/e2e/a (b).spec.ts.bak'))
  assert.ok(!p.test('/repo/e2e/a (b)xspec.ts'))
  assert.ok(!new RegExp(filePattern('e2e/a.spec.ts')).test('/repo/e2e/mut-tmp-1-a-b-a.spec.ts'))
})
test('titlePattern: escaped, at the end of the full title, tags allowed after it', () => {
  const p = new RegExp(titlePattern('a (b) + c'))
  assert.ok(p.test('a (b) + c'))
  assert.ok(p.test(' chromium e2e/one.spec.ts ABC-1 orders a (b) + c'))
  assert.ok(p.test('ABC-1 orders a (b) + c @anchor @ABC-1'))
  assert.ok(!p.test('a (b) + c twice'))
  assert.ok(!p.test('xa (b) + c'))
})
test('configFor: first matching playwright.configs entry, also for a mutant temp file; else null', () => {
  const c = cfg({ configs: [{ match: 'e2e/admin/**', config: 'admin.config.ts' }, { match: 'e2e/', config: 'all.config.ts' }] })
  assert.equal(configFor('e2e/admin/a.spec.ts', c), 'admin.config.ts')
  assert.equal(configFor('e2e/admin/mut-tmp-1-ab-cd-a.spec.ts', c), 'admin.config.ts')
  assert.equal(configFor('e2e/b.spec.ts', c), 'all.config.ts')
  assert.equal(configFor('tests/b.spec.ts', c), null)
  assert.equal(configFor('e2e/b.spec.ts', cfg()), null)
  assert.equal(configFor('e2e/b.spec.ts', { adapter: 'playwright', vitest: { configs: [{ match: 'e2e/', config: 'v.ts' }] } }), null)
})
test('parseReport: statuses, nested describes, the rootDir join, colour codes stripped', () => {
  const r = parseReport(report('/p/e2e', [fileSuite('one.spec.ts', [
    spec('top', 'one.spec.ts', [pt('expected')]),
  ], [{ title: 'ABC-1 orders', file: 'one.spec.ts', specs: [
    spec('ok', 'one.spec.ts', [pt('expected')], ['anchor', 'ABC-1']),
    spec('bad', 'one.spec.ts', [pt('unexpected', { message: '\u001b[2mexpect(\u001b[22mreceived).toBe(expected)\n\nExpected: 2' })]),
    spec('later', 'one.spec.ts', [pt('skipped', { expectedStatus: 'skipped' })]),
    spec('known bug', 'one.spec.ts', [pt('expected', { expectedStatus: 'failed', result: 'failed', message: 'boom' })]),
    spec('slow', 'one.spec.ts', [pt('unexpected', { result: 'timedOut' })]),
    spec('flaky', 'one.spec.ts', [pt('flaky', { message: 'first try failed' })]),
  ], suites: [{ title: 'inner', specs: [spec('deep', 'one.spec.ts', [pt('expected')])] }] }])]), '/p')
  assert.deepEqual(bare(r.tests), [
    { title: 'top', file: 'e2e/one.spec.ts', status: 'passed', message: '' },
    { title: 'ok', file: 'e2e/one.spec.ts', status: 'passed', message: '' },
    { title: 'bad', file: 'e2e/one.spec.ts', status: 'failed', message: 'expect(received).toBe(expected)' },
    { title: 'later', file: 'e2e/one.spec.ts', status: 'skipped', message: '' },
    { title: 'known bug', file: 'e2e/one.spec.ts', status: 'passed', message: '' },
    { title: 'slow', file: 'e2e/one.spec.ts', status: 'failed', message: 'timedOut' },
    { title: 'flaky', file: 'e2e/one.spec.ts', status: 'failed', message: 'first try failed' },
    { title: 'deep', file: 'e2e/one.spec.ts', status: 'passed', message: '' },
  ])
  // Each result keeps its describe titles, outermost first: the key block is path[0].
  assert.deepEqual(r.tests.map(t => t.path), [[], ...Array(6).fill(['ABC-1 orders']), ['ABC-1 orders', 'inner']])
  assert.deepEqual(r.broken, [])
  assert.equal(r.error, undefined)
})
test('parseReport: one result per test across projects; failed wins and names its project', () => {
  const f = 'a.spec.ts'
  const r = parseReport(report('/p/e2e', [fileSuite(f, [
    spec('both pass', f, [pt('expected', { project: 'chromium' })]),
    spec('both pass', f, [pt('expected', { project: 'firefox' })]),
    spec('one fails', f, [pt('expected', { project: 'chromium' })]),
    spec('one fails', f, [pt('unexpected', { project: 'firefox', message: 'Error: nope' })]),
    spec('skipped in one', f, [pt('skipped', { project: 'chromium', expectedStatus: 'skipped' }), pt('expected', { project: 'firefox' })]),
  ])]), '/p')
  assert.deepEqual(bare(r.tests), [
    { title: 'both pass', file: 'e2e/a.spec.ts', status: 'passed', message: '' },
    { title: 'one fails', file: 'e2e/a.spec.ts', status: 'failed', message: '[firefox] Error: nope' },
    { title: 'skipped in one', file: 'e2e/a.spec.ts', status: 'passed', message: '' },
  ])
  const one = parseReport(report('/p', [fileSuite(f, [spec('x', f, [pt('unexpected', { project: 'chromium', message: 'm' })])])]), '/p')
  assert.equal(one.tests[0].message, 'm')
})
test('parseReport: the same title in two describes stays two tests', () => {
  const f = 'a.spec.ts'
  const r = parseReport(report('/p', [fileSuite(f, [], [
    { title: 'one', specs: [spec('saves', f, [pt('expected')])] },
    { title: 'two', specs: [spec('saves', f, [pt('unexpected', { message: 'x' })])] },
  ])]), '/p')
  assert.deepEqual(r.tests.map(t => t.status), ['passed', 'failed'])
})
test('parseReport: a load error with a location is a broken file; one without, and no tests, is an error', () => {
  const r = parseReport(report('/p/e2e', [], [
    { message: "Error: Cannot find module './nope'\nRequire stack:", location: { file: '/p/e2e/broken.spec.ts', line: 2, column: 1 } },
    { message: 'Error: again', location: { file: '/p/e2e/broken.spec.ts', line: 3, column: 1 } },
  ]), '/p')
  assert.deepEqual(r, { tests: [], broken: [{ file: 'e2e/broken.spec.ts', message: "Error: Cannot find module './nope'" }] })
  assert.deepEqual(parseReport(report('/p', [], [{ message: 'Error: No tests found.\nMake sure…' }]), '/p'), { tests: [], broken: [], error: 'Error: No tests found.' })
  const withTests = parseReport(report('/p', [fileSuite('a.spec.ts', [spec('x', 'a.spec.ts', [pt('expected')])])], [{ message: 'late warning' }]), '/p')
  assert.equal(withTests.error, undefined)
  assert.equal(parseReport({}, '/p').tests.length, 0)
})
test('parseReport: no rootDir means paths relative to the project root', () => {
  const r = parseReport({ suites: [fileSuite('e2e/a.spec.ts', [spec('x', 'e2e/a.spec.ts', [pt('expected')])])] }, '/p')
  assert.equal(r.tests[0].file, 'e2e/a.spec.ts')
})
test('runner: argv, environment, report parsed, temp folder deleted, nothing written in the project', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { recordEnv: true, report: report(join(d, 'e2e'), [fileSuite('my a.spec.ts', [spec('ok', 'my a.spec.ts', [pt('expected')])])]) })
  const before = readdirSync(d).sort()
  const prev = { CI: process.env.CI, FORCE_COLOR: process.env.FORCE_COLOR }
  process.env.CI = 'yes-from-the-user'
  process.env.FORCE_COLOR = '1'
  let r
  try {
    r = await playwrightRunner(d, cfg())({ files: ['e2e/my a.spec.ts'], testName: 'ok', timeoutMs: 10000 })
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
  assert.deepEqual(bare(r), { ran: true, tests: [{ title: 'ok', file: 'e2e/my a.spec.ts', status: 'passed', message: '' }], broken: [] })
  const [argv] = calls(d, 'playwright')
  assert.deepEqual(argv.slice(0, 4), ['test', filePattern('e2e/my a.spec.ts'), '--reporter=json', '--retries=0'])
  const output = argv[argv.indexOf('--output') + 1]
  assert.deepEqual(argv.slice(argv.indexOf('-g'), argv.indexOf('-g') + 2), ['-g', titlePattern('ok')])
  assert.ok(!argv.includes('--config'))
  assert.ok(!argv.includes('--project'))
  const [env] = envOf(d)
  assert.deepEqual({ CI: env.CI, FORCE_COLOR: env.FORCE_COLOR, NO_COLOR: env.NO_COLOR }, { CI: 'yes-from-the-user', FORCE_COLOR: null, NO_COLOR: '1' })
  assert.equal(dirname(env.report), dirname(output))
  assert.ok(!env.report.startsWith(d))
  assert.equal(existsSync(dirname(env.report)), false)
  assert.deepEqual(readdirSync(d).sort(), before.concat(['.fake-playwright.calls', '.fake-playwright.env']).sort())
})
test('runner: a non-zero exit with a report is still read; projects are passed', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, report: report(d, [fileSuite('a.spec.ts', [spec('bad', 'a.spec.ts', [pt('unexpected', { message: 'boom' })])])]) })
  const r = await playwrightRunner(d, cfg({ projects: ['chromium', 'Mobile Safari'] }))({ files: ['a.spec.ts'] })
  assert.deepEqual(bare(r.tests), [{ title: 'bad', file: 'a.spec.ts', status: 'failed', message: 'boom' }])
  const [argv] = calls(d, 'playwright')
  assert.deepEqual(argv.filter((a, i) => argv[i - 1] === '--project'), ['chromium', 'Mobile Safari'])
})
test('runner: a broken file stops the run; the other requested file has no result', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, report: report(join(d, 'e2e'), [], [{ message: 'SyntaxError: x', location: { file: join(d, 'e2e/b.spec.ts') } }]) })
  const r = await playwrightRunner(d, cfg())({ files: ['e2e/a.spec.ts', 'e2e/b.spec.ts'] })
  assert.deepEqual(r, { ran: true, tests: [], broken: [{ file: 'e2e/b.spec.ts', message: 'SyntaxError: x' }] })
})
test('runner: no tests found, a webServer that did not start: ran false with the first line', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, report: report(d, [], [{ message: 'Error: Timed out waiting 60000ms from config.webServer.' }]) })
  assert.deepEqual(await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Error: Timed out waiting 60000ms from config.webServer.' })
})
test('runner: every test failing on a refused connection means the app is down, not red', async () => {
  const d = proj()
  const refused = 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/'
  fakeBin(d, 'playwright', { exit: 1, report: report(d, [fileSuite('a.spec.ts', [
    spec('one', 'a.spec.ts', [pt('unexpected', { project: 'chromium', message: refused }), pt('unexpected', { project: 'firefox', message: refused })]),
    spec('two', 'a.spec.ts', [pt('unexpected', { message: 'connect ECONNREFUSED 127.0.0.1:3000' })]),
  ])]) })
  assert.deepEqual(await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: `the app is not reachable: ${refused}` })
  const e = proj()
  fakeBin(e, 'playwright', { exit: 1, report: report(e, [fileSuite('a.spec.ts', [
    spec('one', 'a.spec.ts', [pt('unexpected', { message: refused })]),
    spec('two', 'a.spec.ts', [pt('expected')]),
  ])]) })
  const r = await playwrightRunner(e, cfg())({ files: ['a.spec.ts'] })
  assert.equal(r.ran, true)
  assert.deepEqual(r.tests.map(t => t.status), ['failed', 'passed'])
})
test('runner: no report → first stderr line; missing binary; timeout from playwright.timeoutSeconds', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, stderr: '\nError: playwright.config.ts: Unexpected token\n  at x' })
  assert.deepEqual(await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Error: playwright.config.ts: Unexpected token' })
  fakeBin(d, 'playwright', { exit: 1 })
  assert.deepEqual(await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Playwright wrote no report' })
  assert.deepEqual(await playwrightRunner(proj(), cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Playwright is not installed in this project: run npm install' })
  const s = proj()
  fakeBin(s, 'playwright', { sleepMs: 3000, report: report(s, []) })
  const r = await playwrightRunner(s, cfg({ timeoutSeconds: 0.2 }))({ files: ['a.spec.ts'] })
  assert.deepEqual(r, { ran: false, tests: [], error: 'took longer than 200ms' })
})
test('runner: a report that cannot be read leaks no temp folder', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { recordEnv: true, report: { suites: [null] } })
  const r = await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] })
  assert.equal(r.ran, false)
  assert.match(r.error, /could not read the Playwright report/)
  assert.equal(existsSync(dirname(envOf(d)[0].report)), false)
})
test('runner: browsers in node_modules get PLAYWRIGHT_BROWSERS_PATH=0; otherwise, or when set, it is left alone', async () => {
  const prev = process.env.PLAYWRIGHT_BROWSERS_PATH
  const ok = d => fakeBin(d, 'playwright', { recordEnv: true, report: report(d, [fileSuite('a.spec.ts', [spec('ok', 'a.spec.ts', [pt('expected')])])]) })
  const run = async d => { await playwrightRunner(d, cfg())({ files: ['a.spec.ts'] }); return envOf(d).at(-1).PLAYWRIGHT_BROWSERS_PATH }
  try {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH
    const local = proj()
    mkdirSync(join(local, 'node_modules/playwright-core/.local-browsers'), { recursive: true })
    ok(local)
    assert.equal(await run(local), '0')
    const shared = proj()
    ok(shared)
    assert.equal(await run(shared), null)
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/browsers'
    assert.equal(await run(local), '/opt/browsers')
  } finally {
    if (prev === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = prev
  }
})
test('runner: one process per config, results merged; only the requested files count', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { reportFor: {
    'admin.config.ts': report(d, [fileSuite('e2e/admin/a.spec.ts', [spec('admin', 'e2e/admin/a.spec.ts', [pt('expected')])])]),
    default: report(d, [
      fileSuite('e2e/b.spec.ts', [spec('plain', 'e2e/b.spec.ts', [pt('expected')])]),
      fileSuite('e2e/other/e2e/b.spec.ts', [spec('stray', 'e2e/other/e2e/b.spec.ts', [pt('unexpected', { message: 'x' })])]),
    ], [{ message: 'stray broken', location: { file: join(d, 'e2e/c.spec.ts') } }]),
  } })
  const r = await playwrightRunner(d, cfg({ configs: [{ match: 'e2e/admin/**', config: 'admin.config.ts' }] }))({ files: ['e2e/admin/a.spec.ts', 'e2e/b.spec.ts'] })
  assert.deepEqual(r.tests.map(x => x.title).sort(), ['admin', 'plain'])
  assert.deepEqual(r.broken, [])
  const argvs = calls(d, 'playwright')
  assert.equal(argvs.length, 2)
  assert.ok(argvs.some(a => a.includes('--config') && a.includes('admin.config.ts')))
  assert.ok(argvs.some(a => !a.includes('--config')))
})
test('runner: a failing process group stops at the first group that could not run', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, reportFor: { default: report(d, [fileSuite('b.spec.ts', [spec('x', 'b.spec.ts', [pt('expected')])])]) } })
  const r = await playwrightRunner(d, cfg({ configs: [{ match: 'admin/', config: 'admin.config.ts' }] }))({ files: ['admin/a.spec.ts', 'b.spec.ts'] })
  assert.deepEqual(r, { ran: false, tests: [], error: 'Playwright wrote no report' })
})
test('runner: a Playwright mutant run reports the asked title for the temp file', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { report: report(d, []), mutantReport: { title: 'adds', status: 'failed' } })
  const r = await playwrightRunner(d, cfg())({ files: ['e2e/mut-tmp-1-ab-cd-a.spec.ts'], testName: 'adds' })
  assert.deepEqual(bare(r), { ran: true, tests: [{ title: 'adds', file: 'e2e/mut-tmp-1-ab-cd-a.spec.ts', status: 'failed', message: 'mutant' }], broken: [] })
})
test('runner: a symlinked project root still gives root-relative file names', async () => {
  const real = realpathSync(proj())
  const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'qc-pwlink-'))), 'p')
  symlinkSync(real, link)
  mkdirSync(join(real, 'e2e'))
  fakeBin(real, 'playwright', { report: report(join(real, 'e2e'), [fileSuite('a.spec.ts', [spec('ok', 'a.spec.ts', [pt('expected')])])]) })
  const r = await playwrightRunner(link, cfg())({ files: ['e2e/a.spec.ts'] })
  assert.deepEqual(r.tests.map(x => x.file), ['e2e/a.spec.ts'])
})
