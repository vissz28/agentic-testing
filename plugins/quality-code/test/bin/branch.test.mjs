import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detect, stripCredentials, keyCandidates, kindOf, playwrightTestDirs, parseStatusZ, parseNameStatusZ } from '../../bin/branch.mjs'

const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('stripCredentials drops user:password@ from URLs and leaves the rest', () => {
  assert.equal(stripCredentials('https://u:p@gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials('https://oauth2@gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials('git@gitlab.example:x.git'), 'git@gitlab.example:x.git')
  assert.equal(stripCredentials('https://gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials(null), null)
})
test('keyCandidates keeps configured projects only, in order, without duplicates', () => {
  assert.deepEqual(keyCandidates(['DEMO-12-ADD-EXPORT', 'TRK-7 export', 'OTHER-1 x', 'DEMO-12 again'], ['DEMO', 'TRK']), ['DEMO-12', 'TRK-7'])
  assert.deepEqual(keyCandidates(['feature/MY_PROJ-12-x', 'PROJ_3'], ['PROJ', 'MY_PROJ']), ['MY_PROJ-12', 'PROJ-3'], 'a key with "_" is not also read as its tail')
  assert.deepEqual(keyCandidates(['ABC-1'], []), [])
  assert.deepEqual(keyCandidates([null, undefined, ''], ['DEMO']), [])
})
test('keyCandidates finds a key joined with _ or / and ignores a longer prefix', () => {
  assert.deepEqual(keyCandidates(['FEATURE/DEMO-12_EXPORT'], ['DEMO']), ['DEMO-12'])
  assert.deepEqual(keyCandidates(['XDEMO-12'], ['DEMO']), [])
  assert.deepEqual(keyCandidates(['DEMO-123'], ['DEMO']), ['DEMO-123'])
})
test('kindOf: tests by name, code by extension, the rest other', () => {
  assert.equal(kindOf('src/a.spec.ts', 'vitest'), 'test')
  assert.equal(kindOf('src/a.test.js', 'vitest'), 'test')
  assert.equal(kindOf('src/a.ts', 'vitest'), 'code')
  assert.equal(kindOf('src/App.vue', 'vitest'), 'code')
  assert.equal(kindOf('README.md', 'vitest'), 'other')
  assert.equal(kindOf('e2e/helpers.ts', 'vitest'), 'code')
  assert.equal(kindOf('e2e/helpers.ts', 'playwright', ['e2e/']), 'test')
})
test('playwrightTestDirs reads a plain testDir, else e2e/ and tests/', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-pw-'))
  assert.deepEqual(playwrightTestDirs(d), ['e2e/', 'tests/'])
  put(d, 'playwright.config.ts', "export default defineConfig({ testDir: './e2e/specs', retries: 0 })")
  assert.deepEqual(playwrightTestDirs(d), ['e2e/specs/'])
  put(d, 'playwright.config.ts', 'export default defineConfig({ testDir: process.env.DIR })')
  assert.deepEqual(playwrightTestDirs(d), ['e2e/', 'tests/'])
})
test('parseStatusZ: untracked is A, renames skip the old path, paths keep spaces', () => {
  const out = ['?? docs/my notes.md', ' M src/a.ts', 'R  src/c.ts', 'src/b.ts', ' D src/gone.ts', 'A  src/new.ts', ''].join('\0')
  assert.deepEqual(parseStatusZ(out), [
    { path: 'docs/my notes.md', status: 'A' },
    { path: 'src/a.ts', status: 'M' },
    { path: 'src/c.ts', status: 'R' },
    { path: 'src/gone.ts', status: 'D' },
    { path: 'src/new.ts', status: 'A' },
  ])
  assert.deepEqual(parseStatusZ(''), [])
})
test('parseNameStatusZ: renames keep the new path, copies count as added', () => {
  const out = ['M', 'src/a.ts', 'R100', 'src/old.ts', 'src/new.ts', 'D', 'src/gone.ts', 'C75', 'src/x.ts', 'src/y.ts', 'T', 'src/t.ts', ''].join('\0')
  assert.deepEqual(parseNameStatusZ(out), [
    { path: 'src/a.ts', status: 'M' },
    { path: 'src/new.ts', status: 'R' },
    { path: 'src/gone.ts', status: 'D' },
    { path: 'src/y.ts', status: 'A' },
    { path: 'src/t.ts', status: 'M' },
  ])
})

const BRANCH = join(dirname(fileURLToPath(import.meta.url)), '../../bin/branch.mjs')
// The user's global git config may sign commits or run hooks; switch both off for the temp repos.
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 'user@example.test',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 'user@example.test',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
}
const g = (d, ...a) => execFileSync('git', a, { cwd: d, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const cfg = (over = {}) => ({
  version: 1, adapter: 'vitest',
  jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], trackingProjects: ['TRK'], acceptanceCriteriaField: null },
  languages: ['en'], features: [], redact: { customerId: '\\bU\\d{5,}\\b' }, ...over,
})
const commit = (d, msg, files) => { for (const [p, s] of Object.entries(files)) put(d, p, s); g(d, 'add', '-A'); g(d, 'commit', '-qm', msg) }
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'at-br-'))
  g(d, 'init', '-q', '-b', 'main')
  commit(d, 'init', { 'src/a.ts': 'a\n', 'src/old.ts': 'old\n' })
  return d
}

test('not a git repo: isRepo false and nothing else', () => {
  const r = detect(mkdtempSync(join(tmpdir(), 'at-nogit-')), cfg())
  assert.equal(r.isRepo, false)
  assert.deepEqual(r.files, [])
  assert.equal(r.base, null)
})
test('feature branch: fallback base, counts, committed and uncommitted files, key from the branch', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-12-add-export')
  commit(d, 'add export', { 'src/b.ts': 'b\n', 'test/b.spec.ts': 't\n', 'README.md': 'r\n' })
  put(d, 'src/a.ts', 'changed\n')
  put(d, 'docs/my notes.md', 'n\n')
  const r = detect(d, cfg())
  assert.equal(r.isRepo, true)
  assert.equal(r.branch, 'DEMO-12-add-export')
  assert.equal(r.base, 'main')
  assert.equal(r.baseSource, 'fallback')
  assert.equal(r.onBase, false)
  assert.equal(r.ahead, 1)
  assert.equal(r.behind, 0)
  assert.ok(r.mergeBase)
  assert.deepEqual(r.counts, { code: 2, test: 1, other: 2, uncommitted: 2 })
  assert.deepEqual(r.files.find(f => f.path === 'docs/my notes.md'), { path: 'docs/my notes.md', status: 'A', kind: 'other', committed: false })
  assert.deepEqual(r.files.find(f => f.path === 'src/a.ts'), { path: 'src/a.ts', status: 'M', kind: 'code', committed: false })
  assert.deepEqual(r.files.find(f => f.path === 'test/b.spec.ts'), { path: 'test/b.spec.ts', status: 'A', kind: 'test', committed: true })
  assert.deepEqual(r.keys, ['DEMO-12'])
  assert.deepEqual(r.files.map(f => f.path), [...r.files.map(f => f.path)].sort())
})
test('behind counts commits on the base after the branch started', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-1-x')
  commit(d, 'x', { 'src/x.ts': 'x\n' })
  g(d, 'checkout', '-q', 'main')
  commit(d, 'other', { 'src/y.ts': 'y\n' })
  g(d, 'checkout', '-q', 'DEMO-1-x')
  const r = detect(d, cfg())
  assert.equal(r.ahead, 1)
  assert.equal(r.behind, 1)
  assert.deepEqual(r.files.map(f => f.path), ['src/x.ts'])
})
test('fallback prefers develop over main', () => {
  const d = repo()
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-2-x')
  assert.equal(detect(d, cfg()).base, 'develop')
})
test('--base wins; an unknown --base gives no base', () => {
  const d = repo()
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-3-x')
  const r = detect(d, cfg(), { base: 'main' })
  assert.equal(r.base, 'main')
  assert.equal(r.baseSource, 'flag')
  const n = detect(d, cfg(), { base: 'nope' })
  assert.equal(n.base, null)
  assert.equal(n.baseSource, null)
  assert.ok(n.branches.includes('develop') && n.branches.includes('main'))
})
test('origin/HEAD wins over the fallback and origin/HEAD is not listed as a branch', () => {
  const d = repo()
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  g(bare, 'init', '-q', '--bare')
  g(d, 'remote', 'add', 'origin', bare)
  g(d, 'push', '-q', 'origin', 'main')
  g(d, 'remote', 'set-head', 'origin', 'main')
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-4-x')
  const r = detect(d, cfg())
  assert.equal(r.base, 'origin/main')
  assert.equal(r.baseSource, 'origin-head')
  assert.ok(r.branches.includes('origin/main'))
  assert.ok(!r.branches.includes('origin/HEAD') && !r.branches.includes('origin'))
})
test('renames and deletes in committed changes', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-5-x')
  g(d, 'mv', 'src/a.ts', 'src/c.ts')
  g(d, 'rm', '-q', 'src/old.ts')
  g(d, 'commit', '-qm', 'move')
  const r = detect(d, cfg())
  assert.deepEqual(r.files.map(f => [f.path, f.status]), [['src/c.ts', 'R'], ['src/old.ts', 'D']])
})
test('key from a commit subject when the branch has none; other projects ignored', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'feature/export')
  commit(d, 'TRK-7 export', { 'src/e.ts': 'e\n' })
  commit(d, 'OTHER-1 nothing', { 'src/f.ts': 'f\n' })
  assert.deepEqual(detect(d, cfg()).keys, ['TRK-7'])
})
test('a lower-case key in the branch name is found', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'feature/demo-12_export')
  assert.deepEqual(detect(d, cfg()).keys, ['DEMO-12'])
})
test('detached HEAD', () => {
  const d = repo()
  g(d, 'checkout', '-q', '--detach')
  const r = detect(d, cfg())
  assert.equal(r.detached, true)
  assert.equal(r.branch, null)
  assert.ok(r.head)
})
test('on the base branch, even when it is ahead of origin', () => {
  const d = repo()
  assert.equal(detect(d, cfg()).onBase, true)
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  g(bare, 'init', '-q', '--bare')
  g(d, 'remote', 'add', 'origin', bare)
  g(d, 'branch', 'develop')
  g(d, 'push', '-q', 'origin', 'develop')
  g(d, 'checkout', '-q', 'develop')
  commit(d, 'local only', { 'src/l.ts': 'l\n' })
  assert.equal(detect(d, cfg(), { base: 'origin/develop' }).onBase, true)
})
test('shallow clone with no merge base', () => {
  const src = repo()
  g(src, 'checkout', '-qb', 'DEMO-6-x')
  commit(src, 'feature', { 'src/f.ts': 'f\n' })
  g(src, 'checkout', '-q', 'main')
  commit(src, 'main moves', { 'src/m.ts': 'm\n' })
  const dst = mkdtempSync(join(tmpdir(), 'at-shallow-'))
  g(dst, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${src}`, '.')
  g(dst, 'checkout', '-q', 'DEMO-6-x')
  const r = detect(dst, cfg())
  assert.equal(r.shallow, true)
  assert.equal(r.base, 'origin/main')
  assert.equal(r.mergeBase, null)
  assert.deepEqual(r.files, [])
})
test('remote credentials are stripped and paths are redacted', () => {
  const d = repo()
  g(d, 'remote', 'add', 'origin', 'https://u:p@gitlab.example/x.git')
  g(d, 'checkout', '-qb', 'DEMO-8-x')
  const id = 'U' + '123456'
  commit(d, 'x', { [`fixtures/${id}.json`]: '{}\n' })
  const r = detect(d, cfg())
  assert.equal(r.remote, 'https://gitlab.example/x.git')
  assert.deepEqual(r.files.map(f => f.path), ['fixtures/U######.json'])
})
test('playwright: files under the configured testDir are tests', () => {
  const d = repo()
  commit(d, 'pw', { 'playwright.config.ts': "export default { testDir: './e2e/specs' }\n" })
  g(d, 'checkout', '-qb', 'DEMO-9-x')
  commit(d, 'spec', { 'e2e/specs/orders.ts': 'o\n', 'e2e/helpers.ts': 'h\n' })
  const r = detect(d, cfg({ adapter: 'playwright' }))
  assert.equal(r.files.find(f => f.path === 'e2e/specs/orders.ts').kind, 'test')
  assert.equal(r.files.find(f => f.path === 'e2e/helpers.ts').kind, 'code')
})

const run = (d, ...args) => spawnSync(process.execPath, [BRANCH, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
const withConfig = d => { put(d, '.claude/quality-code.json', JSON.stringify(cfg())); return d }

test('CLI: no config exits 2 and says how to set up', () => {
  const r = run(repo(), '--detect')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /quality-code:setup/)
})
test('CLI: prints one BRANCH_JSON line', () => {
  const d = withConfig(repo())
  g(d, 'checkout', '-qb', 'DEMO-10-x')
  const r = run(d, '--detect')
  assert.equal(r.status, 0)
  const line = r.stdout.trim().split('\n').find(l => l.startsWith('BRANCH_JSON:'))
  assert.equal(JSON.parse(line.slice('BRANCH_JSON:'.length)).branch, 'DEMO-10-x')
})
test('CLI: usage errors exit 2; a --base that looks like an option is refused', () => {
  const d = withConfig(repo())
  assert.equal(run(d).status, 2)
  assert.equal(run(d, '--detect', '--what').status, 2)
  assert.equal(run(d, '--detect', '--base').status, 2)
  const r = run(d, '--detect', '--base', '--output=x')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /base/)
})

test('review I1: a --base that exists only on origin resolves to origin/<name>', () => {
  const d = repo()
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  g(bare, 'init', '-q', '--bare')
  g(d, 'remote', 'add', 'origin', bare)
  g(d, 'branch', 'develop')
  g(d, 'push', '-q', 'origin', 'develop')
  g(d, 'branch', '-q', '-D', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-20-x')
  const r = detect(d, cfg(), { base: 'develop' })
  assert.equal(r.base, 'origin/develop')
  assert.equal(r.baseSource, 'flag')
})
test('review I2: a new branch at the base commit with uncommitted work is not on the base', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-21-new')
  put(d, 'src/a.ts', 'edited\n')
  const r = detect(d, cfg())
  assert.equal(r.onBase, false)
  assert.deepEqual(r.files.map(f => f.path), ['src/a.ts'])
  assert.deepEqual(r.keys, ['DEMO-21'])
})
test('review I3: a key joined with _ is found and written with -', () => {
  assert.deepEqual(keyCandidates(['DEMO_12_FIX', 'FEATURE/TRK_7'], ['DEMO', 'TRK']), ['DEMO-12', 'TRK-7'])
  const d = repo()
  g(d, 'checkout', '-qb', 'demo_12_fix')
  assert.deepEqual(detect(d, cfg()).keys, ['DEMO-12'])
})
test('review I4: a project in a subfolder sees only its own files, relative to itself', () => {
  const d = repo()
  commit(d, 'web', { 'web/playwright.config.ts': "export default { testDir: './tests' }\n", 'api/y.ts': 'y\n' })
  g(d, 'checkout', '-qb', 'DEMO-22-x')
  commit(d, 'both', { 'web/tests/a.ts': 'a\n', 'api/y.ts': 'changed\n' })
  put(d, 'api/z.ts', 'z\n')
  const r = detect(join(d, 'web'), cfg({ adapter: 'playwright' }))
  assert.deepEqual(r.files.map(f => [f.path, f.kind]), [['tests/a.ts', 'test']])
  assert.deepEqual(r.counts, { code: 0, test: 1, other: 0, uncommitted: 0 })
})
test('review M1: detect does not rewrite the git index', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-23-x')
  const later = new Date(Date.now() + 60_000)
  utimesSync(join(d, 'src/a.ts'), later, later)
  const past = new Date(Date.now() - 3_600_000)
  utimesSync(join(d, '.git/index'), past, past)
  const before = statSync(join(d, '.git/index')).mtimeMs
  detect(d, cfg())
  assert.equal(statSync(join(d, '.git/index')).mtimeMs, before)
})
