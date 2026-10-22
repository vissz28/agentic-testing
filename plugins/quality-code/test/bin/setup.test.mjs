import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { detect, ghAccount, projectCandidates, write } from '../../bin/setup.mjs'
import { fakeCommand } from '../fake-bin.mjs'
import { ENV as GIT_ENV } from '../git-env.mjs'

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '../../bin/setup.mjs')
const repo = pkg => { const d = mkdtempSync(join(tmpdir(), 'at-')); writeFileSync(join(d, 'package.json'), JSON.stringify(pkg)); return d }
const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
const LINE = '.quality-code/tickets/*/raw.json'
const cli = (d, ...args) => spawnSync(process.execPath, [SETUP, ...args], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

test('detects the stack', () => {
  assert.equal(detect(repo({ devDependencies: { '@playwright/test': '1' } })).adapter, 'playwright')
  assert.equal(detect(repo({ devDependencies: { vitest: '1' } })).adapter, 'vitest')
  assert.equal(detect(repo({ devDependencies: { vitest: '1', '@playwright/test': '1' } })).adapter, 'both')
  assert.equal(detect(repo({})).adapter, null)
  assert.equal(detect(mkdtempSync(join(tmpdir(), 'at-'))).adapter, null)
})
test('finds GitLab templates', () => {
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  writeFileSync(join(d, '.gitlab/issue_templates/Bug.md'), '#')
  assert.equal(detect(d).templates.bug, '.gitlab/issue_templates/Bug.md')
  assert.equal(detect(d).templates.story, null)
})
test('finds GitHub templates', () => {
  const d = repo({}); mkdirSync(join(d, '.github/ISSUE_TEMPLATE'), { recursive: true })
  writeFileSync(join(d, '.github/ISSUE_TEMPLATE/story.md'), '#')
  assert.equal(detect(d).templates.story, '.github/ISSUE_TEMPLATE/story.md')
})
test('detect reports existing config, bad JSON and gitignore state', () => {
  const d = repo({})
  assert.equal(detect(d).existing, null)
  assert.equal(detect(d).gitignore, false)
  write(d, cfg, {})
  const r = detect(d)
  assert.deepEqual(r.existing, cfg)
  assert.equal(r.gitignore, true)
  writeFileSync(join(d, '.claude/quality-code.json'), '{nope')
  const bad = detect(d)
  assert.equal(bad.existing, null)
  assert.match(bad.existingError, /not valid JSON/)
})
test('write refuses an invalid config and writes nothing', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, languages: [] }, { gitignoreLine: 'x' }).ok, false)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  assert.equal(existsSync(join(d, '.gitignore')), false)
})
test('write writes the config and one gitignore line, idempotently', () => {
  const d = repo({})
  write(d, cfg, { gitignoreLine: LINE })
  write(d, cfg, { gitignoreLine: LINE })
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')), cfg)
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8').match(/raw\.json/g).length, 1)
})
test('config is written as given, 2-space with trailing newline', () => {
  const d = repo({})
  write(d, cfg, {})
  assert.equal(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'), `${JSON.stringify(cfg, null, 2)}\n`)
})
test('gitignore: newline added before the line, content kept; custom ticketsDir used', () => {
  const d = repo({}); writeFileSync(join(d, '.gitignore'), 'node_modules')
  write(d, { ...cfg, ticketsDir: 'tix' }, {})
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'node_modules\ntix/*/raw.json\n.claude/quality-code/jira-fields.json\n.claude/quality-code/*.jsonl\n.claude/quality-code/run.active\nmut-tmp-*\n.claude/quality-code/audit/\n')
  const e = repo({}); writeFileSync(join(e, '.gitignore'), 'a\n')
  write(e, cfg, {})
  assert.equal(readFileSync(join(e, '.gitignore'), 'utf8'), `a\n${LINE}\n.claude/quality-code/jira-fields.json\n.claude/quality-code/*.jsonl\n.claude/quality-code/run.active\nmut-tmp-*\n.claude/quality-code/audit/\n`)
})
test('gitignore: a trailing slash or backslashes in ticketsDir still give <dir>/*/raw.json', () => {
  for (const ticketsDir of ['tix/', 'tix\\']) {
    const d = repo({})
    assert.equal(write(d, { ...cfg, ticketsDir }, {}).ok, true)
    assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'tix/*/raw.json\n.claude/quality-code/jira-fields.json\n.claude/quality-code/*.jsonl\n.claude/quality-code/run.active\nmut-tmp-*\n.claude/quality-code/audit/\n', ticketsDir)
    assert.equal(detect(d).gitignore, true, ticketsDir)
  }
})
test('a newline in ticketsDir is refused before .gitignore is touched', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, ticketsDir: 'tix\n!secret' }, {}).ok, false)
  assert.equal(existsSync(join(d, '.gitignore')), false)
})
test('templates are written when absent and wired into ticketTemplates', () => {
  const d = repo({})
  assert.equal(write(d, cfg, { templates: { bug: '# Bug', story: '# Story' } }).ok, true)
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'utf8'), '# Bug\n')
  assert.equal(existsSync(join(d, '.gitlab/issue_templates/Story.md')), true)
  const written = JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'))
  assert.deepEqual(written.ticketTemplates, { bug: '.gitlab/issue_templates/Bug.md', story: '.gitlab/issue_templates/Story.md' })
})
test('existing templates are never overwritten', () => {
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  writeFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'mine')
  write(d, cfg, { templates: { bug: '# Bug', story: '# Story' } })
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'utf8'), 'mine')
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Story.md'), 'utf8'), '# Story\n')
})
test('a ticketTemplates value already set is kept', () => {
  const d = repo({})
  const c = { ...cfg, ticketTemplates: { bug: 'docs/bug.md', story: null } }
  write(d, c, { templates: { bug: '#', story: '#' } })
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).ticketTemplates, c.ticketTemplates)
})
test('paths escaping the project are rejected and nothing is written', () => {
  for (const bad of [{ ticketsDir: '../out' }, { ticketsDir: '/abs' }, { ticketTemplates: { bug: '../b.md' } }, { ticketTemplates: { story: '/etc/x' } }]) {
    const d = repo({})
    const r = write(d, { ...cfg, ...bad }, { templates: { bug: '#', story: '#' } })
    assert.equal(r.ok, false)
    assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
    assert.equal(existsSync(join(d, '.gitlab')), false)
  }
})
test('CLI --detect prints one SETUP_JSON line and exits 0', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  const r = cli(d, '--detect')
  assert.equal(r.status, 0)
  const lines = r.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0].replace(/^SETUP_JSON:/, '')).adapter, 'vitest')
})
test('CLI --write @file writes and prints ok', () => {
  const d = repo({})
  writeFileSync(join(d, 'p.json'), JSON.stringify({ config: cfg, templates: { bug: '#', story: '#' } }))
  const r = cli(d, '--write', '@p.json')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'ok\n')
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), true)
})
test('CLI --write prints each error on its own line, exits 2, writes nothing', () => {
  const d = repo({})
  writeFileSync(join(d, 'p.json'), JSON.stringify({ config: { ...cfg, languages: [], adapter: 'x' } }))
  const r = cli(d, '--write', '@p.json')
  assert.equal(r.status, 2)
  assert.equal(r.stdout.trimEnd().split('\n').length >= 2, true)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  assert.equal(cli(d, '--write', '@missing.json').status, 2)
})
test('re-running the same proposal is idempotent and keeps ticketTemplates', () => {
  const d = repo({})
  const run = () => { assert.equal(write(d, cfg, { templates: { bug: '#', story: '#' } }).ok, true); return readFileSync(join(d, '.claude/quality-code.json'), 'utf8') }
  const first = run()
  assert.equal(run(), first)
  assert.ok(JSON.parse(first).ticketTemplates)
})
test('write never throws: a dangling symlink at a template path is an error, nothing partial written', async () => {
  const { symlinkSync } = await import('node:fs')
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  symlinkSync(join(d, 'missing-target'), join(d, '.gitlab/issue_templates/Bug.md'))
  const proposal = { config: cfg, templates: { bug: '#', story: '#' } }
  const r = write(d, proposal.config, { templates: proposal.templates })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /Bug\.md/)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  writeFileSync(join(d, 'p.json'), JSON.stringify(proposal))
  const c = cli(d, '--write', '@p.json')
  assert.equal(c.status, 2)
  assert.match(c.stdout, /Bug\.md/)
  assert.equal(c.stderr, '')
})

test('detect: where the project lives, and its GitLab project from the origin remote', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' })
  assert.deepEqual(detect(d).here, { folder: d.split('/').pop(), repoTop: null, subfolder: null, remote: null, gitlab: null, github: null })
  g('init', '-q')
  g('remote', 'add', 'origin', 'https://user:secret@gitlab.example.com/team/sub/app.git')
  const h = detect(d).here
  assert.equal(h.subfolder, null)
  assert.deepEqual(h.gitlab, { host: 'gitlab.example.com', path: 'team/sub/app' })
  g('remote', 'set-url', 'origin', 'git@gitlab.example.com:team/app.git')
  assert.deepEqual(detect(d).here.gitlab, { host: 'gitlab.example.com', path: 'team/app' })
  mkdirSync(join(d, 'web'))
  writeFileSync(join(d, 'web/package.json'), '{}')
  assert.equal(detect(join(d, 'web')).here.subfolder, 'web')
  g('remote', 'set-url', 'origin', 'git@github.com:acme/app.git')
  assert.deepEqual([detect(d).here.remote, detect(d).here.gitlab], [{ host: 'github.com', path: 'acme/app', kind: 'github' }, null], 'a GitHub remote is no GitLab project')
})

test('ghAccount: gh\'s signed-in account on a host, or why not; a GitHub on its own domain is a GitHub', () => {
  const gh = fakeCommand('gh')
  // gh auth status --hostname <host> --active --json hosts: signed in on github.com and git.acme.example only.
  gh.act(`case "$4" in
github.com|git.acme.example) echo "{\\"hosts\\":{\\"$4\\":[{\\"state\\":\\"success\\",\\"active\\":true,\\"login\\":\\"jdoe\\"}]}}" ;;
expired.example) echo '{"hosts":{"expired.example":[{"state":"error","active":true,"login":"jdoe"}]}}' ;;
*) echo '{"hosts":{}}' ;;
esac`)
  try {
    assert.deepEqual(ghAccount('github.com'), { login: 'jdoe' })
    assert.deepEqual(ghAccount('gitlab.example.com'), { login: null, reason: 'gh is not signed in to gitlab.example.com' })
    assert.deepEqual(ghAccount('expired.example'), { login: null, reason: 'gh\'s sign-in to expired.example no longer works' })
    const d = repo({ devDependencies: { vitest: '1' } })
    const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' })
    g('init', '-q')
    g('remote', 'add', 'origin', 'git@git.acme.example:team/app.git')
    assert.deepEqual([detect(d).here.remote.kind, detect(d).here.gitlab, detect(d).here.github], ['github', null, { login: 'jdoe' }], 'GitHub Enterprise')
    g('remote', 'set-url', 'origin', 'git@gitlab.example.com:team/app.git')
    assert.deepEqual([detect(d).here.remote.kind, detect(d).here.github], ['gitlab', null])
    g('remote', 'set-url', 'origin', 'git@github.com:acme/app.git')
    gh.act('echo \'{"hosts":{}}\'')
    assert.deepEqual(detect(d).here.github, { login: null, reason: 'gh is not signed in to github.com' }, 'a GitHub remote without a sign-in still gets its GitHub line')
    gh.act('exit 1')
    assert.deepEqual(ghAccount('github.com'), { login: null, reason: 'gh could not check github.com' })
  } finally {
    gh.restore()
  }
  const path = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'no-gh-'))
  try {
    assert.deepEqual(ghAccount('github.com'), { login: null, reason: 'gh is not installed' })
  } finally {
    process.env.PATH = path
  }
})
test('GitHub: its default template names are found, and new templates go to .github', () => {
  const d = repo({})
  spawnSync('git', ['init', '-q'], { cwd: d }); spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], { cwd: d })
  touch(d, '.github/ISSUE_TEMPLATE/bug_report.md')
  assert.equal(detect(d).templates.bug, '.github/ISSUE_TEMPLATE/bug_report.md')
  assert.equal(write(d, cfg, { templates: { bug: '# Bug', story: '# Story' } }).ok, true)
  assert.equal(existsSync(join(d, '.gitlab')), false)
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).ticketTemplates, { bug: '.github/ISSUE_TEMPLATE/bug_report.md', story: '.github/ISSUE_TEMPLATE/story.md' })
})
test('CLI --write takes the proposal inline, no temp file', () => {
  const d = repo({})
  const r = cli(d, '--write', JSON.stringify({ config: cfg }))
  assert.equal(r.stdout, 'ok\n')
  assert.equal(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).adapter, 'vitest')
  assert.equal(cli(d, '--write', '{nope').status, 2)
})
test('detect: a vite.config with a test block is a Vitest config; a ./ ticketsDir still git-ignores raw.json', () => {
  const d = repo({})
  writeFileSync(join(d, 'vite.config.ts'), 'export default defineConfig({ test: { environment: "jsdom" } })')
  assert.deepEqual(detect(d).vitestConfigs, ['vite.config.ts'])
  writeFileSync(join(d, 'vite.config.ts'), 'export default defineConfig({ plugins: [] })')
  assert.deepEqual(detect(d).vitestConfigs, [])
  assert.equal(write(d, { ...cfg, ticketsDir: './qa/tickets' }, {}).ok, true)
  assert.ok(readFileSync(join(d, '.gitignore'), 'utf8').split('\n').includes('qa/tickets/*/raw.json'))
})
test('write git-ignores the local Jira field memory', () => {
  const d = repo({})
  write(d, cfg, {})
  assert.ok(readFileSync(join(d, '.gitignore'), 'utf8').split('\n').includes('.claude/quality-code/jira-fields.json'))
})

test('detect lists the boundary candidates that exist, and specs next to the code', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  for (const p of ['src/a.ts', 'prisma/schema.prisma', '.env.local', '.gitlab-ci.yml', '.github/workflows/ci.yml']) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), 'x') }
  const r = detect(d)
  assert.deepEqual(r.boundaries, ['src/', 'prisma/', '.env.*', '.gitlab-ci.yml', '.github/workflows/'])
  for (const p of ['app/page.tsx', 'packages/api/src/a.ts', 'Jenkinsfile', 'dapr/x.yaml']) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), 'x') }
  assert.deepEqual(detect(d).boundaries, ['src/', 'app/', 'prisma/', 'packages/*/src/', '.env.*', '.gitlab-ci.yml', '.github/workflows/', 'Jenkinsfile'])
  assert.equal(r.specsBesideCode, false)
  writeFileSync(join(d, 'src/a.spec.ts'), 'x')
  assert.equal(detect(d).specsBesideCode, true)
})
const touch = (d, p) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), 'x') }
test('specFolders: the first two segments of the folders that hold specs', () => {
  const d = repo({})
  assert.deepEqual(detect(d).specFolders, [])
  touch(d, 'test/unit/a.spec.ts')
  touch(d, 'test/unit/deep/more/b.test.ts')
  touch(d, 'test/integration/c.test.mjs')
  touch(d, 'test/unit/helper.ts')
  touch(d, 'root.test.ts')
  assert.deepEqual(detect(d).specFolders, ['test/integration/', 'test/unit/'])
})
test('specFolders: a spec directly in test/ gives test/', () => {
  const d = repo({})
  touch(d, 'test/a.test.ts')
  touch(d, 'e2e/flows/b.spec.ts')
  assert.deepEqual(detect(d).specFolders, ['e2e/flows/', 'test/'])
})
test('specFolders: node_modules, .git and dist are ignored', () => {
  const d = repo({})
  touch(d, 'node_modules/lib/test/a.test.js')
  touch(d, 'packages/x/node_modules/y/b.spec.js')
  touch(d, '.git/hooks/c.test.js')
  touch(d, 'dist/test/d.test.js')
  assert.deepEqual(detect(d).specFolders, [])
})
test('specFolders: sorted, at most 10', () => {
  const d = repo({})
  for (const n of [11, 3, 7, 1, 12, 5, 9, 2, 10, 4, 8, 6]) touch(d, `test/l${String(n).padStart(2, '0')}/a.test.ts`)
  const f = detect(d).specFolders
  assert.equal(f.length, 10)
  assert.deepEqual(f, Array.from({ length: 10 }, (_, i) => `test/l${String(i + 1).padStart(2, '0')}/`))
})
test('write adds the runtime gitignore lines once', () => {
  const d = repo({})
  write(d, cfg, {})
  write(d, cfg, {})
  const lines = readFileSync(join(d, '.gitignore'), 'utf8').trim().split('\n')
  assert.deepEqual(lines, ['.quality-code/tickets/*/raw.json', '.claude/quality-code/jira-fields.json', '.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*', '.claude/quality-code/audit/'])
})
test('the runtime gitignore lines keep the audit log, the boundary log and the run marker out of git', () => {
  const d = repo({})
  spawnSync('git', ['init', '-q'], { cwd: d })
  write(d, cfg, {})
  const files = ['.claude/quality-code/audit/gate.jsonl', '.claude/quality-code/audit/pipeline.jsonl', '.claude/quality-code/boundary.jsonl', '.claude/quality-code/run.active']
  const r = spawnSync('git', ['check-ignore', '--no-index', ...files], { cwd: d, encoding: 'utf8' })
  assert.deepEqual(r.stdout.trim().split('\n'), files, r.stderr)
})
test('detect lists the root Vitest configs, sorted, and [] when there are none', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  assert.deepEqual(detect(d).vitestConfigs, [])
  for (const f of ['vitest.e2e.config.mts', 'vitest.config.ts', 'vitest.config.db.ts', 'vite.config.ts', 'vitest.setup.ts', 'notvitest.config.ts']) writeFileSync(join(d, f), 'x')
  assert.deepEqual(detect(d).vitestConfigs, ['vitest.config.db.ts', 'vitest.config.ts', 'vitest.e2e.config.mts'])
})
test('write keeps boundaries', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, boundaries: { forbidden: [{ path: 'src/' }] } }, {}).ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).boundaries, { forbidden: [{ path: 'src/' }] })
})

test('detect: Playwright configs at the root or up to two folders down, with the folder their testDir gives', () => {
  const d = repo({ devDependencies: { vitest: '1', '@playwright/test': '1' } })
  mkdirSync(join(d, 'e2e'))
  writeFileSync(join(d, 'e2e/playwright.config.ts'), "export default { testDir: './tests' }\n")
  mkdirSync(join(d, 'node_modules/x'), { recursive: true })
  writeFileSync(join(d, 'node_modules/x/playwright.config.ts'), "export default { testDir: 'nope' }\n")
  const r = detect(d)
  assert.equal(r.adapter, 'both')
  assert.deepEqual(r.playwrightConfigs, [{ config: 'e2e/playwright.config.ts', folder: 'e2e/tests/' }])
  writeFileSync(join(d, 'playwright.config.ts'), 'export default { testDir: path.join(__dirname, "t") }\n')
  assert.deepEqual(detect(d).playwrightConfigs.map(c => [c.config, c.folder]), [['playwright.config.ts', null], ['e2e/playwright.config.ts', 'e2e/tests/']])
})

const gitIn = d => (...a) => execFileSync('git', a, { cwd: d, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
function gitRepo() {
  const d = repo({ devDependencies: { vitest: '1' } })
  const g = gitIn(d)
  g('init', '-q', '-b', 'main')
  g('commit', '-q', '--allow-empty', '-m', 'init')
  return [d, g]
}

test('projectCandidates: the prefixes of Jira keys, most frequent first, without look-alikes', () => {
  assert.deepEqual(projectCandidates(['DEMO-19338 export', 'fix DEMO-19360 totals', 'ABC-1 typo']), ['DEMO', 'ABC'])
  assert.deepEqual(projectCandidates(['ABC-1', 'DEMO-2', 'DEMO-3']), ['DEMO', 'ABC'], 'a later key seen more often comes first')
  assert.deepEqual(projectCandidates(['feature/MY_PROJ-12-x', "Merge branch 'DEMO-4-y' into 'develop'"]), ['MY_PROJ', 'DEMO'])
  assert.deepEqual(projectCandidates(['UTF-8 files', 'SHA-256 sums', 'PR-12', 'A-1 one letter', 'xDEMO-1', 'demo-1 lower', 'DEMO-x']), [])
  assert.deepEqual(projectCandidates([null, undefined, '']), [])
  assert.equal(projectCandidates(['AB-1', 'BC-1', 'CD-1', 'DE-1', 'EF-1', 'FG-1']).length, 5)
})
test('detect: recent commits naming DEMO-19338 and DEMO-19360 propose DEMO; branch names count too', () => {
  const [d, g] = gitRepo()
  assert.deepEqual(detect(d).projectCandidates, [])
  g('commit', '-q', '--allow-empty', '-m', 'DEMO-19338 add export')
  g('commit', '-q', '--allow-empty', '-m', 'DEMO-19360 fix totals')
  assert.deepEqual(detect(d).projectCandidates, ['DEMO'])
  for (const b of ['feature/ABC-1-x', 'ABC-2-y', 'ABC-3-z']) g('branch', b)
  assert.deepEqual(detect(d).projectCandidates, ['ABC', 'DEMO'])
  assert.deepEqual(detect(repo({})).projectCandidates, [], 'no repo: none')
})
test('detect: the base is develop when origin/develop exists, else origin/HEAD, else none', () => {
  const [d, g] = gitRepo()
  assert.equal(detect(d).base, null, 'no remote')
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  gitIn(bare)('init', '-q', '--bare')
  g('remote', 'add', 'origin', bare)
  g('push', '-q', 'origin', 'main')
  g('remote', 'set-head', 'origin', 'main')
  assert.deepEqual(detect(d).base, { proposed: 'main', source: 'origin-head' })
  g('branch', 'develop')
  assert.deepEqual(detect(d).base, { proposed: 'main', source: 'origin-head' }, 'a local develop alone is not the team\'s base')
  g('push', '-q', 'origin', 'develop')
  assert.deepEqual(detect(d).base, { proposed: 'develop', source: 'develop' })
  assert.equal(detect(repo({})).base, null, 'no repo: none')
})
test('the proposed base is written as git.base', () => {
  const [d] = gitRepo()
  assert.equal(write(d, { ...cfg, git: { base: 'develop' } }, {}).ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).git, { base: 'develop' })
})
