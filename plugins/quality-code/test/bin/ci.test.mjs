// The ci command: the gate and the tests a pull or merge request runs, and the CI file that runs them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { baseFromEnv, junit, main, providerOf, stackOf, template } from '../../bin/ci.mjs'

const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } }
const SPEC = "import { it, expect } from 'vitest'\nit('adds', () => {\n  expect(1 + 1).toBe(2)\n})\nit('subtracts', () => {\n  expect(2 - 1).toBe(1)\n})\nit('divides', () => {\n  expect(6 / 3).toBe(2)\n})\n"
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
function project(files = {}, config = cfg) {
  const d = mkdtempSync(join(tmpdir(), 'qc-ci-'))
  for (const [p, s] of Object.entries({ '.claude/quality-code.json': JSON.stringify(config), ...files })) put(d, p, s)
  return d
}
/** A repo with one spec on main, and a feature branch checked out. */
function repo() {
  const d = project({ 'test/unit/math.spec.ts': SPEC, 'README.md': 'a' })
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  git(d, 'checkout', '-qb', 'feature/ABC-1')
  return d
}
const commit = d => { git(d, 'add', '-A'); git(d, 'commit', '-qm', 'change') }
async function run(argv, d, env = {}) {
  let out = '', err = ''
  const code = await main(argv, { CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-ci-cfg-')), ...env }, d, { stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}

test('the provider and the target come from GitHub or GitLab', () => {
  assert.equal(providerOf({ GITHUB_ACTIONS: 'true' }), 'github')
  assert.equal(providerOf({ GITLAB_CI: 'true' }), 'gitlab')
  assert.equal(providerOf({}), null)
  assert.equal(baseFromEnv({ GITHUB_BASE_REF: 'main' }), 'main')
  assert.equal(baseFromEnv({ CI_MERGE_REQUEST_DIFF_BASE_SHA: 'abc123', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop' }), 'abc123', 'the SHA needs no fetched target branch')
  assert.equal(baseFromEnv({}), null)
})

// ---- The CI file ----

test('both files hold the gate (requests only, no install) and the tests (requests and the default branch, installed), the plugin at its own version', () => {
  const gh = template('github', '9.8.7'), gl = template('gitlab', '9.8.7')
  for (const t of [gh, gl]) {
    assert.match(t, /^# Quality Code/)
    assert.equal((t.match(/--branch quality-code--v9\.8\.7 /g) ?? []).length, 2)
    assert.match(t, /quality-gate:[\s\S]*bin\/ci\.mjs\n[\s\S]*quality-tests:[\s\S]*npm ci[\s\S]*bin\/ci\.mjs --tests/)
    assert.doesNotMatch(t.slice(t.indexOf('quality-gate:'), t.indexOf('quality-tests:')), /npm ci/, 'the gate installs nothing')
  }
  assert.match(gh, /on:\n  pull_request:\n  push:\n    branches: \[main\]/)
  assert.match(gh, /quality-gate:\n    if: github\.event_name == 'pull_request'/)
  assert.equal((gh.match(/fetch-depth: 0/g) ?? []).length, 2)
  assert.equal((gl.match(/GIT_DEPTH: "0"/g) ?? []).length, 2)
  assert.match(gl, /quality-gate:[\s\S]*merge_request_event"\n  script:/, 'the gate: merge requests only')
  assert.match(gl, /quality-tests:[\s\S]*merge_request_event"\n    - if: \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/)
  assert.match(gl, /retry:\n    max: 2\n    when: \[runner_system_failure/, 'a dead runner is retried')
  assert.doesNotMatch(gl, /script_failure/, 'a red test is never retried')
  assert.match(gl, /--tests --junit quality-code-junit\.xml\n  artifacts:\n    when: always\n    reports:\n      junit: quality-code-junit\.xml/)
  assert.doesNotMatch(gl, /dind/, 'no Testcontainers, no Docker')
})

test('the stack shapes the tests job: its toolchain, install lines, Docker for Testcontainers, a project in a subfolder', () => {
  const s = { backend: 'pytest', playwright: true, pm: 'pnpm', lock: false, prisma: false, containers: true, pip: ['requirements.txt'], pyproject: true, maven: false, go: '1.23', prefix: 'api/', defaultBranch: 'develop' }
  const gl = template('gitlab', '1.0.0', s)
  assert.match(gl, /quality-tests:\n  image: python:3\.12/)
  assert.match(gl, /services:\n    - name: docker:24-dind\n      alias: docker/)
  assert.match(gl, /DOCKER_HOST: tcp:\/\/docker:2375\n    DOCKER_TLS_CERTDIR: ""\n    TESTCONTAINERS_RYUK_DISABLED: "true"/)
  assert.match(gl, /script:\n    - cd api\/\n    - curl -fsSL https:\/\/nodejs\.org\/dist\/v22[^\n]*\n    - corepack enable && pnpm install --frozen-lockfile\n    - pnpm exec playwright install --with-deps\n    - pip install -r requirements\.txt\n/)
  assert.match(gl, /junit: api\/quality-code-junit\.xml/)
  assert.match(gl, /webServer/, 'Playwright needs the app')
  const gh = template('github', '1.0.0', { ...s, backend: 'go', containers: false })
  assert.match(gh, /branches: \[develop\]/)
  assert.match(gh, /defaults:\n  run:\n    working-directory: api\//)
  assert.match(gh, /actions\/setup-go@v5\n        with: \{ go-version-file: 'api\/go\.mod' \}/)
  assert.match(gh, /- run: go mod download/)
  assert.match(template('gitlab', '1.0.0', { ...s, backend: 'junit', maven: true, containers: false }), /image: maven:3-eclipse-temurin-21/)
  assert.match(template('gitlab', '1.0.0', { ...s, backend: 'go', go: '1.24' }), /image: golang:1\.24/)
  assert.match(template('github', '1.0.0', { ...s, backend: 'vitest', pm: 'npm', lock: true, prisma: true, playwright: false }), /- run: npm ci\n      - run: npx prisma generate\n/)
})

test('stackOf reads the lockfile, Prisma, Testcontainers and the folder from the repo', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-ci-stack-'))
  put(d, 'web/package.json', JSON.stringify({ dependencies: { '@prisma/client': '6' }, devDependencies: { testcontainers: '10' } }))
  put(d, 'web/package-lock.json', '{}')
  put(d, 'web/.claude/quality-code.json', JSON.stringify(cfg))
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  const s = stackOf(join(d, 'web'), cfg)
  assert.deepEqual({ backend: s.backend, pm: s.pm, lock: s.lock, prisma: s.prisma, containers: s.containers, prefix: s.prefix }, { backend: 'vitest', pm: 'npm', lock: true, prisma: true, containers: true, prefix: 'web/' })
  assert.equal(stackOf(project(), cfg).containers, false)
})

test('--init writes the file for the CI the repo uses at the repo top, replaces only its own, and --print writes nothing', async () => {
  const d = project()
  git(d, 'init', '-q', '-b', 'main')
  assert.equal((await run(['--init'], d)).code, 2, 'nothing says github or gitlab')
  assert.match((await run(['--init', 'github', '--print'], d)).out, /^# Quality Code/)
  assert.equal(existsSync(join(d, '.github')), false, 'printing writes nothing')
  assert.match((await run(['--init', 'github'], d)).out, /ok: wrote \.github\/workflows\/quality-code\.yml/)
  assert.equal((await run(['--init'], d)).code, 0, 'the .github folder says github; its own file is replaced')
  put(d, '.github/workflows/quality-code.yml', 'name: mine\n')
  const mine = await run(['--init', 'github'], d)
  assert.equal(mine.code, 2)
  assert.match(mine.err, /not overwritten/)
  assert.equal(readFileSync(join(d, '.github/workflows/quality-code.yml'), 'utf8'), 'name: mine\n')

  const g = project({ '.gitlab-ci.yml': 'stages: [test]\n' })
  const r = await run(['--init'], g)
  assert.match(r.out, /wrote \.gitlab\/quality-code\.gitlab-ci\.yml \(GitLab CI\)/, 'the .gitlab-ci.yml says gitlab, and keeps its content')
  assert.match(r.out, /include:\n  - local: \.gitlab\/quality-code\.gitlab-ci\.yml/)
  assert.equal(readFileSync(join(g, '.gitlab-ci.yml'), 'utf8'), 'stages: [test]\n')
  writeFileSync(join(g, '.gitlab-ci.yml'), 'include:\n  - local: .gitlab/quality-code.gitlab-ci.yml\n')
  assert.doesNotMatch((await run(['--init'], g)).out, /include:/, 'already included: no hint')

  const fresh = project()
  assert.match((await run(['--init', 'gitlab'], fresh)).out, /wrote \.gitlab-ci\.yml/)
  assert.match((await run(['--init', 'gitlab'], fresh)).out, /wrote \.gitlab-ci\.yml/, 'its own .gitlab-ci.yml is replaced, not joined by a second file')

  const mono = mkdtempSync(join(tmpdir(), 'qc-ci-mono-'))
  put(mono, 'api/.claude/quality-code.json', JSON.stringify(cfg))
  git(mono, 'init', '-q', '-b', 'main')
  await run(['--init', 'gitlab'], join(mono, 'api'))
  assert.match(readFileSync(join(mono, '.gitlab-ci.yml'), 'utf8'), /- cd api\//, 'a project in a subfolder: the file at the top, the jobs in its folder')
})

test('bad options and a missing config exit 2', async () => {
  const d = project()
  for (const argv of [['github'], ['--print'], ['--base'], ['--init', '--base', 'main'], ['--init', '--tests'], ['--all'], ['--junit', 'j.xml'], ['--suite', 'backend'], ['--init', 'jenkins']]) assert.equal((await run(argv, d)).code, 2, argv.join(' '))
  assert.equal((await run([], mkdtempSync(join(tmpdir(), 'qc-ci-none-')))).code, 2)
})

// ---- The gate ----

test('gate: an honest change passes; a change with no spec to check passes', async () => {
  const d = repo()
  put(d, 'README.md', 'b'); commit(d)
  let r = await run([], d)
  assert.equal(r.code, 0)
  assert.match(r.out, /changes since main: no spec changed, nothing to check/)
  writeFileSync(join(d, 'test/unit/math.spec.ts'), `${SPEC}it('multiplies', () => {\n  expect(2 * 3).toBe(6)\n})\n`); commit(d)
  r = await run([], d)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /✅ honesty/)
  assert.match(r.out, /✅ assertions/)
  assert.match(r.out, /Result: PASSED/)
})

test('gate: a removed assertion, a skip without a ticket, a hollow test, a deleted spec and a rename that drops a test all fail', async () => {
  const cases = {
    'assertion removed': d => writeFileSync(join(d, 'test/unit/math.spec.ts'), SPEC.replace("  expect(2 - 1).toBe(1)\n", '')),
    'test newly skipped': d => writeFileSync(join(d, 'test/unit/math.spec.ts'), SPEC.replace("it('subtracts'", "it.skip('subtracts'")),
    hollow: d => put(d, 'test/unit/new.spec.ts', "import { it } from 'vitest'\nit('does nothing', () => {})\n"),
    'deleted spec': d => rmSync(join(d, 'test/unit/math.spec.ts')),
    'renamed spec': d => { rmSync(join(d, 'test/unit/math.spec.ts')); put(d, 'test/unit/sums.spec.ts', SPEC.replace("it('subtracts', () => {\n  expect(2 - 1).toBe(1)\n})\n", '')) },
  }
  for (const [name, change] of Object.entries(cases)) {
    const d = repo()
    change(d); commit(d)
    const r = await run([], d)
    assert.equal(r.code, 1, `${name}: ${r.out}`)
    assert.match(r.out, /❌/, name)
    assert.match(r.out, /Result: FAILED \(exit 1\)/, name)
    if (name === 'renamed spec') assert.match(r.out, /R test\/unit\/math\.spec\.ts → test\/unit\/sums\.spec\.ts\n[\s\S]*\[test removed\]/, 'the old path is diffed with the new one')
  }
})

test('gate on GitLab: the merge request base SHA is the target, with no branch fetched', async () => {
  const d = repo()
  const base = git(d, 'rev-parse', 'main').trim()
  writeFileSync(join(d, 'test/unit/math.spec.ts'), SPEC.replace("  expect(2 - 1).toBe(1)\n", '')); commit(d)
  git(d, 'checkout', '-q', '--detach'); git(d, 'branch', '-q', '-D', 'main')
  const r = await run([], d, { GITLAB_CI: 'true', CI_MERGE_REQUEST_DIFF_BASE_SHA: base })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /\[assertion removed\]/)
})

test('gate: a target that cannot be found is not verified, never a pass', async () => {
  const d = repo()
  const r = await run([], d, { GITHUB_BASE_REF: 'nowhere' })
  assert.equal(r.code, 3)
  assert.match(r.out, /not verified: the target branch was not found \(fetch the full history/)
  assert.equal((await run([], project())).code, 3, 'not a git checkout')
})

// ---- The tests ----

test('tests: a branch that changed only docs has nothing to test: exit 0, no pipeline run', async () => {
  const d = repo()
  put(d, 'README.md', 'b'); commit(d)
  const r = await run(['--tests'], d)
  assert.equal(r.code, 0)
  assert.match(r.out, /Running only what changed \(changes since main: 0 test files, 0 code files\)/)
  assert.match(r.out, /== backend · skipped \(nothing changed in backend\)/)
  assert.match(r.out, /Result: NOTHING TO TEST/)
})

test('tests: outside a request in CI, with --all, or on the default branch, the whole suite runs without mutation', async () => {
  const d = project({ 'README.md': 'a' })
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  assert.match((await run(['--tests'], d)).out, /Running the whole suite, without mutation: this is main itself/)
  assert.match((await run(['--tests'], d, { GITLAB_CI: 'true' })).out, /without mutation: this is no pull or merge request/)
  git(d, 'checkout', '-qb', 'feature/x')
  assert.match((await run(['--tests', '--all'], d)).out, /without mutation: every test was asked for \(--all\)/)
})

test('tests: zero specs never pass; the JUnit file, the GitHub summary and an error annotation say so', async () => {
  const d = project(), summary = join(d, 'summary.md')
  const r = await run(['--tests', '--junit', 'out/j.xml'], d, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary })
  assert.equal(r.code, 3)
  assert.match(r.out, /== backend \(Vitest\) · not verified/)
  assert.match(r.out, /Result: NOT VERIFIED \(exit 3\)/)
  assert.match(r.out, /::error title=Quality Code backend::not verified/)
  assert.match(readFileSync(join(d, 'out/j.xml'), 'utf8'), /<failure message="not verified">/)
  assert.match(readFileSync(summary, 'utf8'), /## Quality Code: NOT VERIFIED\n\n\| Phase \| Verdict \| Tests \|/)
})

test('junit escapes text and marks skipped phases', () => {
  const x = junit([{ name: 'a<b', verdict: 'checks_failed', detail: 'x & "y"' }, { name: 'evals', verdict: 'skipped', detail: '' }, { name: 'ok', verdict: 'green', detail: '' }])
  assert.match(x, /name="a&lt;b"><failure message="checks failed">x &amp; &quot;y&quot;/)
  assert.match(x, /<skipped\/>/)
  assert.match(x, /tests="3" failures="1"/)
})
