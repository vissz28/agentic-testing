import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { ALWAYS, DEFAULT_WHY, RUN_MARKER, STALE_MS, defaultForbidden, hookDecision, matches, readRunMarker, rulesFor, run, runActive, violation, DEPENDENCY_FILES } from '../../lib/base/boundary.mjs'
import { startRun } from '../../lib/base/run.mjs'
import { ENV } from '../git-env.mjs'

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
  assert.ok(matches('packages/*/src/', 'packages/api/src/x.ts') && matches('packages/*/src/', 'packages/api/src'), 'a glob folder covers what is inside')
  assert.ok(!matches('packages/*/src/', 'packages/api/test/x.ts'))
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
  assert.deepEqual(ALWAYS.slice(0, 4), ['**/dist/', '**/node_modules/', '.git/', '.claude/quality-code.json'])
  for (const p of ['packages/api/dist/x.js', 'apps/web/node_modules/a.js', '.claude/quality-code/run.active', '.claude/quality-code/boundary.jsonl', '.claude/quality-code/audit/gate.jsonl', '.claude/settings.json', '.claude/settings.local.json']) assert.ok(violation(p, rules), `${p}: the plugin's own state and build output at any depth`)
})
test('an env template is not caught by a .env.* pattern, only by a rule that names it', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-b-'))
  const defaults = rulesFor({}, d)
  for (const p of ['.env.example', '.env.sample', '.env.template', 'apps/web/.env.example']) assert.equal(violation(p, defaults), null, p)
  for (const p of ['.env', '.env.local', '.env.production', '.env.example.local']) assert.ok(violation(p, defaults), p)
  assert.ok(violation('apps/web/.env.example', { forbidden: [{ path: 'apps/' }], allow: [] }), 'a folder rule still covers it')
  assert.ok(violation('.env.example', { forbidden: [{ path: '.env.*' }, { path: '.env.example' }], allow: [] }), 'named exactly, it stays forbidden')
})
test('defaults: src/, .env, .env.*, the CI file that exists and the dependency files', () => {
  const d = dir()
  const deps = DEPENDENCY_FILES
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', '**/.env', '**/.env.*', ...deps])
  put(d, '.gitlab-ci.yml'); put(d, '.github/workflows/ci.yml'); put(d, 'Jenkinsfile'); put(d, 'packages/api/package.json')
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', 'packages/*/src/', '**/.env', '**/.env.*', '.gitlab-ci.yml', '.github/workflows/', 'Jenkinsfile', ...deps])
  for (const p of ['packages/api/src/x.ts', 'apps/web/.env', 'apps/web/.env.local']) assert.ok(violation(p, rulesFor({}, d)), p)
  assert.equal(violation('apps/web/.env.example', rulesFor({}, d)), null)
  assert.deepEqual(rulesFor(cfg(), d).allow, [])
  assert.deepEqual(rulesFor(cfg({ forbidden: [{ path: 'lib/' }] }), d).forbidden, [{ path: 'lib/' }])
})
test('dependency files of every stack are off limits, each kind with its own reason; a spec is not', () => {
  const d = dir()
  const r = rulesFor({}, d)
  for (const p of ['package.json', 'apps/web/package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pyproject.toml', 'requirements-dev.txt', 'pom.xml', 'module/build.gradle.kts', 'go.mod', 'go.sum', 'App/App.csproj', 'Demo.sln']) {
    assert.match(violation(p, r)?.why ?? '', /^dependencies: /, p)
  }
  assert.match(violation('.env', r).why, /^secrets and environment: /)
  assert.equal(violation('test/unit/order.spec.ts', r), null)
  assert.equal(violation('tests/test_orders.py', r), null)
  put(d, '.gitlab-ci.yml')
  assert.match(violation('.gitlab-ci.yml', rulesFor({}, d)).why, /^CI configuration: /)
  assert.match(violation('src/x.ts', r).why, /^application code: /)
})
test('hook: allows without a run, denies a forbidden write during a run, ignores a stale marker', () => {
  const d = dir()
  const write = p => ({ tool_name: 'Write', tool_input: { file_path: join(d, p) } })
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  put(d, RUN_MARKER, '')
  assert.equal(runActive(d), true)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'deny', path: 'src/a.ts', why: DEFAULT_WHY })
  assert.deepEqual(hookDecision(write('test/a.spec.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  const old = new Date(Date.now() - 13 * 3600 * 1000)
  utimesSync(join(d, RUN_MARKER), old, old)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
})
test('stale rule: 12 hours from startedAt; mtime only when the marker has no usable startedAt', () => {
  const d = dir()
  const now = Date.now()
  const write = { tool_name: 'Write', tool_input: { file_path: join(d, 'src/a.ts') } }
  assert.equal(STALE_MS, 12 * 3600 * 1000)
  assert.equal(readRunMarker(d), null)
  put(d, RUN_MARKER, JSON.stringify({ key: 'ABC-1', startedAt: new Date(now - 11 * 3600 * 1000).toISOString(), base: null }))
  assert.equal(runActive(d, now), true)
  assert.equal(hookDecision(write, { root: d, config: cfg(), now }).decision, 'deny')
  // a fresh mtime does not rescue an old startedAt
  put(d, RUN_MARKER, JSON.stringify({ key: 'ABC-1', startedAt: new Date(now - 12 * 3600 * 1000).toISOString(), base: null }))
  assert.equal(runActive(d, now), false)
  assert.equal(readRunMarker(d, now).stale, true)
  assert.equal(readRunMarker(d, now).marker.key, 'ABC-1')
  assert.equal(hookDecision(write, { root: d, config: cfg(), now }).decision, 'allow')
  // and a recent startedAt wins over an old mtime
  put(d, RUN_MARKER, JSON.stringify({ key: 'ABC-1', startedAt: new Date(now - 3600 * 1000).toISOString() }))
  const old = new Date(now - 20 * 3600 * 1000)
  utimesSync(join(d, RUN_MARKER), old, old)
  assert.equal(runActive(d, now), true)
  for (const body of ['not json', '[]', '{"key":"ABC-1"}', '{"startedAt":"yesterday"}', 'null']) {
    put(d, RUN_MARKER, body)
    assert.equal(runActive(d, now), true, body)
    utimesSync(join(d, RUN_MARKER), old, old)
    assert.equal(runActive(d, now), false, body)
  }
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

test('hook: the same file through another spelling is the same file (case, symlink, /tmp alias)', () => {
  const d = dir()
  put(d, 'src/a.ts'); put(d, RUN_MARKER, '')
  symlinkSync(join(d, 'src'), join(d, 'link'))
  const write = f => ({ tool_name: 'Write', tool_input: { file_path: f } })
  assert.equal(hookDecision(write(join(d, 'link/a.ts')), { root: d, config: cfg() }).decision, 'deny', 'through a symlink')
  assert.equal(hookDecision(write(join(d, 'link/new.ts')), { root: d, config: cfg() }).decision, 'deny', 'a new file through a symlink')
  assert.equal(hookDecision(write(join(realpathSync(d), 'src/b.ts')), { root: d, config: cfg() }).decision, 'deny', 'the real path of a /tmp root')
  if (existsSync(join(d, 'SRC'))) assert.equal(hookDecision(write(join(d, 'SRC/a.ts')), { root: d, config: cfg() }).decision, 'deny', 'other case on a case-insensitive disk')
})
test('diff mode: an edit made before run start is not the run\'s; a change to it during the run is', () => {
  const d = dir()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q'); put(d, 'src/base.ts', 'a\n'); put(d, 'src/gone.ts', 'g\n'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'src/base.ts', 'edited before\n'); put(d, 'src/gone.ts', 'edited before\n')
  assert.equal(startRun(d, 'ABC-1').ok, true)
  const check = () => run({}, { root: d, config: cfg() })
  assert.equal(check().status, 'pass', 'pre-existing edits are not the run\'s')
  put(d, 'test/a.spec.ts')
  assert.equal(check().status, 'pass')
  put(d, 'src/base.ts', 'edited during the run\n'); put(d, 'src/new.ts'); g('checkout', '--', 'src/gone.ts')
  assert.deepEqual(check().findings.map(f => f.file).sort(), ['src/base.ts', 'src/gone.ts', 'src/new.ts'])
  put(d, RUN_MARKER, JSON.stringify({ key: 'ABC-1', startedAt: new Date().toISOString() }))
  assert.deepEqual(check().findings.map(f => f.file).sort(), ['src/base.ts', 'src/new.ts'], 'a marker without a snapshot: every changed path counts, as before')
})
