// The ci command: every testing phase in one run for GitHub Actions and GitLab CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { junit, main, providerOf, template } from '../../bin/ci.mjs'

const cfg = { version: 1, adapter: 'fullstack', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
function project(files = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-ci-'))
  for (const [p, s] of Object.entries({ '.claude/quality-code.json': JSON.stringify(cfg), ...files })) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return d
}
async function run(argv, d, env = {}) {
  let out = '', err = ''
  const code = await main(argv, { CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-ci-cfg-')), ...env }, d, { stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}

test('the provider is read from the CI environment', () => {
  assert.equal(providerOf({ GITHUB_ACTIONS: 'true' }), 'github')
  assert.equal(providerOf({ GITLAB_CI: 'true' }), 'gitlab')
  assert.equal(providerOf({}), null)
})

test('the GitHub and GitLab files fetch the plugin at its own version and run one command', () => {
  const gh = template('github', '9.8.7'), gl = template('gitlab', '9.8.7')
  for (const t of [gh, gl]) {
    assert.match(t, /--branch quality-code--v9\.8\.7 /)
    assert.match(t, /bin\/ci\.mjs( --all)? --junit quality-code-junit\.xml/)
  }
  for (const t of [gh, gl]) assert.match(t, /bin\/ci\.mjs --all --junit/, 'the file runs every test of the test folders')
  for (const prov of ['github', 'gitlab']) {
    const c = template(prov, '9.8.7', { changed: true })
    assert.match(c, /bin\/ci\.mjs --junit/)
    assert.doesNotMatch(c, /--all/)
    assert.match(c, /only the tests the branch touched/)
  }
  assert.match(gh, /every test of the project's test folders/)
  assert.match(gh, /on: \[push, pull_request\]/)
  assert.match(gh, /actions\/upload-artifact@v4/)
  assert.match(gl, /junit: quality-code-junit\.xml/)
  assert.match(gl, /merge_request_event/)
})

test('--init prints the file; --write writes it and never overwrites', async () => {
  const d = project()
  assert.match((await run(['--init', 'github'], d)).out, /^# Quality Code/)
  assert.equal(existsSync(join(d, '.github/workflows/quality-code.yml')), false, 'printing writes nothing')
  assert.match((await run(['--init', 'github', '--write'], d)).out, /ok: wrote \.github\/workflows\/quality-code\.yml/)
  const again = await run(['--init', 'github', '--write'], d)
  assert.equal(again.code, 2)
  assert.match(again.err, /not overwritten/)
  assert.match((await run(['--init', 'gitlab', '--write'], d)).out, /wrote \.gitlab-ci\.yml/)
  assert.match((await run(['--init', 'gitlab', '--write'], d)).out, /wrote \.gitlab\/quality-code\.gitlab-ci\.yml/, 'the file is there: the job goes in a file of its own')
  assert.match((await run(['--init', 'gitlab', '--write'], d)).err, /not overwritten/)
  // an existing .gitlab-ci.yml gets the job in a file of its own
  const g = project({ '.gitlab-ci.yml': 'stages: [test]\n' })
  const r = await run(['--init', 'gitlab', '--write'], g)
  assert.match(r.out, /wrote \.gitlab\/quality-code\.gitlab-ci\.yml/)
  assert.match(r.out, /include:\n  - local: \.gitlab\/quality-code\.gitlab-ci\.yml/)
  assert.equal(readFileSync(join(g, '.gitlab-ci.yml'), 'utf8'), 'stages: [test]\n')
})

test('bad options and a missing config exit 2', async () => {
  const d = project()
  for (const argv of [['--changed'], ['--suite', 'all'], ['--flaky', '0'], ['--init', 'jenkins'], ['--write'], ['--nope'], ['--suite']]) assert.equal((await run(argv, d)).code, 2, argv.join(' '))
  const none = mkdtempSync(join(tmpdir(), 'qc-ci-none-'))
  const r = await run([], none)
  assert.equal(r.code, 2)
})

test('a side the project does not have is an error alone, and skipped in a full run', async () => {
  const be = project({ '.claude/quality-code.json': JSON.stringify({ ...cfg, adapter: 'vitest', playwright: undefined }) })
  assert.match((await run(['--suite', 'frontend'], be)).err, /no frontend tests/)
  const r = await run([], be)
  assert.match(r.out, /== frontend · skipped/)
})

test('a project with specs missing never passes: zero tests is not verified (exit 3)', async () => {
  const d = project()
  const r = await run([], d)
  assert.equal(r.code, 3)
  assert.match(r.out, /not verified/)
  assert.match(r.out, /Result: NOT VERIFIED \(exit 3\)/)
})

test('--json prints one object, the JUnit file has a testcase per phase, GitHub gets a summary and an error annotation', async () => {
  const d = project(), summary = join(d, 'summary.md')
  const r = await run(['--json', '--junit', 'out/j.xml'], d, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary })
  const j = JSON.parse(r.out.split('\n').find(l => l.startsWith('{')))
  assert.equal(j.exit, 3)
  assert.equal(j.provider, 'github')
  assert.deepEqual(j.phases.map(p => p.name), ['evals', 'backend', 'frontend'])
  const xml = readFileSync(join(d, 'out/j.xml'), 'utf8')
  assert.equal((xml.match(/<testcase /g) ?? []).length, 3)
  assert.match(xml, /<failure message="not verified">/)
  assert.match(readFileSync(summary, 'utf8'), /## Quality Code: NOT VERIFIED\n\n\| Phase \| Verdict \| Tests \|/)
  assert.match(r.err, /::error title=Quality Code backend::not verified/)
  assert.doesNotMatch(r.out, /::error/, 'the JSON stays clean')
})

test('junit escapes text and marks skipped phases', () => {
  const x = junit([{ name: 'a<b', verdict: 'checks_failed', detail: 'x & "y"' }, { name: 'evals', verdict: 'skipped', detail: '' }, { name: 'ok', verdict: 'green', detail: '' }])
  assert.match(x, /name="a&lt;b"><failure message="checks failed">x &amp; &quot;y&quot;/)
  assert.match(x, /<skipped\/>/)
  assert.match(x, /tests="3" failures="1"/)
})

import { execFileSync } from 'node:child_process'
const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

test('on a branch that changed only docs there is nothing to test: exit 0, no pipeline run', async () => {
  const d = project({ 'e2e/a.spec.ts': 'x', 'README.md': 'a' })
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  git(d, 'checkout', '-qb', 'feature/ABC-1'); writeFileSync(join(d, 'README.md'), 'b'); git(d, 'commit', '-qam', 'docs')
  const r = await run([], d)
  assert.equal(r.code, 0)
  assert.match(r.out, /Running only what changed \(changes since main: 0 test files, 0 code files\)/)
  assert.match(r.out, /== backend · skipped \(nothing changed in backend\)/)
  assert.match(r.out, /Result: NOTHING TO TEST/)
  assert.doesNotMatch(r.out, /== evals/, 'evals run only with a test change or a full run')
})

test('on the default branch, or with --all, everything is asked for', async () => {
  const d = project({ 'README.md': 'a' })
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  assert.match((await run([], d)).out, /Running everything: this is main itself/)
  git(d, 'checkout', '-qb', 'feature/x')
  assert.match((await run(['--all'], d)).out, /Running everything: every phase was asked for/)
})
