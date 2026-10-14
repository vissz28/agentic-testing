import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../../core/pipeline/cli.mjs'
import { ENV } from '../checks/git-env.mjs'
import { calls, fakeBin } from '../runners/fake-bin.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../core/pipeline/cli.mjs')
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const CONFIG = adapter => JSON.stringify({ version: 1, adapter, jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } })
// A strict matcher: mutation makes mutants, and the fake vitest fails them (killed).
const GOOD = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n})\n"
const SNAP = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toMatchSnapshot() })\n})\n"
const RED = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n  it('breaks', () => { expect(run()).toBe(true) })\n})\n"

function repo({ adapter = 'vitest', config = true, spec = GOOD } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-pcli-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, 'README.md', 'x')
  put(d, '.gitignore', 'node_modules\n.fake-*\n')
  put(d, 'tsconfig.json', '{}')
  if (config) put(d, '.claude/quality-code.json', CONFIG(adapter))
  g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/a.spec.ts', spec)
  return d
}
const at = (title, status, failureMessages = []) => ({ title, status, failureMessages })
const report = (d, tests) => ({ testResults: [{ name: join(d, 'test/a.spec.ts'), status: 'passed', message: '', assertionResults: tests }] })
const run = (d, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
const bins = (d, tests, extra = {}) => {
  fakeBin(d, 'tsc', { exit: 0 })
  fakeBin(d, 'vitest', { report: report(d, tests), ...extra })
}

test('green: exit 0, the card ends with the PIPELINE_JSON line', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')], { mutantReport: { title: 'adds', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /mutation\s+1\/1 mutants killed/)
  assert.match(r.stdout, /Verdict: ✅ green/)
  assert.match(r.stdout.trim().split('\n').at(-1), /^PIPELINE_JSON:\{/)
})
test('--json prints only the JSON', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')], { mutantReport: { title: 'adds', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1', '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).verdict, 'green')
  assert.equal(r.stdout.trim().split('\n').length, 1)
})
test('a red test: exit 1', () => {
  const d = repo({ spec: RED })
  bins(d, [at('adds', 'passed'), at('breaks', 'failed', ['Expected true'])], { mutantReport: { title: 'adds', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts'])
  assert.equal(r.status, 1, r.stderr + r.stdout)
  assert.match(r.stdout, /Verdict: 🔴 tests red/)
})
test('a snapshot-only spec: nothing for mutation to check, so not verified, exit 3', () => {
  const d = repo({ spec: SNAP })
  bins(d, [at('adds', 'passed')])
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1'])
  assert.equal(r.status, 3, r.stderr + r.stdout)
  assert.match(r.stdout, /mutation\s+not run: no assertion/)
})
test('duplicate specs are one spec on the card', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')], { mutantReport: { title: 'adds', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', './test/a.spec.ts', '--key', 'ABC-1'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /^quality-code check · 1 spec file ·/)
})
test('fake vitest with no report: not verified, exit 3', () => {
  const d = repo()
  fakeBin(d, 'tsc', { exit: 0 })
  fakeBin(d, 'vitest', { exit: 1, stderr: 'boom' })
  const r = run(d, ['test/a.spec.ts'])
  assert.equal(r.status, 3, r.stderr + r.stdout)
  assert.match(r.stdout, /not verified/)
})
test('a failing check: exit 1', () => {
  const d = repo({ spec: "it('hollow', () => { run() })\n" })
  bins(d, [at('hollow', 'passed')])
  assert.equal(run(d, ['test/a.spec.ts']).status, 1)
})
// Playwright through the CLI, with a fake playwright writing a Playwright-shaped report.
const PW = "test.describe('ABC-1 — anchor', () => {\n  test('shows', async ({ page }) => {\n    await expect(page.getByText('Saved')).toBeVisible()\n  })\n})\n"
const pwTest = (title, status, message = '') => ({ title, file: 'test/a.spec.ts', tags: [], tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: status === 'passed' ? 'expected' : 'unexpected', results: [{ status, ...(message ? { error: { message } } : {}) }] }] })
const pwReport = (d, specs, errors = []) => ({ config: { rootDir: d }, errors, suites: specs.length ? [{ title: 'test/a.spec.ts', file: 'test/a.spec.ts', specs, suites: [] }] : [] })
const pwBins = (d, specs, extra = {}) => {
  fakeBin(d, 'tsc', { exit: 0 })
  fakeBin(d, 'playwright', { report: pwReport(d, specs), ...extra })
}
test('playwright: green, exit 0; the fake playwright got the file pattern; no stryker step', () => {
  const d = repo({ adapter: 'playwright', spec: PW })
  pwBins(d, [pwTest('shows', 'passed')], { mutantReport: { title: 'shows', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1', '--json'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  const out = JSON.parse(r.stdout)
  assert.equal(out.verdict, 'green')
  assert.deepEqual(out.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation'])
  assert.equal(out.steps.find(s => s.check === 'mutation').data.killed, 2)
  assert.equal(calls(d, 'playwright')[0][1], '(?:^|/)test/a\\.spec\\.ts$')
  const card = run(d, ['test/a.spec.ts', '--key', 'ABC-1'])
  assert.match(card.stdout, /^quality-code check · 1 spec file · ticket ABC-1/)
  assert.match(card.stdout, /Tests {5}1 passed · 0 failed · 0 to do/)
})
test('playwright: a red test is exit 1; a mutant that survives is exit 1', () => {
  const d = repo({ adapter: 'playwright', spec: PW })
  pwBins(d, [pwTest('shows', 'failed', 'Error: expect(locator).toBeVisible() failed')])
  const r = run(d, ['test/a.spec.ts'])
  assert.equal(r.status, 1, r.stderr + r.stdout)
  assert.match(r.stdout, /Verdict: 🔴 tests red/)
  assert.match(r.stdout, /What to do: 'shows': Error: expect\(locator\)\.toBeVisible\(\) failed/)
  const s = repo({ adapter: 'playwright', spec: PW })
  pwBins(s, [pwTest('shows', 'passed')], { mutantReport: { title: 'shows', status: 'passed' } })
  const m = run(s, ['test/a.spec.ts', '--key', 'ABC-1'])
  assert.equal(m.status, 1, m.stderr + m.stdout)
  assert.match(m.stdout, /Verdict: ❌ checks failed/)
  assert.match(m.stdout, /mutation\s+2 of 2 mutant\(s\) survived/)
})
test('playwright: a spec that does not load, the app down, Playwright missing: not verified, exit 3', () => {
  const d = repo({ adapter: 'playwright', spec: PW })
  fakeBin(d, 'tsc', { exit: 0 })
  fakeBin(d, 'playwright', { exit: 1, report: pwReport(d, [], [{ message: "Error: Cannot find module './x'", location: { file: join(d, 'test/a.spec.ts') } }]) })
  const broken = run(d, ['test/a.spec.ts'])
  assert.equal(broken.status, 3, broken.stderr + broken.stdout)
  assert.match(broken.stdout, /tests\s+not run: 1 file\(s\) never ran: test\/a\.spec\.ts: Error: Cannot find module '\.\/x'/)
  const down = repo({ adapter: 'playwright', spec: PW })
  pwBins(down, [pwTest('shows', 'failed', 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/')])
  const r = run(down, ['test/a.spec.ts'])
  assert.equal(r.status, 3, r.stderr + r.stdout)
  assert.match(r.stdout, /What to do: tests could not run: could not run: the app is not reachable: Error: page\.goto: net::ERR_CONNECTION_REFUSED/)
  const none = repo({ adapter: 'playwright', spec: PW })
  fakeBin(none, 'tsc', { exit: 0 })
  const m = run(none, ['test/a.spec.ts'])
  assert.equal(m.status, 3, m.stderr + m.stdout)
  assert.match(m.stdout, /Playwright is not installed in this project: run npm install/)
})
test('playwright: --target is refused before anything runs', () => {
  const d = repo({ adapter: 'playwright', spec: PW })
  put(d, 'src/app.ts', 'export {}\n')
  pwBins(d, [pwTest('shows', 'passed')])
  const r = run(d, ['test/a.spec.ts', '--target', 'src/app.ts'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--target runs Stryker, which is for Vitest projects: leave it out for Playwright specs/)
  assert.deepEqual(calls(d, 'playwright'), [])
})
test('usage and config errors: exit 2', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')])
  const bad = args => { const r = run(d, args); assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}`); return r.stderr }
  assert.match(bad(['test/missing.spec.ts']), /spec not found: test\/missing\.spec\.ts/)
  assert.match(bad(['test']), /spec not found/)
  assert.match(bad(['../outside.spec.ts']), /inside the project/)
  assert.match(bad(['test/a.spec.ts', '--key', 'ZZZ-1']), /--key ZZZ-1 is not a key of ABC/)
  assert.match(bad(['test/a.spec.ts', '--flaky', '0']), /--flaky/)
  assert.match(bad(['test/a.spec.ts', '--flaky', '1.5']), /--flaky/)
  assert.match(bad(['test/a.spec.ts', '--range', '--json']), /--range needs a value/)
  assert.match(bad(['test/a.spec.ts', '--nope']), /unknown option --nope/)
  assert.match(bad([]), /usage/)
  assert.match(run(repo({ config: false }), ['test/a.spec.ts']).stderr, /quality-code/)
})
test('a spec outside the project root is refused', () => {
  const d = repo()
  const other = repo()
  const r = run(d, [join(other, 'test/a.spec.ts')])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /inside the project/)
})
test('--flaky runs the flaky step', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')], { mutantReport: { title: 'adds', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1', '--flaky', '2', '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout).steps.slice(-2).map(s => s.check), ['flaky', 'stryker'])
})
test('a crash: exit 2, "check <step> crashed: <message>"', async () => {
  const d = repo()
  const errs = []
  const w = process.stderr.write
  process.stderr.write = m => { errs.push(String(m)); return true }
  let code
  try {
    code = await main(['test/a.spec.ts'], { CLAUDE_PROJECT_DIR: d }, d, {
      runPipeline: async () => { const e = new Error('kaput\nsecond line'); e.step = 'types'; throw e },
    })
  } finally { process.stderr.write = w }
  assert.equal(code, 2)
  assert.deepEqual(errs, ['check types crashed: kaput\n'])
})

test('--ticket and --target: checked before anything runs, passed to the pipeline', async () => {
  const d = repo()
  put(d, 't.json', JSON.stringify({ key: 'ABC-1', text: { description: 'Then the sum is 2' } }))
  put(d, 'bad.json', '{')
  put(d, 'list.json', '[]')
  put(d, 'src/add.ts', 'export const add = (a: number, b: number) => a + b\n')
  const errs = []
  const w = process.stderr.write
  const seen = []
  const runPipeline = async input => { seen.push(input); return { verdict: 'green', decidedBy: null, steps: [] } }
  const out = process.stdout.write
  process.stderr.write = m => { errs.push(String(m)); return true }
  process.stdout.write = () => true
  const go = args => main(['test/a.spec.ts', ...args], { CLAUDE_PROJECT_DIR: d }, d, { runPipeline })
  try {
    assert.equal(await go(['--ticket', '@missing.json']), 2)
    assert.equal(await go(['--ticket', '@bad.json']), 2)
    assert.equal(await go(['--ticket', '@list.json']), 2)
    assert.equal(await go(['--ticket', '@']), 2)
    assert.equal(await go(['--target', 'src/none.ts']), 2)
    assert.equal(await go(['--target', '../outside.ts']), 2)
    assert.equal(await go(['--target', 'test/a.spec.ts']), 2)
    assert.equal(await go(['--target', 'src']), 2)
    assert.equal(seen.length, 0)
    assert.equal(await go(['--key', 'ABC-1', '--ticket', '@t.json', '--target', './src/add.ts']), 0)
    assert.equal(await go(['--target', 'src/add.ts']), 0)
  } finally {
    process.stderr.write = w
    process.stdout.write = out
  }
  assert.deepEqual(errs.map(e => e.trim()), [
    '--ticket missing.json: file not found',
    `--ticket bad.json: not valid JSON (${(() => { try { JSON.parse('{') } catch (e) { return e.message } })()})`,
    '--ticket list.json: not a ticket object',
    '--ticket needs a file, like --ticket @path/ticket.json',
    '--target not found: src/none.ts',
    '--target must be inside the project: ../outside.ts',
    '--target test/a.spec.ts is one of the specs: name the code the tests check',
    '--target not found: src',
  ])
  assert.equal(seen[0].ticket, join(d, 't.json'))
  assert.equal(seen[0].target, 'src/add.ts')
  assert.equal(seen[1].ticket, null)
})
