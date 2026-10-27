// The config at the repository's top names the project's folder (an app in web/), and every script,
// the boundary hook and setup work in that folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configHome, findRoot, loadConfig, projectRoot } from '../lib/base/config.mjs'
import { detect, write } from '../bin/setup.mjs'
import { ENV } from './git-env.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../bin')
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null } }
const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
// Claude Code starts at the top: CLAUDE_PROJECT_DIR and the working folder are both the top.
const cli = (top, script, args, input) => spawnSync(process.execPath, [join(BIN, script), ...args], { cwd: top, env: { ...ENV, CLAUDE_PROJECT_DIR: top, QC_NO_AUDIT: '1' }, encoding: 'utf8', input })

/** A git repo with the app in web/ and the config at the top naming it. */
function sub(config = { ...CFG, root: 'web' }) {
  const top = mkdtempSync(join(tmpdir(), 'qc-sub-'))
  put(top, '.claude/quality-code.json', JSON.stringify(config))
  put(top, 'README.md')
  put(top, 'web/package.json', JSON.stringify({ devDependencies: { vitest: '3' } }))
  put(top, 'web/src/app.ts', 'export const a = 1\n')
  put(top, 'web/test/a.spec.ts', "it('a', () => { expect(1).toBe(1) })\n")
  const g = (...a) => execFileSync('git', a, { cwd: top, env: ENV })
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'i')
  return top
}

test('scripts work from the repository root: they read web/package.json and take paths in web/', () => {
  const top = sub()
  const app = join(top, 'web')
  assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: top }, top), app)
  assert.equal(projectRoot({}, top), app, 'no CLAUDE_PROJECT_DIR: found up from the working folder')
  assert.equal(findRoot(join(app, 'src')), app)
  assert.equal(configHome(app), top)
  assert.equal(loadConfig(app).path, join(top, '.claude/quality-code.json'))
  assert.equal(loadConfig(app).config.root, 'web')

  // ticket-eval's first call: Vitest is in web/package.json (not installed), so that is the package.json read.
  const check = cli(top, 'ticket.mjs', ['config', 'check', '--runner'])
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /^ok \(repo: .*\.claude\/quality-code\.json\)\ntickets folder: .*\nmissing: Vitest is in package.json but not installed/)

  // check: a spec path is web's, and run start marks a run there.
  assert.equal(cli(top, 'checks.mjs', ['honesty', 'test/a.spec.ts']).status, 0)
  assert.match(cli(top, 'checks.mjs', ['honesty', 'web/test/a.spec.ts']).stderr, /spec not found/)
  assert.equal(cli(top, 'checks.mjs', ['run', 'start', '--key', 'ABC-1']).status, 0)
  assert.ok(existsSync(join(app, '.claude/quality-code/run.active')))
  assert.ok(!existsSync(join(top, '.claude/quality-code/run.active')))
})

test('the boundary hook protects the subfolder\'s code, and the config and settings at the top', () => {
  const top = sub()
  assert.equal(cli(top, 'checks.mjs', ['run', 'start', '--key', 'ABC-1']).status, 0)
  const hook = file => {
    const r = cli(top, 'checks.mjs', ['boundary', '--hook'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(top, file) } }))
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow'
  }
  assert.equal(hook('web/src/app.ts'), 'deny')
  assert.equal(hook('web/package.json'), 'deny')
  assert.equal(hook('.claude/quality-code.json'), 'deny', 'the run cannot rewrite the config it is judged by')
  assert.equal(hook('.claude/settings.json'), 'deny', 'nor switch its hook off')
  assert.equal(hook('web/test/b.spec.ts'), 'allow')
  assert.equal(hook('README.md'), 'allow', 'outside the project, as any file outside it')
  const log = readFileSync(join(top, 'web/.claude/quality-code/boundary.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).path)
  assert.deepEqual(log, ['src/app.ts', 'package.json', '.claude/quality-code.json', '.claude/settings.json'])
})

test('setup proposes the subfolder with a package.json, a test tool first, and writes the config at the top', () => {
  const top = mkdtempSync(join(tmpdir(), 'qc-sub-'))
  put(top, 'docs/package.json', '{}')
  put(top, 'web/package.json', JSON.stringify({ devDependencies: { vitest: '3' } }))
  put(top, 'web/src/app.ts')
  const d = detect(top)
  assert.deepEqual(d.root, { proposed: 'web', candidates: ['web', 'docs'] })
  assert.equal(d.adapter, 'vitest', 'read from web/package.json')
  assert.deepEqual(d.boundaries, ['src/'], 'paths from the project root')
  assert.equal(detect(top, process.env, 'docs').root.proposed, 'docs', 'the user picked another folder')
  assert.equal(detect(top, process.env, '.').root.proposed, null, 'the user picked the top')

  assert.deepEqual(write(top, { ...CFG, root: 'nope' }).errors, ['root "nope" is not a folder of this repository'])
  assert.equal(write(top, { ...CFG, root: 'web' }).ok, true)
  assert.equal(JSON.parse(readFileSync(join(top, '.claude/quality-code.json'), 'utf8')).root, 'web')
  assert.ok(!existsSync(join(top, 'web/.claude/quality-code.json')))
  assert.match(readFileSync(join(top, 'web/.gitignore'), 'utf8'), /^\.quality-code\/tickets\/\*\/raw\.json$/m, 'the git-ignored paths are the project\'s')
  assert.equal(detect(top).root.proposed, 'web', 'a rerun keeps the root')

  // The top is a project of its own: nothing is proposed.
  put(top, 'package.json', '{}')
  writeFileSync(join(top, '.claude/quality-code.json'), JSON.stringify(CFG))
  assert.equal(detect(top).root.proposed, null)
  const py = mkdtempSync(join(tmpdir(), 'qc-sub-'))
  put(py, 'pytest.ini', '')
  put(py, 'web/package.json', '{}')
  assert.equal(detect(py).root.proposed, null, 'a Python backend at the top with a frontend below')

  const bad = cli(top, 'setup.mjs', ['--detect', '--root', '../x'])
  assert.equal(bad.status, 2)
  assert.match(bad.stdout, /--root "\.\.\/x"/)
  assert.equal(cli(top, 'setup.mjs', ['--detect', '--root', 'missing']).status, 2)
  assert.match(cli(top, 'setup.mjs', ['--detect', '--root', 'web']).stdout, /^SETUP_JSON:.*"root":\{"proposed":"web"/)
})

test('a root outside the repository is refused, and the check names the root field', () => {
  for (const root of ['../other', '/abs', 'a/../../b', '']) {
    const top = sub({ ...CFG, root })
    const r = cli(top, 'ticket.mjs', ['config', 'check'])
    assert.equal(r.status, 2, root)
    assert.match(r.stdout, /^root ".*" must be a folder inside the repository/m, root)
    assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: top }, top), top, 'a bad root never moves the project')
  }
})
