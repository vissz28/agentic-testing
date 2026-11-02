import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../../bin/pipeline.mjs'
import { ENV } from '../git-env.mjs'
import { calls, fakeBin } from '../fake-bin.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../bin/pipeline.mjs')
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
  assert.match(r.stdout, /What to do: test\/a\.spec\.ts › 'shows': Error: expect\(locator\)\.toBeVisible\(\) failed/)
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
  assert.match(m.stdout, /Playwright is not installed in this project/)
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

// main() with a stub pipeline; returns the exit code, stdout, stderr and whether the stub ran.
async function stubbed(d, args, env = {}) {
  const outcome = {
    verdict: 'tests_red', decidedBy: 'tests',
    steps: [{ check: 'tests', status: 'fail', summary: '1 failed', findings: [{ file: 'test/a.spec.ts', test: 'adds', detail: 'Expected 2' }], data: { ran: true, passed: 1, failed: 1, skipped: 0 } }],
  }
  let ran = false
  const o = [], e = []
  const w = [process.stdout.write, process.stderr.write]
  process.stdout.write = m => { o.push(String(m)); return true }
  process.stderr.write = m => { e.push(String(m)); return true }
  let code
  try {
    code = await main(['test/a.spec.ts', ...args], { CLAUDE_PROJECT_DIR: d, ...env }, d, { runPipeline: async () => { ran = true; return structuredClone(outcome) } })
  } finally { [process.stdout.write, process.stderr.write] = w }
  return { code, out: o.join(''), err: e.join(''), ran }
}
const auditLines = (d, kind) => readFileSync(join(d, '.claude/quality-code/audit', `${kind}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('--incomplete-ticket: the outcome carries it, the card opens with the risk line, the verdict and exit are unchanged', async () => {
  const d = repo()
  const r = await stubbed(d, ['--key', 'ABC-1', '--incomplete-ticket', '45'])
  assert.equal(r.code, 1, r.err)
  const lines = r.out.trim().split('\n')
  assert.equal(lines[1], '🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (45/70)')
  assert.match(r.out, /Verdict: 🔴 tests red/)
  const json = JSON.parse(lines.at(-1).slice('PIPELINE_JSON:'.length))
  assert.deepEqual(json.incompleteTicket, { score: 45, bar: 70 })
  assert.equal(json.verdict, 'tests_red')
  const j = await stubbed(d, ['--incomplete-ticket', '0', '--json'])
  assert.deepEqual(JSON.parse(j.out).incompleteTicket, { score: 0, bar: 70 })
})
test('--incomplete-ticket must be a whole number below the bar; refused before anything runs', async () => {
  const d = repo()
  for (const [v, msg] of [['abc', /whole number from 0 to 69/], ['4.5', /whole number/], ['07', /whole number/], ['70', /below the bar \(70\)/], ['99', /below the bar/], ['100', /whole number/], ['-1', /needs a value/]]) {
    const r = await stubbed(d, ['--incomplete-ticket', v])
    assert.equal(r.code, 2, v)
    assert.match(r.err, msg, v)
    assert.equal(r.ran, false, v)
  }
  assert.equal(existsSync(join(d, '.claude/quality-code/audit')), false, 'a refused run is not logged')
})
test('without --incomplete-ticket the outcome has no incompleteTicket field', async () => {
  const r = await stubbed(repo(), ['--json'])
  assert.equal('incompleteTicket' in JSON.parse(r.out), false)
})
test('audit: one pipeline line per run (statuses and counts, no findings), and an override line for a forced run', async () => {
  const d = repo()
  await stubbed(d, ['--key', 'ABC-1'])
  await stubbed(d, ['--key', 'ABC-1', '--incomplete-ticket', '45'])
  const p = auditLines(d, 'pipeline')
  assert.equal(p.length, 2)
  assert.deepEqual({ ...p[0], date: 'x' }, {
    key: 'ABC-1', verdict: 'tests_red', decidedBy: 'tests', adapter: 'vitest',
    steps: [{ check: 'tests', status: 'fail', passed: 1, failed: 1, skipped: 0 }],
    flags: { ticket: false, expected: false, target: false, range: false, flaky: null },
    counts: { specs: 1, passed: 1, failed: 1, skipped: 0 },
    incompleteTicket: null, date: 'x',
  })
  assert.deepEqual(p[1].incompleteTicket, { score: 45, bar: 70 })
  assert.doesNotMatch(JSON.stringify(p), /a\.spec|Expected 2|adds/)
  const o = auditLines(d, 'override')
  assert.deepEqual(o.map(x => ({ ...x, date: 'x' })), [{ key: 'ABC-1', score: 45, bar: 70, date: 'x' }])
})
test('audit off: --no-audit or QC_NO_AUDIT=1 writes nothing; a failed append changes nothing', async () => {
  const d = repo()
  assert.equal((await stubbed(d, ['--no-audit', '--incomplete-ticket', '45'])).code, 1)
  assert.equal((await stubbed(d, ['--incomplete-ticket', '45'], { QC_NO_AUDIT: '1' })).code, 1)
  assert.equal(existsSync(join(d, '.claude/quality-code/audit')), false)
  put(d, '.claude/quality-code/audit', 'a file, not a folder')
  const r = await stubbed(d, ['--incomplete-ticket', '45'])
  assert.equal(r.code, 1)
  assert.equal(r.err, '')
})

test('--expected: a JSON list of pinned values, passed to the pipeline; it needs --ticket', async () => {
  const d = repo()
  put(d, 't.json', JSON.stringify({ key: 'ABC-1', summary: 'add', text: { description: 'Then the result is 2' } }))
  put(d, 'pins.json', JSON.stringify(['2', 'result']))
  put(d, 'obj.json', JSON.stringify({ expected: [2] }))
  put(d, 'bad.json', JSON.stringify([{ a: 1 }]))
  const seen = []
  const runPipeline = async opts => { seen.push(opts.candidates); return { verdict: 'green', decidedBy: null, steps: [] } }
  const env = { ...ENV, CLAUDE_PROJECT_DIR: d, QC_NO_AUDIT: '1' }
  const quiet = async fn => { const w = process.stdout.write; const e = process.stderr.write; const err = []; process.stdout.write = () => true; process.stderr.write = s => { err.push(String(s)); return true }; try { return { code: await fn(), err: err.join('') } } finally { process.stdout.write = w; process.stderr.write = e } }
  assert.equal((await quiet(() => main(['test/a.spec.ts', '--key', 'ABC-1', '--ticket', '@t.json', '--expected', '@pins.json'], env, d, { runPipeline }))).code, 0)
  assert.equal((await quiet(() => main(['test/a.spec.ts', '--key', 'ABC-1', '--ticket', '@t.json', '--expected', '@obj.json'], env, d, { runPipeline }))).code, 0)
  assert.deepEqual(seen, [['2', 'result'], ['2']])
  const noTicket = await quiet(() => main(['test/a.spec.ts', '--key', 'ABC-1', '--expected', '@pins.json'], env, d, { runPipeline }))
  assert.deepEqual([noTicket.code, noTicket.err.trim()], [2, '--expected needs --ticket: the values are checked against the ticket'])
  const bad = await quiet(() => main(['test/a.spec.ts', '--key', 'ABC-1', '--ticket', '@t.json', '--expected', '@bad.json'], env, d, { runPipeline }))
  assert.match(bad.err, /must be a list of values/)
  const missing = await quiet(() => main(['test/a.spec.ts', '--key', 'ABC-1', '--ticket', '@t.json', '--expected', '@nope.json'], env, d, { runPipeline }))
  assert.match(missing.err, /--expected @nope.json: file not found/)
})

test('with a key, the developer log is written next to the ticket and the card links it; off with the audit log', async () => {
  const d = repo()
  const r = await stubbed(d, ['--key', 'ABC-1'])
  const log = join(d, '.quality-code/tickets/ABC-1/run.md')
  assert.ok(existsSync(log))
  assert.match(readFileSync(log, 'utf8'), /^# ABC-1: 🔴 tests red\n/)
  assert.match(r.out, /\nFull details: \.quality-code\/tickets\/ABC-1\/run\.md\n/)
  const off = repo()
  const r2 = await stubbed(off, ['--key', 'ABC-1'], { QC_NO_AUDIT: '1' })
  assert.equal(existsSync(join(off, '.quality-code/tickets/ABC-1/run.md')), false)
  assert.doesNotMatch(r2.out, /Full details/)
  const noKey = repo()
  await stubbed(noKey, [])
  assert.equal(existsSync(join(noKey, '.quality-code/tickets')), false)
})

test('fullstack through the CLI: each spec to its runner, one verdict, the card names both runners', () => {
  const d = repo({ adapter: 'fullstack' })
  put(d, 'e2e/b.spec.ts', PW)
  fakeBin(d, 'tsc', { exit: 0 })
  fakeBin(d, 'vitest', { report: report(d, [at('adds', 'passed')]), mutantReport: { title: 'adds', status: 'failed' } })
  const pwSpec = { ...pwTest('shows', 'passed'), file: 'e2e/b.spec.ts' }
  fakeBin(d, 'playwright', { report: { config: { rootDir: d }, errors: [], suites: [{ title: 'e2e/b.spec.ts', file: 'e2e/b.spec.ts', specs: [pwSpec], suites: [] }] }, mutantReport: { title: 'shows', status: 'failed' } })
  const r = run(d, ['test/a.spec.ts', 'e2e/b.spec.ts', '--key', 'ABC-1', '--json'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  const out = JSON.parse(r.stdout)
  assert.equal(out.verdict, 'green', JSON.stringify(out.steps.map(s => [s.check, s.status, s.summary])))
  assert.deepEqual(out.runners, ['vitest', 'playwright'])
  const tests = out.steps.find(s => s.check === 'tests')
  assert.deepEqual([tests.data.passed, tests.summary], [2, 'Vitest: 1 passed; Playwright: 1 passed'])
  assert.ok(calls(d, 'vitest').every(a => a.includes('test/a.spec.ts') || a.some(x => /mut-tmp/.test(x))), 'Vitest ran only the Vitest spec')
  assert.equal(calls(d, 'playwright')[0][1], '(?:^|/)e2e/b\\.spec\\.ts$')
  const card = run(d, ['test/a.spec.ts', 'e2e/b.spec.ts', '--key', 'ABC-1'])
  assert.match(card.stdout, /^quality-code check · 2 spec files · Vitest \+ Playwright · ticket ABC-1/)
})
test('a killed run stops its tools with their workers and leaves no temp file in the project', async () => {
  const d = repo()
  fakeBin(d, 'tsc', { exit: 0, sleepMs: 30000, grandchild: true })
  fakeBin(d, 'vitest', { report: report(d, [at('adds', 'passed')]) })
  const child = spawn(process.execPath, [CLI, 'test/a.spec.ts'], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, stdio: 'ignore' })
  const gcFile = join(d, '.fake-tsc.grandchild')
  for (let i = 0; i < 200 && !existsSync(gcFile); i++) await new Promise(r => setTimeout(r, 50))
  assert.ok(existsSync(gcFile), 'tsc started')
  assert.equal(readdirSync(d).filter(n => n.startsWith('mut-tmp-qc-tsconfig-')).length, 1)
  child.kill('SIGTERM')
  assert.equal(await new Promise(r => child.on('exit', r)), 130)
  assert.deepEqual(readdirSync(d).filter(n => n.startsWith('mut-tmp-')), [])
  const gcPid = Number(readFileSync(gcFile, 'utf8'))
  let gone = false
  for (let i = 0; i < 100 && !gone; i++) {
    await new Promise(r => setTimeout(r, 50))
    try { process.kill(gcPid, 0) } catch { gone = true }
  }
  assert.ok(gone, "the tool's own child is gone too")
})

// --suite: the script picks every spec of one side, or of both; the model never lists them.
const suiteRun = async (d, args) => {
  const seen = []
  const errs = []
  const write = process.stderr.write
  process.stderr.write = m => { errs.push(String(m)); return true }
  let code
  try {
    code = await main([...args, '--no-audit', '--json'], { ...ENV, CLAUDE_PROJECT_DIR: d }, d, {
      runPipeline: async ({ specs }) => { seen.push(...specs); return { verdict: 'green', steps: [] } },
    })
  } finally { process.stderr.write = write }
  return { code, specs: seen.sort(), err: errs.join('') }
}
const fullstack = () => {
  const d = repo()
  put(d, '.claude/quality-code.json', CONFIG('fullstack'))
  put(d, 'playwright.config.ts', "export default { testDir: './e2e' }\n")
  put(d, 'e2e/orders.spec.ts', "test('ABC-1 opens', async () => {})\n")
  return d
}
test('--suite backend runs every Vitest spec of the project', async () => {
  const r = await suiteRun(repo(), ['--suite', 'backend'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.specs, ['test/a.spec.ts'])
})
test('--suite for a side the project does not have: exit 2, and says so', async () => {
  const r = await suiteRun(repo(), ['--suite', 'frontend'])
  assert.equal(r.code, 2)
  assert.match(r.err, /This project has no frontend \(Playwright\) tests: its adapter is vitest\./)
  const p = await suiteRun(repo({ adapter: 'playwright' }), ['--suite', 'backend'])
  assert.equal(p.code, 2)
  assert.match(p.err, /no backend \(Vitest\) tests: its adapter is playwright/)
})
test('--suite on a fullstack project: frontend, backend, or both in one run', async () => {
  const d = fullstack()
  assert.deepEqual((await suiteRun(d, ['--suite', 'frontend'])).specs, ['e2e/orders.spec.ts'])
  assert.deepEqual((await suiteRun(d, ['--suite', 'backend'])).specs, ['test/a.spec.ts'])
  assert.deepEqual((await suiteRun(d, ['--suite', 'full'])).specs, ['e2e/orders.spec.ts', 'test/a.spec.ts'])
})
test('--suite: a bad name, spec paths with it, --target with the frontend suite, or no spec found: exit 2', async () => {
  assert.equal((await suiteRun(repo(), ['--suite', 'all'])).code, 2)
  assert.equal((await suiteRun(repo(), ['--suite', 'backend', 'test/a.spec.ts'])).code, 2)
  assert.equal((await suiteRun(fullstack(), ['--suite', 'frontend', '--target', 'README.md'])).code, 2)
  const empty = repo()
  execFileSync('rm', ['-r', join(empty, 'test')])
  const r = await suiteRun(empty, ['--suite', 'backend'])
  assert.equal(r.code, 2)
  assert.match(r.err, /No backend \(Vitest\) spec files found/)
})
test('--suite backend on another backend runner takes its own test files; --target is Vitest\'s', async () => {
  const d = repo({ adapter: 'pytest' })
  put(d, 'tests/test_orders.py', 'def test_total():\n    assert 1\n')
  put(d, 'tests/conftest.py', '')
  put(d, 'app/orders.py', '')
  const r = await suiteRun(d, ['--suite', 'backend'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.specs, ['tests/test_orders.py'])
  const t = await suiteRun(d, ['--suite', 'backend', '--target', 'app/orders.py'])
  assert.equal(t.code, 2)
  assert.match(t.err, /--target runs Stryker, which is for Vitest projects: leave it out for pytest specs/)
  const fs = repo()
  put(fs, '.claude/quality-code.json', JSON.stringify({ version: 1, adapter: 'fullstack', backend: 'go', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } }))
  const none = await suiteRun(fs, ['--suite', 'backend'])
  assert.equal(none.code, 2)
  assert.match(none.err, /No backend \(Go\) spec files found/)
})
