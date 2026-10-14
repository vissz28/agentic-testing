import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../../core/pipeline/cli.mjs'
import { ENV } from '../checks/git-env.mjs'
import { fakeBin } from '../runners/fake-bin.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../core/pipeline/cli.mjs')
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const CONFIG = adapter => JSON.stringify({ version: 1, adapter, jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } })
// A snapshot assertion has no strict mutant, so mutation has nothing to run and the fake needs no mutant logic.
const GOOD = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toMatchSnapshot() })\n})\n"
const RED = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toMatchSnapshot() })\n  it('breaks', () => { expect(run()).toMatchSnapshot() })\n})\n"

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
  bins(d, [at('adds', 'passed')])
  const r = run(d, ['test/a.spec.ts', '--key', 'ABC-1'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /Verdict: ✅ green/)
  assert.match(r.stdout.trim().split('\n').at(-1), /^PIPELINE_JSON:\{/)
})
test('--json prints only the JSON', () => {
  const d = repo()
  bins(d, [at('adds', 'passed')])
  const r = run(d, ['test/a.spec.ts', '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).verdict, 'green')
  assert.equal(r.stdout.trim().split('\n').length, 1)
})
test('a red test: exit 1', () => {
  const d = repo({ spec: RED })
  bins(d, [at('adds', 'passed'), at('breaks', 'failed', ['Expected true'])])
  const r = run(d, ['test/a.spec.ts'])
  assert.equal(r.status, 1, r.stderr + r.stdout)
  assert.match(r.stdout, /tests red/)
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
test('adapter playwright: exit 2 and the part 3 message', () => {
  const d = repo({ adapter: 'playwright' })
  const r = run(d, ['test/a.spec.ts'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /the Playwright pipeline comes with part 3/)
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
  bins(d, [at('adds', 'passed')])
  const r = run(d, ['test/a.spec.ts', '--flaky', '2', '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).steps.at(-1).check, 'flaky')
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
