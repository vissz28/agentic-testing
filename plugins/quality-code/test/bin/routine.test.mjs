// The routine: a scheduled check that the tests still pass after others pushed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main, stabilityOf } from '../../bin/routine.mjs'

const cfg = { version: 1, adapter: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'qc-routine-'))
  const files = { '.claude/quality-code.json': JSON.stringify(cfg), 'e2e/one.spec.ts': "test('ABC-1 a', () => {})", 'e2e/two.spec.ts': "test('ABC-2 b', () => {})", 'README.md': 'a' }
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  return d
}
function push(d, file, text, who = 'Other Dev', msg = 'change') {
  mkdirSync(dirname(join(d, file)), { recursive: true }); writeFileSync(join(d, file), text)
  git(d, 'add', '-A'); execFileSync('git', ['-c', 'user.email=o@o', '-c', `user.name=${who}`, 'commit', '-qm', msg], { cwd: d })
}
const green = { exit: 0, verdict: 'green', phases: [{ name: 'suite', verdict: 'green', passed: 4, failed: 0 }] }
const red = { exit: 1, verdict: 'checks_failed', phases: [{ name: 'suite', verdict: 'tests_red', passed: 3, failed: 1 }] }
async function go(argv, d, run, extra = {}) {
  let out = '', err = ''
  const code = await main(argv, { CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-routine-cfg-')) }, d, { stdout: s => { out += s }, stderr: s => { err += s }, run, ...extra })
  return { code, out, err }
}

test('options are checked', async () => {
  const d = repo()
  for (const argv of [[], ['go'], ['init'], ['run', '--since'], ['run', '--since', 'x', '--since-last'], ['run', '--until', 'tomorrow'], ['run', '--stability', '0'], ['run', '--cron', '0 7 * * *'], ['status', '--since-last'], ['status', '--stability', '5']]) {
    assert.equal((await go(argv, d, async () => green)).code, 2, argv.join(' '))
  }
  assert.equal((await go(['run', '--id', 'quality-code-routine-suite', '--force'], d, async () => green)).code, 0, '--id is the scheduled task that calls this: accepted')
})

test('a routine past its end date does nothing', async () => {
  const d = repo()
  const r = await go(['run', '--until', '2026-01-01'], d, async () => { throw new Error('must not run') }, { now: new Date('2026-10-28T09:00:00Z') })
  assert.equal(r.code, 0)
  assert.match(r.out, /routine ended on 2026-01-01: nothing to do\. Delete its schedule\./)
})

test('no new commit since the last check means nothing to check; a new one runs again', async () => {
  const d = repo(); let runs = 0
  const run = async () => { runs++; return green }
  let r = await go(['run', '--since-last'], d, run)
  assert.equal(r.code, 0); assert.equal(runs, 1)
  assert.match(r.out, /First check of this branch: running\./)
  assert.match(r.out, /Result: PASSED/)
  r = await go(['run', '--since-last'], d, run)
  assert.match(r.out, /No new commits on main since the last check \(\w{7}, green\): nothing to check\./)
  assert.equal(runs, 1, 'nothing ran')
  assert.equal((await go(['run', '--since-last', '--force'], d, run)).code, 0); assert.equal(runs, 2, '--force runs anyway')
  push(d, 'e2e/three.spec.ts', "test('ABC-3 c', () => {})")
  r = await go(['run', '--since-last'], d, run)
  assert.equal(runs, 3)
  assert.match(r.out, /New: 1 commit by 1 author, 1 file\./)
})

test('green before and red now is a regression, with the commits in between', async () => {
  const d = repo()
  await go(['run', '--since-last'], d, async () => green)
  push(d, 'src/pricing.ts', 'x', 'Ana Rossi', 'round vat differently')
  push(d, 'package.json', '{}', 'Luca Bianchi', 'bump a dependency')
  const r = await go(['run', '--since-last', '--json'], d, async () => red)
  const j = JSON.parse(r.out)
  assert.equal(r.code, 1)
  assert.equal(j.regression, true)
  assert.equal(j.newCommits, 2)
  const text = (await go(['run', '--since-last', '--force'], d, async () => red)).out
  assert.doesNotMatch(text, /REGRESSION/, 'the last result was already not green: not a new regression')
})

test('the text names the integral change and the commits in between', async () => {
  const d = repo()
  await go(['run', '--since-last'], d, async () => green)
  push(d, 'src/pricing.ts', 'x', 'Ana Rossi', 'round vat differently')
  push(d, 'package.json', '{}', 'Luca Bianchi', 'bump a dependency')
  const r = await go(['run', '--since-last'], d, async () => red)
  assert.match(r.out, /New: 2 commits by 2 authors, 2 files\./)
  assert.match(r.out, /Integral change: package\.json\./)
  assert.match(r.out, /REGRESSION: green at \w{7} .*, not green at \w{7}\. Commits in between:/)
  assert.match(r.out, /Ana Rossi: round vat differently/)
  assert.match(r.out, /Luca Bianchi: bump a dependency/)
  assert.match(r.out, /Result: FAILED \(exit 1\)/)
})

test('a task runs only the specs that name its key; none means not verified', async () => {
  const d = repo(); let seen
  const r = await go(['run', '--task', 'ABC-1'], d, async job => { seen = job; return green })
  assert.deepEqual(seen.specs, ['e2e/one.spec.ts'])
  assert.equal(seen.key, 'ABC-1')
  assert.match(r.out, /Running 1 spec of ABC-1\./)
  const none = await go(['run', '--task', 'ABC-9'], d, async () => green)
  assert.equal(none.code, 3)
  assert.match(none.out, /No spec names ABC-9, so nothing was verified\./)
  assert.equal((await go(['run', '--task', 'XYZ-1'], d, async () => green)).code, 2, 'a key of another project')
})

test('--since uses a date, and --junit writes the report', async () => {
  const d = repo()
  const r = await go(['run', '--since', '1 hour ago', '--junit', 'out/j.xml'], d, async () => red)
  assert.equal(r.code, 1)
  assert.match(readFileSync(join(d, 'out/j.xml'), 'utf8'), /<testcase classname="quality-code" name="suite"><failure/)
  const quiet = await go(['run', '--since', '2090-01-01'], repo(), async () => { throw new Error('no') }, {})
  assert.equal(quiet.code, 0)
  assert.match(quiet.out, /No new commits on main since 2090-01-01: nothing to check\./)
})

test('outside a git repo, or on a personal setup, it says so', async () => {
  const none = mkdtempSync(join(tmpdir(), 'qc-routine-none-'))
  mkdirSync(join(none, '.claude'), { recursive: true }); writeFileSync(join(none, '.claude/quality-code.json'), JSON.stringify(cfg))
  const r = await go(['run'], none, async () => green)
  assert.equal(r.code, 2)
  assert.match(r.err, /needs a git repo/)
})

test('stability: every test runs N times and the flaky ones are named, in the text, the JSON and the history', async () => {
  const d = repo(); let seen
  const flakyRun = async job => { seen = job; return { ...red, flaky: ['e2e/one.spec.ts > ABC-1 a', 'e2e/two.spec.ts > ABC-2 b'], phases: [{ name: 'suite', verdict: 'tests_red', passed: 3, failed: 1 }] } }
  const r = await go(['run', '--stability', '5'], d, flakyRun)
  assert.equal(seen.stability, '5')
  assert.match(r.out, /Running every test of the project, each test 5 times\./)
  assert.match(r.out, /Flaky \(2\), passed and failed on the same code in 5 runs:\n    e2e\/one\.spec\.ts > ABC-1 a/)
  const ok = await go(['run', '--stability', '5', '--force'], d, async () => green)
  assert.match(ok.out, /Stable: no test changed its result in 5 runs\./)
  const j = JSON.parse((await go(['run', '--stability', '5', '--force', '--json'], d, flakyRun)).out)
  assert.deepEqual(j.flaky, ['e2e/one.spec.ts > ABC-1 a', 'e2e/two.spec.ts > ABC-2 b'])
})

test('stabilityOf: pass rate, streak, green to red changes, flaky tests, and the verdict', () => {
  const run = (exit, flaky = []) => ({ at: '2026-10-28T09:00:00Z', exit, flaky })
  assert.equal(stabilityOf([run(0), run(0)]).verdict, 'NOT ENOUGH DATA')
  const stable = stabilityOf([run(0), run(0), run(0), run(0)])
  assert.deepEqual([stable.rate, stable.streak, stable.flips, stable.verdict], [100, 4, 0, 'STABLE'])
  const flaky = stabilityOf([run(0), run(0, ['a']), run(0, ['a', 'b']), run(0)])
  assert.equal(flaky.verdict, 'UNSTABLE')
  assert.deepEqual(flaky.flaky, [['a', 2], ['b', 1]])
  const reds = stabilityOf([run(0), run(1), run(0), run(1), run(1), run(0)])
  assert.deepEqual([reds.rate, reds.flips, reds.streak, reds.verdict], [50, 2, 1, 'UNSTABLE'])
})

test('status reads the kept runs of the task, or of the whole suite', async () => {
  const d = repo()
  assert.match((await go(['status'], d)).out, /no runs kept yet/)
  for (let i = 0; i < 3; i++) await go(['run', '--stability', '3', '--force'], d, async () => (i === 1 ? { ...red, flaky: ['t1'] } : green))
  await go(['run', '--task', 'ABC-1', '--force'], d, async () => green)
  const all = (await go(['status'], d)).out
  assert.match(all, /whole suite · last 3 runs/)
  assert.match(all, /passed 2 · not green 1 · pass rate 67%/)
  assert.match(all, /green to red changes: 1/)
  assert.match(all, /flaky tests seen \(1\):\n    t1: in 1 run/)
  assert.match(all, /Stability: UNSTABLE/)
  const one = JSON.parse((await go(['status', '--task', 'ABC-1', '--json'], d)).out)
  assert.equal(one.runs, 1)
  assert.equal(one.verdict, 'NOT ENOUGH DATA')
  assert.match((await go(['status', '--last', '2'], d)).out, /last 2 runs/)
})
