// /quality-code:clean: the list per group, path safety, git-tracked warning, dry run, .gitignore lines, command text, wiring.
// Temp directories only: the Claude folder (CLAUDE_CONFIG_DIR) is a temp one too, never the real home.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { main } from '../../bin/clean.mjs'
import { buildList, runClean, unsafeReason } from '../../lib/base/clean.mjs'
import { playwrightConfigText, SMOKE_TEXT, RUNTIME_GITIGNORE } from '../../bin/setup.mjs'
import { dirOf, short, slug } from '../../lib/base/progress.mjs'
import { ENV as GIT_ENV } from '../git-env.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const CFG = { version: 1, adapter: 'playwright', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
const put = (root, rel, body = 'x\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body) }
const git = (root, ...a) => execFileSync('git', a, { cwd: root, env: GIT_ENV, stdio: 'ignore' })

/** A project that was set up: config, scaffold, .gitignore lines, saved output, cache, personal config, one spec. */
function project({ extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-root-')))
  const claude = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-claude-')))
  const env = { CLAUDE_CONFIG_DIR: claude, CLAUDE_PROJECT_DIR: root, QUALITY_CODE_PLACE: 'repo' }
  put(root, '.claude/quality-code.json', JSON.stringify({ ...CFG, ...extra }))
  put(root, 'playwright.config.ts', playwrightConfigText({ command: 'npm run dev', url: 'http://localhost:5173', signIn: false }))
  put(root, 'e2e/smoke.spec.ts', SMOKE_TEXT)
  put(root, '.gitignore', ['node_modules/', '.quality-code/tickets/*/raw.json', '.claude/quality-code/jira-fields.json', ...RUNTIME_GITIGNORE, 'test-results/', 'playwright-report/', 'dist/'].join('\n') + '\n')
  put(root, '.quality-code/tickets/ABC-1/ticket.json', '{}')
  put(root, '.claude/quality-code/audit/gate.jsonl', '{}\n')
  put(root, '.claude/quality-code/evals/ABC-1/expected.json', '{}')
  put(root, 'e2e/orders.abc-1.spec.ts', "test.describe('ABC-1 totals', { tag: '@ABC-1' }, () => {})\n")
  put(root, 'e2e/mine.spec.ts', "test('mine', () => {})\n")
  put(root, 'src/app.ts', 'export {}\n')
  const cache = join(dirOf(env), `${slug(root)}-${short(root)}`)
  mkdirSync(cache, { recursive: true })
  writeFileSync(join(cache, 'setup.json'), '{}')
  writeFileSync(join(claude, 'quality-code.json'), JSON.stringify(CFG))
  return { root, claude, env, cache }
}
const group = (l, id) => l.groups.find(g => g.id === id)
const rels = (l, id) => group(l, id).items.map(i => i.rel).sort()

test('the list: setup files, saved output, cache, personal config and specs each in their own group', () => {
  const { root, env, cache, claude } = project()
  const l = buildList(root, env)
  assert.deepEqual(rels(l, 'setup'), ['.claude/quality-code.json', '.gitignore', 'e2e/smoke.spec.ts', 'playwright.config.ts'])
  assert.deepEqual(rels(l, 'output'), ['.claude/quality-code', '.quality-code'])
  assert.deepEqual(group(l, 'cache').items.map(i => i.abs), [cache])
  assert.deepEqual(group(l, 'personal').items.map(i => i.abs), [join(claude, 'quality-code.json')])
  assert.deepEqual(rels(l, 'specs'), ['e2e/orders.abc-1.spec.ts'])
  const all = l.groups.flatMap(g => g.items.map(i => i.rel))
  assert.ok(!all.includes('src/app.ts') && !all.includes('e2e/mine.spec.ts'), 'the person\'s own files are never listed')
})
test('setup files are listed only while they are still what setup wrote', () => {
  const { root, env } = project()
  writeFileSync(join(root, 'playwright.config.ts'), playwrightConfigText({ command: 'npm run dev', url: 'http://localhost:5173', signIn: false }) + '// mine\n')
  writeFileSync(join(root, 'e2e/smoke.spec.ts'), SMOKE_TEXT.replace('the app opens', 'my own name'))
  const l = buildList(root, env)
  assert.deepEqual(rels(l, 'setup'), ['.claude/quality-code.json', '.gitignore'])
  // Without the Playwright file, the generic Playwright ignore lines are not setup's to remove.
  assert.ok(!group(l, 'setup').items.find(i => i.kind === 'lines').lines.includes('test-results/'))
})
test('a template is setup-added only when it is exactly the plugin\'s own', () => {
  const { root, env } = project({ extra: { ticketTemplates: { bug: '.github/ISSUE_TEMPLATE/bug.md', story: '.github/ISSUE_TEMPLATE/story.md' } } })
  put(root, '.github/ISSUE_TEMPLATE/bug.md', read('templates/bug.md'))
  put(root, '.github/ISSUE_TEMPLATE/story.md', 'the team wrote this one\n')
  assert.ok(rels(buildList(root, env), 'setup').includes('.github/ISSUE_TEMPLATE/bug.md'))
  assert.ok(!rels(buildList(root, env), 'setup').includes('.github/ISSUE_TEMPLATE/story.md'))
})
test('.gitignore: only the exact lines setup added go; the person\'s own lines stay', () => {
  const { root, env } = project()
  put(root, '.gitignore', ['node_modules/', '.quality-code/tickets/*/raw.json', ' .claude/quality-code/audit/ ', 'dist/', '.quality-code/tickets/mine.json', 'test-results/', ''].join('\n'))
  const r = runClean(root, { groups: ['setup'] }, env)
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.quality-code/tickets/mine.json\n')
  assert.ok(!existsSync(join(root, '.claude/quality-code.json')) && !existsSync(join(root, 'playwright.config.ts')) && !existsSync(join(root, 'e2e/smoke.spec.ts')))
  assert.ok(existsSync(join(root, 'src/app.ts')))
})
test('a .gitignore that only held setup\'s lines goes away when git does not track it', () => {
  const { root, env } = project()
  put(root, '.gitignore', ['.quality-code/tickets/*/raw.json', ...RUNTIME_GITIGNORE, ''].join('\n'))
  runClean(root, { groups: ['setup'] }, env)
  assert.ok(!existsSync(join(root, '.gitignore')))
})
test('deleting the picked groups only: output, cache and personal config; the rest stays', () => {
  const { root, env, cache, claude } = project()
  const r = runClean(root, { groups: ['output', 'cache'] }, env)
  assert.equal(r.ok, true)
  assert.ok(!existsSync(join(root, '.quality-code')) && !existsSync(join(root, '.claude/quality-code')) && !existsSync(cache))
  assert.ok(existsSync(join(root, '.claude/quality-code.json')) && existsSync(join(claude, 'quality-code.json')))
  assert.ok(existsSync(join(root, 'e2e/orders.abc-1.spec.ts')) && existsSync(join(root, 'src/app.ts')))
  runClean(root, { groups: ['personal'] }, env)
  assert.ok(!existsSync(join(claude, 'quality-code.json')))
})
test('specs are kept by default and deleted only when picked, only the picked ones', () => {
  const { root, env } = project()
  put(root, 'e2e/other.def-2.spec.ts', "test('x', { tag: '@DEF-2' }, () => {})\n")
  runClean(root, { groups: ['output', 'cache', 'personal'] }, env)
  assert.ok(existsSync(join(root, 'e2e/orders.abc-1.spec.ts')))
  assert.equal(runClean(root, { groups: ['specs'], specs: [] }, env).ok, false, 'the spec group needs the paths')
  assert.equal(runClean(root, { groups: ['specs'], specs: ['e2e/mine.spec.ts'] }, env).ok, false, 'a file that is not on the list is refused')
  assert.ok(existsSync(join(root, 'e2e/mine.spec.ts')))
  runClean(root, { groups: ['specs'], specs: ['e2e/other.def-2.spec.ts'] }, env)
  assert.ok(!existsSync(join(root, 'e2e/other.def-2.spec.ts')) && existsSync(join(root, 'e2e/orders.abc-1.spec.ts')))
  runClean(root, { groups: ['specs'], specs: 'all' }, env)
  assert.ok(!existsSync(join(root, 'e2e/orders.abc-1.spec.ts')) && existsSync(join(root, 'e2e/mine.spec.ts')))
})
test('a custom tickets folder: only the ticket folders the plugin wrote go, never the rest of the folder', () => {
  const { root, env } = project({ extra: { ticketsDir: 'e2e/tickets' } })
  put(root, 'e2e/tickets/ABC-9/case.csv')
  put(root, 'e2e/tickets/sprint/2026-01-01-goal.md')
  put(root, 'e2e/tickets/notes.txt', 'mine')
  put(root, 'e2e/tickets/README.md', 'mine')
  assert.deepEqual(rels(buildList(root, env), 'output'), ['.claude/quality-code', '.quality-code', 'e2e/tickets/ABC-9', 'e2e/tickets/sprint'])
  runClean(root, { groups: ['output'] }, env)
  assert.ok(!existsSync(join(root, 'e2e/tickets/ABC-9')) && !existsSync(join(root, 'e2e/tickets/sprint')))
  assert.ok(existsSync(join(root, 'e2e/tickets/notes.txt')) && existsSync(join(root, 'e2e/tickets/README.md')))
})
test('a tickets folder that is the project or a source folder is refused or never emptied', () => {
  for (const dir of ['.', 'src']) {
    const { root, env } = project({ extra: { ticketsDir: dir } })
    runClean(root, { groups: ['output'] }, env)
    assert.ok(existsSync(join(root, 'src/app.ts')), dir)
    assert.ok(existsSync(join(root, '.claude/quality-code.json')), dir)
  }
})

test('path safety: ".." outside the project, .git, the project itself and links are refused', () => {
  const { root } = project()
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-out-')))
  writeFileSync(join(out, 'precious.txt'), 'keep')
  assert.match(unsafeReason(root, join(root, '..', 'x')), /outside|\.\./)
  assert.match(unsafeReason(root, join(root, 'a/../../x'), { raw: 'a/../../x' }), /\.\./)
  assert.match(unsafeReason(root, out), /outside/)
  assert.match(unsafeReason(root, join(root, '.git/config')), /\.git/)
  assert.match(unsafeReason(root, root), /project folder itself/)
  symlinkSync(out, join(root, 'linked'))
  assert.match(unsafeReason(root, join(root, 'linked/precious.txt')), /link on the way/)
  assert.match(unsafeReason(root, join(root, 'linked')), /leads outside/)
  assert.equal(unsafeReason(root, join(root, 'src/app.ts')), null)
})
test('a symlinked output folder that leads out is kept, and what it points at survives', () => {
  const { root, env } = project()
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-out-')))
  writeFileSync(join(out, 'precious.txt'), 'keep')
  mkdirSync(join(root, '.quality-code'), { recursive: true })
  rmDir(join(root, '.quality-code'))
  symlinkSync(out, join(root, '.quality-code'))
  const r = runClean(root, { groups: ['output'] }, env)
  assert.ok(existsSync(join(out, 'precious.txt')))
  assert.ok(r.kept.some(k => k.rel === '.quality-code' && /leads outside/.test(k.why)))
})
test('a link inside a deleted folder is removed as a link, never followed', () => {
  const { root, env } = project()
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-out-')))
  writeFileSync(join(out, 'precious.txt'), 'keep')
  symlinkSync(out, join(root, '.quality-code/tickets/escape'))
  runClean(root, { groups: ['output'] }, env)
  assert.ok(!existsSync(join(root, '.quality-code')))
  assert.ok(existsSync(join(out, 'precious.txt')))
})
test('a tickets folder outside the project, and a cache or personal path that is not the known one, are not deleted', () => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-out-')))
  writeFileSync(join(out, 'precious.txt'), 'keep')
  const { root, env, claude } = project()
  // A personal setup may name any absolute tickets folder; it is outside the project, so it is listed as kept.
  rmDir(join(root, '.claude/quality-code.json'))
  writeFileSync(join(claude, 'quality-code.json'), JSON.stringify({ ...CFG, ticketsDir: out }))
  const r = runClean(root, { groups: ['setup', 'output', 'cache', 'personal'] }, { ...env, QUALITY_CODE_PLACE: 'local' })
  assert.ok(existsSync(join(out, 'precious.txt')))
  assert.ok(r.kept.some(k => k.rel === out && /outside the project/.test(k.why)))
  // The cache is this project's folder only: a sibling project's cache stays.
  const sibling = join(dirOf(env), 'other-project-12345678')
  mkdirSync(sibling, { recursive: true })
  writeFileSync(join(sibling, 'setup.json'), '{}')
  runClean(root, { groups: ['cache'] }, env)
  assert.ok(existsSync(join(sibling, 'setup.json')))
})
test('the "this machine" place: its folder for this project is deleted, others stay', () => {
  const { root, env, claude } = project()
  const home = join(claude, 'quality-code', 'projects', `${slug(root)}-${short(root)}`)
  const other = join(claude, 'quality-code', 'projects', 'other-00000000')
  for (const d of [home, other]) { mkdirSync(join(d, 'tickets'), { recursive: true }); writeFileSync(join(d, 'tickets/x'), 'x') }
  writeFileSync(join(claude, 'quality-code', 'save.json'), '{}')
  const e2 = { ...env, QUALITY_CODE_PLACE: 'local' }
  runClean(root, { groups: ['output'] }, e2)
  assert.ok(!existsSync(home) && existsSync(other) && existsSync(join(claude, 'quality-code', 'save.json')))
})
test('the project is the home folder: the personal config and the plugin\'s folder of every project are never setup or output', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-home-')))
  const env = { CLAUDE_CONFIG_DIR: join(root, '.claude'), CLAUDE_PROJECT_DIR: root, QUALITY_CODE_PLACE: 'repo' }
  put(root, '.claude/quality-code.json', JSON.stringify(CFG))
  put(root, '.claude/quality-code/save.json', '{}')
  put(root, '.claude/quality-code/projects/other-00000000/config.json', '{}')
  put(root, '.quality-code/tickets/ABC-1/ticket.json', '{}')
  const l = buildList(root, env)
  assert.ok(!rels(l, 'setup').includes('.claude/quality-code.json') && !rels(l, 'output').includes('.claude/quality-code'))
  runClean(root, { groups: ['setup', 'output'] }, env)
  for (const p of ['.claude/quality-code.json', '.claude/quality-code/save.json', '.claude/quality-code/projects/other-00000000/config.json']) assert.ok(existsSync(join(root, p)), p)
  assert.ok(!existsSync(join(root, '.quality-code/tickets')))
})
test('the "this machine" place with the config there: output takes the tickets, the config is setup\'s', () => {
  const { root, env, claude } = project()
  const e2 = { ...env, QUALITY_CODE_PLACE: 'local' }
  const home = join(claude, 'quality-code', 'projects', `${slug(root)}-${short(root)}`)
  rmDir(join(root, '.claude/quality-code.json'))
  put(home, 'config.json', JSON.stringify(CFG))
  put(home, 'tickets/ABC-1/ticket.json', '{}')
  runClean(root, { groups: ['output'] }, e2)
  assert.ok(existsSync(join(home, 'config.json')) && !existsSync(join(home, 'tickets')))
  runClean(root, { groups: ['setup'] }, e2)
  assert.ok(!existsSync(home))
})
test('a custom tickets folder: the person\'s own stories, sprint notes and CSVs stay', () => {
  const { root, env } = project({ extra: { ticketsDir: 'docs', xray: { csv: 'docs/cases.csv' } } })
  for (const p of ['docs/stories/login.md', 'docs/sprint/retro.md', 'docs/sprint/2026-01-01-goal.md', 'docs/testcases-plan.csv', 'docs/xray-notes.xlsx', 'docs/cases.csv']) put(root, p)
  assert.deepEqual(rels(buildList(root, env), 'output'), ['.claude/quality-code', '.quality-code', 'docs/cases.csv', 'docs/sprint/2026-01-01-goal.md'])
})

test('tracked files are flagged and listed; the history is not touched', () => {
  const { root, env } = project()
  git(root, 'init', '-q')
  git(root, 'add', '.claude/quality-code.json', '.gitignore', '.claude/quality-code/evals/ABC-1/expected.json', 'src/app.ts')
  git(root, 'commit', '-qm', 'init')
  const l = buildList(root, env)
  assert.equal(l.git, true)
  assert.deepEqual(group(l, 'setup').items.find(i => i.rel === '.claude/quality-code.json').tracked, ['.claude/quality-code.json'])
  assert.deepEqual(group(l, 'output').items.find(i => i.rel === '.claude/quality-code').tracked, ['.claude/quality-code/evals/ABC-1/expected.json'])
  assert.deepEqual(group(l, 'setup').items.find(i => i.rel === 'e2e/smoke.spec.ts').tracked, [])
  assert.deepEqual(group(l, 'cache').items[0].tracked, [])
  let text = ''
  return main(['list'], { env, cwd: root, stdout: s => { text += s } }).then(code => {
    assert.equal(code, 0)
    assert.match(text, /TRACKED BY GIT: 3 files/)
    assert.match(text, /git status/)
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    runClean(root, { groups: ['setup', 'output'] }, env)
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), head)
    assert.ok(existsSync(join(root, '.git/HEAD')))
    execFileSync('git', ['checkout', '--', '.claude/quality-code.json'], { cwd: root, env: GIT_ENV })
    assert.ok(existsSync(join(root, '.claude/quality-code.json')), 'a deleted tracked file comes back from git')
  })
})

test('the script: --dry-run lists and deletes nothing', async () => {
  const { root, env } = project()
  let text = ''
  const code = await main(['delete', '--groups', 'setup,output,cache,personal', '--dry-run'], { env, cwd: root, stdout: s => { text += s } })
  assert.equal(code, 0)
  assert.match(text, /DRY RUN: would delete/)
  assert.match(text, /\.quality-code\//)
  for (const p of ['.claude/quality-code.json', 'playwright.config.ts', '.quality-code/tickets/ABC-1/ticket.json']) assert.ok(existsSync(join(root, p)), p)
  assert.ok(existsSync(join(env.CLAUDE_CONFIG_DIR, 'quality-code.json')))
  assert.equal(await main(['list', '--dry-run'], { env, cwd: root, stdout: () => {} }), 0)
  assert.ok(existsSync(join(root, '.quality-code')))
})
test('the script never skips the question: --yes, --ci and friends are refused, and a delete needs --confirmed', async () => {
  const { root, env } = project()
  for (const flag of ['--yes', '-y', '--ci', '--force', '--no-confirm']) {
    let err = ''
    assert.equal(await main(['delete', '--groups', 'output', '--confirmed', flag], { env, cwd: root, stderr: s => { err += s } }), 2, flag)
    assert.match(err, /never skips the question/)
    assert.equal(await main(['list', flag], { env, cwd: root, stderr: () => {} }), 2, flag)
  }
  let err = ''
  assert.equal(await main(['delete', '--groups', 'output'], { env, cwd: root, stderr: s => { err += s } }), 2)
  assert.match(err, /--confirmed/)
  assert.equal(await main(['delete', '--confirmed'], { env, cwd: root, stderr: () => {} }), 2)
  assert.equal(await main(['delete', '--groups', 'src', '--confirmed'], { env, cwd: root, stderr: () => {} }), 2)
  assert.ok(existsSync(join(root, '.quality-code')) && existsSync(join(root, '.claude/quality-code.json')))
})
test('the script: delete with --confirmed removes the groups and prints Deleted and Kept', async () => {
  const { root, env } = project()
  let text = ''
  assert.equal(await main(['delete', '--groups', 'output,cache', '--confirmed'], { env, cwd: root, stdout: s => { text += s } }), 0)
  assert.match(text, /^Deleted/m)
  assert.match(text, /^Kept/m)
  assert.match(text, /Setup files not picked/)
  assert.ok(!existsSync(join(root, '.quality-code')))
})
test('nothing to clean: an empty list, no error', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-empty-')))
  const env = { CLAUDE_CONFIG_DIR: realpathSync(mkdtempSync(join(tmpdir(), 'qc-clean-claude-'))), CLAUDE_PROJECT_DIR: root }
  const l = buildList(root, env)
  assert.ok(l.groups.every(g => g.items.length === 0))
  assert.equal(runClean(root, { groups: GROUPS_ALL }, env).deleted.length, 0)
})

test('the command: asks the groups with a multiSelect picker, then one yes, and never skips with --yes or --ci', () => {
  const cmd = read('commands/clean.md')
  assert.match(cmd, /^---\ndescription: .+\nargument-hint: '?\[--dry-run\] \| --cache \[--all\] \[--yes\]'?\nmodel: sonnet\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/\*\)\n---\n/)
  assert.match(cmd, /AskUserQuestion picker/)
  assert.match(cmd, /`multiSelect` true/)
  assert.match(cmd, /page them as display\.md says/)
  assert.match(cmd, /One explicit yes, never skipped/)
  assert.match(cmd, /`--yes`, `--ci`, `-y`, `--force`/)
  assert.match(cmd, /The script refuses those flags too/)
  assert.match(cmd, /Only `clean\.mjs` deletes/)
  assert.match(cmd, /--confirmed` is passed only after the yes/)
  assert.match(cmd, /Run each plugin script exactly as written/)
  assert.ok(cmd.includes('${CLAUDE_PLUGIN_ROOT}/guides/display.md') && cmd.includes('${CLAUDE_PLUGIN_ROOT}/guides/language.md'))
  assert.doesNotMatch(cmd, /clean\.mjs"[^\n`]*--(yes|ci)\b[^\n`]*--confirmed/, 'no script call passes --yes or --ci')
  assert.doesNotMatch(cmd, /\brm -rf?\b/)
})
test('wiring: the README table and the MCP server README name the command', () => {
  assert.ok(read('README.md').includes('/quality-code:clean'))
  assert.ok(read('mcp-server/README.md').includes('quality_code_clean'))
})

const GROUPS_ALL = ['setup', 'output', 'cache', 'personal']
function rmDir(p) { execFileSync('rm', ['-r', p]) }
