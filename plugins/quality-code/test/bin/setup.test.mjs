import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { SMOKE_TEXT, detect, ghAccount, playwrightConfigText, projectCandidates, smoke, unitOverlap, write } from '../../bin/setup.mjs'
import { e2eFolder } from '../../lib/base/e2e-folder.mjs'
import { filePattern } from '../../lib/pipeline/runners/playwright.mjs'
import { calls, fakeBin, fakeCommand } from '../fake-bin.mjs'
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
test('detects the backend of every stack, alone or with Playwright', () => {
  const dir = files => {
    const d = mkdtempSync(join(tmpdir(), 'at-'))
    for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
    return d
  }
  const pick = d => { const r = detect(d); return [r.adapter, r.backend] }
  assert.deepEqual(pick(dir({ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' })), ['pytest', 'pytest'])
  assert.deepEqual(pick(dir({ 'pytest.ini': '' })), ['pytest', 'pytest'])
  assert.deepEqual(pick(dir({ 'requirements-dev.txt': 'pytest==8.0\n' })), ['pytest', 'pytest'])
  assert.deepEqual(pick(dir({ 'tox.ini': '[testenv]\ncommands = pytest\n' })), ['pytest', 'pytest'])
  assert.deepEqual(pick(dir({ 'requirements.txt': 'flask\n' })), [null, null], 'Python without pytest is no backend yet')
  assert.deepEqual(pick(dir({ 'pom.xml': '<project/>' })), ['junit', 'junit'])
  assert.deepEqual(pick(dir({ 'build.gradle.kts': '' })), ['junit', 'junit'])
  assert.deepEqual(pick(dir({ 'go.mod': 'module example.com/demo\n' })), ['go', 'go'])
  assert.deepEqual(pick(dir({ 'Demo.sln': '' })), ['dotnet', 'dotnet'])
  assert.deepEqual(pick(dir({ 'src/Demo.Api/Demo.Api.csproj': '' })), [null, null], 'two folders down is too deep')
  assert.deepEqual(pick(dir({ 'Demo.Api/Demo.Api.csproj': '' })), ['dotnet', 'dotnet'])
  const pw = JSON.stringify({ devDependencies: { '@playwright/test': '1' } })
  assert.deepEqual(pick(dir({ 'package.json': pw, 'go.mod': 'module demo\n' })), ['both', 'go'])
  assert.deepEqual(pick(dir({ 'package.json': pw, 'pytest.ini': '' })), ['both', 'pytest'])
  assert.deepEqual(pick(dir({ 'package.json': JSON.stringify({ devDependencies: { vitest: '1', '@playwright/test': '1' } }) })), ['both', 'vitest'])
  // Vitest first, then the others in the order of the spec; every one found is listed.
  const many = detect(dir({ 'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }), 'go.mod': 'module demo\n', 'pom.xml': '<project/>' }))
  assert.deepEqual([many.adapter, many.backend, many.backends], ['vitest', 'vitest', ['vitest', 'junit', 'go']])
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

// A frontend with no Playwright: setup offers to add it, and a smoke test proves the setup works.
const pwCfg = { ...cfg, adapter: 'playwright' }
const SCAFFOLD = { command: 'npm run dev', url: 'http://localhost:5173', signIn: false }
const SMOKE = 'e2e/smoke.spec.js'

test('detect: a frontend with no test runner gets a scaffold; a backend or a Playwright config gets none', () => {
  const vite = repo({ scripts: { dev: 'vite --port 3000 --strictPort' }, dependencies: { react: '19' } })
  assert.equal(detect(vite).adapter, null)
  assert.deepEqual(detect(vite).scaffold, { install: 'npm install --save-dev @playwright/test', browsers: 'npx playwright install chromium', command: 'npm run dev', url: 'http://localhost:3000', files: ['playwright.config.js', 'e2e/smoke.spec.js'] })
  assert.equal(detect(repo({ dependencies: { express: '5' }, scripts: { dev: 'node server.js' } })).scaffold, null, 'a backend')
  const plain = repo({ scripts: { dev: 'serve' } })
  writeFileSync(join(plain, 'index.html'), '<html></html>')
  assert.notEqual(detect(plain).scaffold, null, 'an index.html is a frontend too')
  const pw = repo({ devDependencies: { '@playwright/test': '1' }, scripts: { dev: 'next dev' } })
  assert.deepEqual([detect(pw).scaffold.install, detect(pw).scaffold.url], [null, 'http://localhost:3000'], 'installed with no config: only the config to add')
  mkdirSync(join(pw, 'e2e'))
  writeFileSync(join(pw, 'e2e/playwright.config.ts'), 'export default {}')
  assert.equal(detect(pw).scaffold, null, 'a config, even in a subfolder: nothing to add')
  assert.equal(detect(mkdtempSync(join(tmpdir(), 'at-'))).scaffold, null, 'no package.json')
})
test('detect: TypeScript adds @types/node; the package manager from package.json or the nearest lockfile; Plug\'n\'Play is a problem', () => {
  const ts = repo({ dependencies: { vue: '3' }, scripts: { dev: 'vite' } })
  writeFileSync(join(ts, 'tsconfig.json'), '{}')
  assert.equal(detect(ts).scaffold.install, 'npm install --save-dev @playwright/test @types/node')
  assert.deepEqual(detect(ts).scaffold.files, ['playwright.config.ts', 'e2e/smoke.spec.ts'])
  writeFileSync(join(ts, 'pnpm-lock.yaml'), '')
  const p = detect(ts).scaffold
  assert.deepEqual([p.install, p.browsers, p.command], ['pnpm add -D @playwright/test @types/node', 'pnpm exec playwright install chromium', 'pnpm run dev'])
  const ws = mkdtempSync(join(tmpdir(), 'at-'))
  writeFileSync(join(ws, 'yarn.lock'), '')
  mkdirSync(join(ws, 'web'))
  writeFileSync(join(ws, 'web/package.json'), JSON.stringify({ dependencies: { react: '19' }, scripts: { start: 'react-scripts start' } }))
  const y = detect(join(ws, 'web')).scaffold
  assert.deepEqual([y.install, y.browsers, y.command, y.url], ['yarn add -D @playwright/test', 'yarn playwright install chromium', 'yarn run start', 'http://localhost:3000'], 'a workspace keeps its lockfile at its root')
  assert.equal(y.problem, undefined)
  writeFileSync(join(ws, '.pnp.cjs'), '')
  assert.match(detect(join(ws, 'web')).scaffold.problem, /Plug'n'Play[\s\S]*nodeLinker: node-modules/)
  assert.equal(detect(repo({ packageManager: 'bun@1.2.0', dependencies: { svelte: '5' } })).scaffold.install, 'bun add -d @playwright/test')
})
test('detect: the address from the dev script\'s port, the Vite config, else the dev server\'s default; null when unknown', () => {
  const scaffold = (scripts, files = {}) => {
    const d = repo({ dependencies: { react: '19' }, scripts })
    for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
    return detect(d).scaffold
  }
  assert.equal(scaffold({ dev: 'next dev -p 4000' }).url, 'http://localhost:4000')
  assert.equal(scaffold({ start: 'PORT=3005 react-scripts start' }).url, 'http://localhost:3005')
  assert.equal(scaffold({ dev: 'vite' }, { 'vite.config.ts': 'export default { server: { port: 3001 } }' }).url, 'http://localhost:3001')
  assert.equal(scaffold({ dev: 'vite' }).url, 'http://localhost:5173')
  assert.equal(scaffold({ start: 'ng serve' }).url, 'http://localhost:4200')
  assert.equal(scaffold({ dev: 'node server.js' }).url, null)
  assert.equal(scaffold({ dev: 'vite', start: 'vite preview' }).command, 'npm run dev', 'dev first')
  assert.deepEqual([scaffold({ build: 'vite build' }).command, scaffold({ build: 'vite build' }).url], [null, null])
})

test('write with a scaffold: the Playwright config from the command and address, the smoke test, Playwright\'s .gitignore lines', () => {
  const d = repo({})
  assert.equal(write(d, pwCfg, { scaffold: SCAFFOLD }).ok, true)
  const c = readFileSync(join(d, 'playwright.config.js'), 'utf8')
  assert.match(c, /testDir: '\.\/e2e'/)
  assert.match(c, /use: \{ baseURL: 'http:\/\/localhost:5173' \}/)
  assert.ok(c.includes("webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI }"))
  assert.doesNotMatch(c, /setup|storageState|loadEnvFile/)
  assert.equal(readFileSync(join(d, SMOKE), 'utf8'), SMOKE_TEXT)
  const gi = readFileSync(join(d, '.gitignore'), 'utf8').split('\n')
  assert.ok(gi.includes('test-results/') && gi.includes('playwright-report/'))
  assert.ok(!gi.includes('.env.e2e'))
  assert.deepEqual(e2eFolder(d, pwCfg), { ok: true, folder: 'e2e/', source: 'testDir', configFile: 'playwright.config.js' }, 'the plugin reads its testDir')
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')), pwCfg)
})
test('write with a sign-in: a setup project every test depends on; its state and .env.e2e are git-ignored', () => {
  const d = repo({})
  writeFileSync(join(d, 'tsconfig.json'), '{}')
  assert.equal(write(d, pwCfg, { scaffold: { ...SCAFFOLD, signIn: true } }).ok, true)
  const c = readFileSync(join(d, 'playwright.config.ts'), 'utf8')
  assert.ok(c.includes("if (existsSync('.env.e2e')) process.loadEnvFile('.env.e2e')"))
  assert.ok(c.includes("{ name: 'setup', testMatch: /auth\\.setup\\.[cm]?[jt]s/ },"))
  assert.ok(c.includes("storageState: 'playwright/.auth/user.json' }, dependencies: ['setup'] },"))
  assert.equal(readFileSync(join(d, 'e2e/smoke.spec.ts'), 'utf8'), SMOKE_TEXT)
  const gi = readFileSync(join(d, '.gitignore'), 'utf8').split('\n')
  assert.ok(gi.includes('playwright/.auth/') && gi.includes('.env.e2e'))
})
test('the generated config and smoke test are valid JavaScript; quotes and backslashes in the command are escaped', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  const command = "npm run dev -- --host 'x' \\y"
  const files = { 'a.mjs': playwrightConfigText({ ...SCAFFOLD, command, signIn: true }), 'b.mjs': playwrightConfigText(SCAFFOLD), 'c.mjs': SMOKE_TEXT }
  for (const [n, text] of Object.entries(files)) {
    writeFileSync(join(d, n), text)
    assert.equal(spawnSync(process.execPath, ['--check', join(d, n)]).status, 0, n)
  }
  const literal = /command: ('(?:[^'\\]|\\.)*')/.exec(files['a.mjs'])[1]
  assert.equal(new Function(`return ${literal}`)(), command)
})
test('write refuses a scaffold over an existing config, a bad command, address or signIn, or a backend; nothing is written', () => {
  for (const [label, c, s, re, prep = () => {}] of [
    ['an existing config', pwCfg, SCAFFOLD, /playwright\.config\.ts already exists, and setup never replaces it/, d => writeFileSync(join(d, 'playwright.config.ts'), 'mine')],
    ['a two-line command', pwCfg, { ...SCAFFOLD, command: 'a\nb' }, /scaffold\.command/],
    ['an address with a quote', pwCfg, { ...SCAFFOLD, url: "http://x'+y" }, /scaffold\.url/],
    ['an address that is no URL', pwCfg, { ...SCAFFOLD, url: 'localhost:3000' }, /scaffold\.url/],
    ['signIn', pwCfg, { ...SCAFFOLD, signIn: 'yes' }, /scaffold\.signIn/],
    ['no object', pwCfg, null, /scaffold: must be an object/],
    ['a backend', cfg, SCAFFOLD, /only for "adapter": "playwright" or "fullstack"/],
  ]) {
    const d = repo({})
    prep(d)
    const r = write(d, c, { scaffold: s })
    assert.equal(r.ok, false, label)
    assert.match(r.errors.join('\n'), re, label)
    assert.equal(existsSync(join(d, '.claude/quality-code.json')), false, label)
    assert.equal(existsSync(join(d, 'e2e')), false, label)
  }
  const d = repo({})
  writeFileSync(join(d, 'playwright.config.ts'), 'mine')
  write(d, pwCfg, { scaffold: SCAFFOLD })
  assert.equal(readFileSync(join(d, 'playwright.config.ts'), 'utf8'), 'mine')
})
test('a smoke test already there is kept; the CLI --write passes the proposal\'s scaffold', () => {
  const d = repo({})
  mkdirSync(join(d, 'e2e'))
  writeFileSync(join(d, SMOKE), 'mine')
  const r = cli(d, '--write', JSON.stringify({ config: pwCfg, scaffold: SCAFFOLD }))
  assert.deepEqual([r.status, r.stdout], [0, 'ok\n'])
  assert.ok(existsSync(join(d, 'playwright.config.js')))
  assert.equal(readFileSync(join(d, SMOKE), 'utf8'), 'mine')
})

const smokeRepo = () => { const d = repo({}); assert.equal(write(d, pwCfg, { scaffold: SCAFFOLD }).ok, true); return d }
const PASS = { file: SMOKE, title: 'the app opens', status: 'passed', message: '' }
const ran = (tests, broken = []) => async () => ({ ran: true, tests, broken })

test('smoke: ok, the app down, a file that does not load, the sign-in, no signed-in state, a red or skipped smoke test', async () => {
  const d = smokeRepo()
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([PASS]) }), { code: 0, line: 'ok: the app opens' })
  assert.deepEqual(await smoke(d, pwCfg, { run: async () => ({ ran: false, tests: [], error: 'Error: Process from config.webServer was not able to start. Exit code: 1' }) }),
    { code: 1, line: 'The app did not open: Process from config.webServer was not able to start. Exit code: 1' })
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([], [{ file: 'e2e/auth.setup.js', message: 'SyntaxError: Unexpected token' }]) }),
    { code: 1, line: 'e2e/auth.setup.js does not load: SyntaxError: Unexpected token' })
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([{ file: 'e2e/auth.setup.js', title: 'sign in', status: 'failed', message: 'Error: Set E2E_USERNAME and E2E_PASSWORD in .env.e2e' }, { ...PASS, status: 'skipped' }]) }),
    { code: 1, line: 'The sign-in failed (e2e/auth.setup.js): Set E2E_USERNAME and E2E_PASSWORD in .env.e2e' })
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([{ ...PASS, status: 'failed', message: 'Error reading storage state from playwright/.auth/user.json:' }]) }),
    { code: 1, line: 'The smoke test found no signed-in state: the sign-in (e2e/auth.setup.js) is missing, or it does not save playwright/.auth/user.json' })
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([{ ...PASS, status: 'failed', message: 'Error: the app should open past its sign-in page' }]) }),
    { code: 1, line: 'The smoke test failed: the app should open past its sign-in page' })
  assert.deepEqual(await smoke(d, pwCfg, { run: ran([{ ...PASS, status: 'skipped' }]) }), { code: 1, line: 'The smoke test did not run: check the projects in the Playwright config' })
})
test('smoke --if-first runs only while the smoke test is the only frontend spec; no smoke test, nothing to run', async () => {
  let n = 0
  const run = async () => { n++; return { ran: true, tests: [PASS], broken: [] } }
  const d = smokeRepo()
  assert.equal((await smoke(d, pwCfg, { ifFirst: true, run })).code, 0)
  assert.equal(n, 1)
  writeFileSync(join(d, 'e2e/orders.abc-1.spec.js'), '')
  assert.deepEqual(await smoke(d, pwCfg, { ifFirst: true, run }), { code: 0, line: 'skip: the e2e folder has other specs' })
  assert.equal(n, 1)
  assert.equal((await smoke(d, pwCfg, { run })).code, 0, 'without --if-first it runs')
  assert.equal(n, 2)
  assert.deepEqual(await smoke(repo({}), pwCfg, { run }), { code: 0, line: 'skip: no smoke test in the e2e folder' })
  assert.equal((await smoke(repo({}), cfg, { run })).code, 2, 'a backend project has no e2e folder')
})
test('CLI --smoke runs the project\'s Playwright on the smoke test: exit 0, or 1 with the reason; 2 without a config', () => {
  const d = smokeRepo()
  const report = status => ({ config: { rootDir: d }, errors: [], suites: [{ title: 'smoke.spec.js', file: SMOKE, specs: [{ title: 'the app opens', file: SMOKE, tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: status === 'passed' ? 'expected' : 'unexpected', results: [{ status, error: status === 'failed' ? { message: 'Error: the app should open past its sign-in page' } : undefined }] }] }], suites: [] }] })
  fakeBin(d, 'playwright', { report: report('passed') })
  let r = cli(d, '--smoke')
  assert.deepEqual([r.status, r.stdout], [0, 'ok: the app opens\n'])
  assert.deepEqual(calls(d, 'playwright')[0].slice(0, 2), ['test', filePattern(SMOKE)])
  fakeBin(d, 'playwright', { report: report('failed') })
  r = cli(d, '--smoke', '--if-first')
  assert.deepEqual([r.status, r.stdout], [1, 'The smoke test failed: the app should open past its sign-in page\n'])
  assert.equal(cli(d, '--smoke', '--nope').status, 2)
  const bare = repo({})
  const none = spawnSync(process.execPath, [SETUP, '--smoke'], { cwd: bare, env: { ...process.env, CLAUDE_PROJECT_DIR: bare, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'at-')) }, encoding: 'utf8' })
  assert.equal(none.status, 2)
  assert.match(none.stdout, /not set up/)
})

test('detect: a frontend with Vitest and a script that serves it gets a scaffold; a UI library tested with Vitest alone does not', () => {
  const app = repo({ scripts: { dev: 'vite', test: 'vitest run' }, dependencies: { react: '19' }, devDependencies: { vitest: '3' } })
  assert.equal(detect(app).adapter, 'vitest')
  assert.deepEqual([detect(app).scaffold.install, detect(app).scaffold.url], ['npm install --save-dev @playwright/test', 'http://localhost:5173'])
  assert.equal(detect(repo({ scripts: { build: 'vite build', test: 'vitest run' }, peerDependencies: { react: '19' }, devDependencies: { vitest: '3', react: '19' } })).scaffold, null, 'a UI library')
  assert.equal(detect(repo({ scripts: { dev: 'tsx watch src/server.ts' }, devDependencies: { vitest: '3' } })).scaffold, null, 'a backend with Vitest')
})

test('unitOverlap (Vitest): the e2e specs the project\'s own Vitest lists, from its realpath; errors when it cannot list them', () => {
  const d = repo({})
  const real = realpathSync(d)
  const list = files => JSON.stringify(files.map(f => ({ file: join(real, f) })))
  fakeBin(d, 'vitest', { stdout: `some log line\n${list(['src/sum.test.ts', 'e2e/smoke.spec.ts', 'e2e/smoke.spec.ts', 'e2e/a/b.spec.ts', 'e2e-other/x.spec.ts'])}` })
  assert.deepEqual(unitOverlap(d, 'e2e/'), { files: ['e2e/a/b.spec.ts', 'e2e/smoke.spec.ts'] })
  assert.deepEqual(calls(d, 'vitest')[0], ['list', '--filesOnly', '--json'])
  fakeBin(d, 'vitest', { stdout: list(['src/sum.test.ts']), exit: 1 })
  assert.deepEqual(unitOverlap(d, 'e2e/'), { files: [] }, 'a non-zero exit still lists')
  fakeBin(d, 'vitest', { stdout: 'Error: cannot load config' })
  assert.deepEqual(unitOverlap(d, 'e2e/'), { error: 'Vitest could not list its test files' })
  assert.match(unitOverlap(repo({}), 'e2e/').error, /Vitest is not installed/)
})
test('CLI --unit-overlap (Vitest): exit 0 when Vitest leaves the e2e folder alone, 1 with the specs it would run, 2 when it cannot tell', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, adapter: 'fullstack' }, { scaffold: SCAFFOLD }).ok, true)
  const real = realpathSync(d)
  fakeBin(d, 'vitest', { stdout: JSON.stringify([{ file: join(real, 'src/sum.test.js') }, { file: join(real, SMOKE) }]) })
  let r = cli(d, '--unit-overlap')
  assert.deepEqual([r.status, r.stdout], [1, `Vitest also runs 1 spec(s) in e2e/, and fails on them:\n  ${SMOKE}\n`])
  fakeBin(d, 'vitest', { stdout: JSON.stringify([{ file: join(real, 'src/sum.test.js') }]) })
  r = cli(d, '--unit-overlap')
  assert.deepEqual([r.status, r.stdout], [0, 'ok: Vitest runs none of the specs in e2e/\n'])
  fakeBin(d, 'vitest', { stdout: 'nope' })
  assert.equal(cli(d, '--unit-overlap').status, 2)
  assert.equal(cli(d, '--unit-overlap', 'x').status, 2, 'takes no argument')
})

// Another runner: the repo keeps its own, and the config names it.
test('detect: Jest, Mocha and Cypress are the repo\'s own runners, named in runners; Vitest and Playwright are the default', () => {
  const r = deps => { const x = detect(repo({ devDependencies: deps })); return [x.adapter, x.runners] }
  assert.deepEqual(r({ jest: '30' }), ['vitest', { unit: 'jest' }])
  assert.deepEqual(r({ mocha: '12', chai: '5' }), ['vitest', { unit: 'mocha' }])
  assert.deepEqual(r({ cypress: '16' }), ['playwright', { e2e: 'cypress' }])
  assert.deepEqual(r({ jest: '30', cypress: '16' }), ['both', { unit: 'jest', e2e: 'cypress' }])
  assert.deepEqual(r({ vitest: '3', jest: '30', '@playwright/test': '1' }), ['both', {}], 'Vitest and Playwright win')
  assert.deepEqual(r({}), [null, {}])
})
test('detect: a non-JavaScript backend with Cypress names only the e2e runner; Jest beside pytest makes the JavaScript side the backend', () => {
  const d = (pkg, files) => { const x = repo(pkg); for (const [p, t] of Object.entries(files)) writeFileSync(join(x, p), t); return x }
  const pyCy = detect(d({ devDependencies: { cypress: '16' } }, { 'pytest.ini': '' }))
  assert.deepEqual([pyCy.adapter, pyCy.backend, pyCy.runners], ['both', 'pytest', { e2e: 'cypress' }])
  const jestPy = detect(d({ devDependencies: { jest: '30' } }, { 'pytest.ini': '' }))
  assert.deepEqual([jestPy.adapter, jestPy.backend, jestPy.backends, jestPy.runners], ['vitest', 'vitest', ['vitest', 'pytest'], { unit: 'jest' }])
})
test('detect: a frontend that runs Cypress keeps it, so setup offers no Playwright; a Jest frontend is offered it next to Jest', () => {
  assert.equal(detect(repo({ scripts: { dev: 'vite' }, dependencies: { react: '19' }, devDependencies: { cypress: '16' } })).scaffold, null)
  assert.equal(detect(repo({ scripts: { dev: 'vite' }, dependencies: { react: '19' }, devDependencies: { jest: '30' } })).scaffold.install, 'npm install --save-dev @playwright/test')
})
test('write refuses a Playwright scaffold in a project whose e2e runner is Cypress', () => {
  const d = repo({})
  const r = write(d, { ...cfg, adapter: 'playwright', runners: { e2e: 'cypress' } }, { scaffold: SCAFFOLD })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /sets up Playwright, and this project's e2e runner is cypress/)
})
test('unitOverlap (Jest): the e2e specs Jest lists; Mocha is taken to leave the e2e folder alone', () => {
  const d = repo({})
  const real = realpathSync(d)
  fakeBin(d, 'jest', { stdout: JSON.stringify([join(real, 'src/a.test.js'), join(real, 'e2e/smoke.spec.js')]) })
  assert.deepEqual(unitOverlap(d, 'e2e/', 'jest'), { files: ['e2e/smoke.spec.js'] })
  assert.deepEqual(calls(d, 'jest')[0], ['--listTests', '--json'])
  assert.deepEqual(unitOverlap(d, 'e2e/', 'mocha'), { files: [] })
  assert.equal(write(d, { ...cfg, adapter: 'fullstack', runners: { unit: 'jest' } }, { scaffold: SCAFFOLD }).ok, true)
  const r = cli(d, '--unit-overlap')
  assert.deepEqual([r.status, r.stdout], [1, 'Jest also runs 1 spec(s) in e2e/, and fails on them:\n  e2e/smoke.spec.js\n'])
})
test('detect: a script that runs node --test names Node\'s own runner; a runner in the dependencies wins', () => {
  assert.deepEqual([detect(repo({ scripts: { test: 'node --test' } })).adapter, detect(repo({ scripts: { test: 'node --test' } })).runners], ['vitest', { unit: 'node' }])
  assert.deepEqual(detect(repo({ scripts: { test: 'npm run build && node --import tsx --test src/' } })).runners, { unit: 'node' })
  assert.deepEqual(detect(repo({ scripts: { test: 'node --test' }, devDependencies: { jest: '30' } })).runners, { unit: 'jest' })
  assert.deepEqual(detect(repo({ scripts: { start: 'node server.js', lint: 'eslint --test-mode' } })).runners, {}, 'no node --test')
})
