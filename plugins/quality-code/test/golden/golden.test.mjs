// Golden tests: what each script prints, on stdout and stderr, and its exit code, for fixed inputs on a copy of
// the sample project. A refactor must leave every one of them unchanged; a change of wording or behaviour shows
// here as a diff, on purpose.
//
// Paths, dates and the plugin version are replaced by placeholders, so the files hold only what a script decides.
// After an intended change, write the new expected files and read their diff before committing:
//   QC_UPDATE_GOLDEN=1 node --test test/golden/golden.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV as GIT_ENV } from '../git-env.mjs'

const PLUGIN = fileURLToPath(new URL('../../', import.meta.url))
const SAMPLE = join(PLUGIN, '../../examples/sample-service')
const EXPECTED = fileURLToPath(new URL('./expected/', import.meta.url))
const UPDATE = process.env.QC_UPDATE_GOLDEN === '1'
const VERSION = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8')).version

/** A copy of the sample project as a git repo: main, then a feature branch that removes one assertion. */
function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'qc-golden-')))
  const dir = join(top, 'sample-service')
  for (const f of ['src', 'test', 'tickets', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'stryker.config.json', '.claude/quality-code.json']) {
    cpSync(join(SAMPLE, f), join(dir, f), { recursive: true })
  }
  // A ticket too thin to pass: the refuse paths.
  writeFileSync(join(dir, 'tickets/DEMO-9.json'), JSON.stringify({ key: 'DEMO-9', issuetype: 'Bug', summary: 'Export is broken', labels: [], text: { description: 'It does not work.' } }))
  const home = join(top, 'home')
  mkdirSync(home)
  const env = { ...GIT_ENV, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CLAUDE_PROJECT_DIR: dir, QUALITY_CODE_PLACE: 'repo', QC_NO_AUDIT: '1', NO_COLOR: '1', TZ: 'UTC', LANG: 'C' }
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, env: { ...env, GIT_AUTHOR_DATE: '2026-01-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T10:00:00Z' }, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  }
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'sample service')
  git('checkout', '-q', '-b', 'feature/DEMO-1-discount')
  const spec = join(dir, 'test/unit/pricing.demo-1.spec.ts')
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('    expect(order.discount).toBe(0.00)\n', ''))
  git('commit', '-q', '-am', 'DEMO-1 drop a check')
  return { top, dir, env }
}

/** The output with everything that differs between machines and runs replaced by a placeholder. */
// Not the system temp folder itself: on Linux it is /tmp, which the CI files write as plain text.
function normalise(text, { top, dir }) {
  const swaps = [[dir, '<project>'], [top, '<tmp>'], [PLUGIN.replace(/\/$/, ''), '<plugin>'], [homedir(), '<home>']]
  let t = text
  for (const [from, to] of swaps) t = t.split(from).join(to)
  return t
    .split(VERSION).join('<version>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<time>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b[0-9a-f]{40}\b/g, '<sha>')
    .replace(/"[0-9a-f]{7,12}"/g, '"<sha>"')
    .replace(/\b(?:in |took )?\d+(?:\.\d+)?\s?(?:ms|s)\b/g, '<duration>')
}

const T = 'tickets'
// [name, script, args]. Each name is a file in expected/. Keep them small and deterministic: no network, no
// test runner, no clock.
const CASES = [
  ['help', 'help', []],
  ['help-qa', 'help', ['--qa']],
  ['help-po', 'help', ['--po']],
  ['help-all', 'help', ['--all']],
  ['help-spec', 'help', ['spec']],

  ['ticket-config-check', 'ticket', ['config', 'check']],
  ['ticket-config-keys', 'ticket', ['config', 'keys']],
  ['ticket-config-get', 'ticket', ['config', 'get']],
  ['ticket-config-get-site', 'ticket', ['config', 'get', 'jira.site']],
  ['ticket-config-set-bad', 'ticket', ['config', 'set', 'git.base', 'bad name']],
  ['ticket-score-ready', 'ticket', ['score', '--in', `@${T}/DEMO-1.json`, '--next']],
  ['ticket-score-ready-json', 'ticket', ['score', '--in', `@${T}/DEMO-2.json`, '--json']],
  ['ticket-score-refused', 'ticket', ['score', '--in', `@${T}/DEMO-9.json`, '--next']],
  ['ticket-fill-menu', 'ticket', ['fill-menu', '--in', `@${T}/DEMO-9.json`]],
  ['ticket-refuse-comment', 'ticket', ['refuse-comment', '--in', `@${T}/DEMO-9.json`]],
  ['ticket-negative-check', 'ticket', ['negative-check', '--in', `@${T}/DEMO-1.json`]],
  ['ticket-story-check', 'ticket', ['story-check', '--in', `@${T}/DEMO-1.json`]],
  ['ticket-saved', 'ticket', ['saved', 'DEMO-1']],
  ['ticket-no-args', 'ticket', []],
  ['ticket-unknown-command', 'ticket', ['nope', '--in', `@${T}/DEMO-1.json`]],
  ['ticket-missing-file', 'ticket', ['score', '--in', `@${T}/NOPE-1.json`]],
  ['ticket-unknown-flag', 'ticket', ['score', '--in', `@${T}/DEMO-1.json`, '--what']],

  ['checks-honesty-fail', 'checks', ['honesty', 'test/unit/pricing.demo-1.spec.ts', '--range', 'main...HEAD']],
  ['checks-honesty-pass', 'checks', ['honesty', 'test/unit/vat.demo-2.spec.ts', '--range', 'main...HEAD']],
  ['checks-suite-honesty', 'checks', ['suite-honesty', 'test/unit/pricing.demo-1.spec.ts', 'test/unit/vat.demo-2.spec.ts']],
  ['checks-boundary', 'checks', ['boundary', '--range', 'main...HEAD']],
  ['checks-run-status', 'checks', ['run', 'status']],
  ['checks-no-args', 'checks', []],
  ['checks-unknown-option', 'checks', ['honesty', 'test/unit/vat.demo-2.spec.ts', '--runs', '3']],
  ['checks-missing-spec', 'checks', ['honesty', 'test/unit/nope.spec.ts']],
  ['checks-flaky-needs-runner', 'checks', ['flaky', 'test/unit/vat.demo-2.spec.ts']],

  ['branch-detect', 'branch', ['--detect']],
  ['setup-detect', 'setup', ['--detect']],

  ['pipeline-no-args', 'pipeline', []],
  ['pipeline-missing-spec', 'pipeline', ['test/unit/nope.spec.ts']],
  ['pipeline-bad-flaky', 'pipeline', ['test/unit/vat.demo-2.spec.ts', '--flaky', '0']],

  ['ci-github', 'ci', ['--init', 'github', '--print']],
  ['ci-gitlab-smoke', 'ci', ['--init', 'gitlab', '--smoke', '--print']],
  ['ci-no-args', 'ci', []],

  ['routine-status', 'routine', ['status']],
  ['routine-bad-flaky', 'routine', ['run', '--flaky', '0']],
  ['kpi-empty', 'kpi', []],
  ['evals-none', 'evals', []],
  ['clean-list', 'clean', ['list']],
  ['transcript-parse', 'transcript', ['parse', '--text', 'Anna: we ship the export this sprint\nMarco: I take the CSV part']],
  ['xray-no-args', 'xray', []],
  ['routes-no-args', 'routes', []],
  ['progress-no-args', 'progress', []],
  ['seed-no-args', 'seed', []],
  ['qa-config', 'qa', ['config']],
  ['jira-file-no-args', 'jira-file', []],

  // Each line printer path: printLine and printError, direct and through a test's stdout or stderr.
  ['help-unknown-option', 'help', ['--nope']],
  ['branch-unknown-option', 'branch', ['--nope']],
  ['setup-no-args', 'setup', []],
  ['pipeline-unknown-option', 'pipeline', ['--nope']],
  ['checks-unknown-command', 'checks', ['nope']],
  ['ci-init-no-provider', 'ci', ['--init']],
  ['routine-unknown-command', 'routine', ['nope']],
  ['clean-delete-no-groups', 'clean', ['delete']],
  ['clean-delete-not-confirmed', 'clean', ['delete', '--groups', 'specs']],
  ['clean-delete-dry-run', 'clean', ['delete', '--groups', 'cache', '--dry-run']],
  ['clean-cache-no-args', 'clean-cache', []],
  ['clean-cache-list', 'clean-cache', ['list']],
  ['consumption-unknown-option', 'consumption', ['--nope']],
  ['rules-unknown-option', 'rules', ['--nope']],
  ['update-unknown-option', 'update', ['--nope']],
  ['connector-settings-no-args', 'connector-settings', []],
  ['mcp-launch-unknown', 'mcp-launch', ['--nope']],
  ['kpi-unknown-option', 'kpi', ['--nope']],
  ['evals-unknown-option', 'evals', ['--nope']],
  ['seed-target-unset', 'seed', ['target']],
  ['routes-list', 'routes', ['list']],
  ['routes-check', 'routes', ['check', '/orders']],
  ['xray-created-off', 'xray', ['created', 'DEMO-1']],
  ['qa-no-args', 'qa', []],
  ['progress-list', 'progress', ['list']],
  ['progress-get', 'progress', ['get', 'spec']],
  ['transcript-validate-bad', 'transcript', ['validate', '--in', '{}']],
]

// The same project under each stack's config: what the stack decides (config, CI file, scoring, change detection).
const STACKS = [
  ['frontend', { adapter: 'playwright' }],
  ['pytest', { adapter: 'pytest' }],
  ['junit', { adapter: 'junit' }],
  ['fullstack-go', { adapter: 'fullstack', backend: 'go' }],
  ['fullstack-vitest', { adapter: 'fullstack' }],
]
const STACK_CASES = [
  ['config-check', 'ticket', ['config', 'check']],
  ['config-get', 'ticket', ['config', 'get']],
  ['ci-github', 'ci', ['--init', 'github', '--print']],
  ['ci-gitlab', 'ci', ['--init', 'gitlab', '--print']],
  ['branch-detect', 'branch', ['--detect']],
  ['score', 'ticket', ['score', '--in', `@${T}/DEMO-1.json`, '--json']],
  ['routine-status', 'routine', ['status']],
]

const fx = fixture()
const stackFx = STACKS.map(([stack, fields]) => {
  const f = fixture()
  const file = join(f.dir, '.claude/quality-code.json')
  const { vitest, ...rest } = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...rest, ...fields, ...(fields.adapter === 'pytest' || fields.adapter === 'junit' || fields.backend === 'go' || fields.adapter === 'playwright' ? {} : { vitest }) }, null, 2))
  return [stack, f]
})
test.after(() => { for (const f of [fx, ...stackFx.map(([, f]) => f)]) rmSync(f.top, { recursive: true, force: true }) })

const cases = [
  ...CASES.map(c => [...c, fx]),
  ...stackFx.flatMap(([stack, f]) => STACK_CASES.map(([name, script, args]) => [`stack-${stack}-${name}`, script, args, f])),
]
for (const [name, script, args, fx] of cases) {
  test(`golden: ${name}`, () => {
    const r = spawnSync(process.execPath, [join(PLUGIN, 'bin', `${script}.mjs`), ...args], { cwd: fx.dir, env: fx.env, encoding: 'utf8', input: '', timeout: 30000 })
    const shown = args.map(a => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' ')
    const got = normalise(`$ ${script} ${shown}\nexit ${r.status}\n--- stdout\n${r.stdout}--- stderr\n${r.stderr}`, fx)
    const file = join(EXPECTED, `${name}.txt`)
    if (UPDATE) { mkdirSync(EXPECTED, { recursive: true }); writeFileSync(file, got); return }
    assert.ok(existsSync(file), `no expected output for ${name}: run QC_UPDATE_GOLDEN=1 node --test test/golden/golden.test.mjs and read the new file`)
    assert.equal(got, readFileSync(file, 'utf8'), `${name} changed. If that is intended: QC_UPDATE_GOLDEN=1 node --test test/golden/golden.test.mjs`)
  })
}
