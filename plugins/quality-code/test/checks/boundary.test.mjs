import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { ALWAYS, DEFAULT_WHY, RUN_MARKER, defaultForbidden, hookDecision, matches, rulesFor, run, runActive, violation } from '../../core/checks/boundary.mjs'
import { ENV } from './git-env.mjs'

const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const dir = () => mkdtempSync(join(tmpdir(), 'qc-b-'))
const cfg = boundaries => ({ jira: { projects: ['ABC'] }, adapter: 'vitest', ...(boundaries ? { boundaries } : {}) })

test('matches: prefix, exact and globs (review focus 4)', () => {
  assert.ok(matches('src/', 'src/a.ts') && matches('src/', 'src'))
  assert.ok(!matches('src/', 'src-tauri/x') && !matches('src/', 'e2e/src/x'))
  assert.ok(matches('.env', '.env') && !matches('.env', '.env.example'))
  assert.ok(matches('.env.*', '.env.local') && !matches('.env.*', '.env'))
  assert.ok(matches('**/*.pem', 'a.pem') && matches('**/*.pem', 'x/y/a.pem'))
  assert.ok(matches('src/**/*.spec.ts', 'src/a.spec.ts') && matches('src/**/*.spec.ts', 'src/x/y/a.spec.ts'))
  assert.ok(!matches('src/*.ts', 'src/x/a.ts'))
})
test('violation: always-forbidden paths win over allow; allow wins over forbidden; default why', () => {
  const rules = { forbidden: [{ path: 'src/' }, { path: '.env', why: 'shared systems' }], allow: ['src/**/*.spec.ts', 'dist/**'] }
  assert.deepEqual(violation('src/a.ts', rules), { path: 'src/a.ts', why: DEFAULT_WHY })
  assert.equal(violation('src/a.spec.ts', rules), null)
  assert.deepEqual(violation('.env', rules), { path: '.env', why: 'shared systems' })
  for (const p of ['dist/x.js', 'node_modules/a/b.js', '.git/config', '.claude/quality-code.json']) assert.ok(violation(p, rules), p)
  assert.equal(violation('../other/src/a.ts', rules), null)
  assert.equal(violation('./test/a.spec.ts', rules), null)
  assert.ok(violation('src\\win.ts', rules))
  assert.deepEqual(ALWAYS, ['dist/', 'node_modules/', '.git/', '.claude/quality-code.json'])
})
test('defaults: src/, .env, .env.* and the CI file that exists', () => {
  const d = dir()
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', '.env', '.env.*'])
  put(d, '.gitlab-ci.yml'); put(d, '.github/workflows/ci.yml')
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', '.env', '.env.*', '.gitlab-ci.yml', '.github/workflows/'])
  assert.deepEqual(rulesFor(cfg(), d).allow, [])
  assert.deepEqual(rulesFor(cfg({ forbidden: [{ path: 'lib/' }] }), d).forbidden, [{ path: 'lib/' }])
})
test('hook: allows without a run, denies a forbidden write during a run, ignores a stale marker', () => {
  const d = dir()
  const write = p => ({ tool_name: 'Write', tool_input: { file_path: join(d, p) } })
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  put(d, RUN_MARKER, '')
  assert.equal(runActive(d), true)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'deny', path: 'src/a.ts', why: DEFAULT_WHY })
  assert.deepEqual(hookDecision(write('test/a.spec.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  const old = new Date(Date.now() - 7 * 3600 * 1000)
  utimesSync(join(d, RUN_MARKER), old, old)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
})
test('hook: notebook writes, no file path, no config (review focus 2 and 3)', () => {
  const d = dir()
  put(d, RUN_MARKER, '')
  assert.equal(hookDecision({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(d, 'src/n.ipynb') } }, { root: d, config: cfg() }).decision, 'deny')
  assert.equal(hookDecision({ tool_name: 'Bash', tool_input: { command: 'ls' } }, { root: d, config: cfg() }).decision, 'allow')
  assert.equal(hookDecision({}, { root: d, config: cfg() }).decision, 'allow')
  assert.equal(hookDecision({ tool_input: { file_path: join(d, 'src/a.ts') } }, { root: d, config: null }).decision, 'allow')
})
test('diff mode: changed and untracked paths, including spaces (review focus 1)', () => {
  const d = dir()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'test/a.spec.ts'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/b.spec.ts')
  assert.equal(run({}, { root: d, config: cfg() }).status, 'pass')
  put(d, 'src/my file.ts')
  const r = run({}, { root: d, config: cfg() })
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings, [{ file: 'src/my file.ts', kind: 'forbidden write', detail: DEFAULT_WHY }])
  assert.equal(r.data.mode, 'diff')
  assert.equal(run({}, { root: dir(), config: cfg() }).status, 'not_run')
})
test('diff mode: a rename out of a forbidden folder names the old path (§9 #21)', () => {
  const d = dir()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'src/x.ts'); put(d, 'test/a.spec.ts'); g('add', '-A'); g('commit', '-qm', 'i')
  g('mv', 'src/x.ts', 'test/x.ts')
  const r = run({}, { root: d, config: cfg() })
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings.map(f => f.file), ['src/x.ts'])
})
test('rulesFor: config patterns are normalised (leading ./, backslashes)', () => {
  const d = dir()
  const rules = rulesFor(cfg({ forbidden: [{ path: './lib/', why: 'w' }, { path: 'app\\core\\' }], allow: ['./lib/**/*.spec.ts', 'app\\core\\ok.ts'] }), d)
  assert.deepEqual(rules.forbidden, [{ path: 'lib/', why: 'w' }, { path: 'app/core/' }])
  assert.deepEqual(rules.allow, ['lib/**/*.spec.ts', 'app/core/ok.ts'])
  assert.ok(violation('lib/a.ts', rules))
  assert.equal(violation('lib/a.spec.ts', rules), null)
  assert.ok(violation('app/core/b.ts', rules))
})
