import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../git-env.mjs'
import { main, registerCheck } from '../../bin/checks.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../bin/checks.mjs')
const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'qc-cli-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, '.claude/quality-code.json', JSON.stringify(CFG))
  put(d, 'test/a.spec.ts', "it('a', () => { expect(1).toBe(1) })\n")
  g('add', '-A'); g('commit', '-qm', 'i')
  return d
}
const cli = (d, args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8', input })
const json = r => JSON.parse(r.stdout)

test('honesty: pass exits 0, fail exits 1, --json prints only the result', () => {
  const d = repo()
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts']).status, 0)
  put(d, 'test/a.spec.ts', "it('a', () => {})\n")
  const r = cli(d, ['honesty', 'test/a.spec.ts', '--json'])
  assert.equal(r.status, 1)
  assert.equal(json(r).check, 'honesty')
  assert.equal(json(r).data.removedAssertions, 1)
})
test('human output ends with a CHECK_JSON line', () => {
  const d = repo()
  const r = cli(d, ['suite-honesty', 'test/a.spec.ts'])
  assert.equal(r.status, 0)
  const last = r.stdout.trim().split('\n').at(-1)
  assert.ok(last.startsWith('CHECK_JSON:'))
  assert.equal(JSON.parse(last.slice(11)).status, 'pass')
  assert.match(r.stdout, /^✅ suite-honesty: /)
})
test('not_run exits 3', () => {
  const d = repo()
  const r = cli(d, ['honesty', 'test/a.spec.ts', '--range', 'nope...HEAD', '--json'])
  assert.equal(r.status, 3)
  assert.equal(json(r).status, 'not_run')
})
test('usage and config errors exit 2', () => {
  const d = repo()
  assert.equal(cli(d, []).status, 2)
  assert.equal(cli(d, ['nope']).status, 2)
  assert.equal(cli(d, ['honesty']).status, 2)
  assert.equal(cli(d, ['honesty', 'missing.spec.ts']).status, 2)
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts', '--range', '--output=x']).status, 2)
  assert.equal(cli(d, ['suite-honesty', 'test/a.spec.ts', '--key', 'XYZ-1']).status, 2)
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts', '--what']).status, 2)
  const bare = mkdtempSync(join(tmpdir(), 'qc-cli-'))
  const r = cli(bare, ['honesty', 'x'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /quality-code:setup/)
})
test('flaky and mutation need a runner from the CLI', () => {
  const d = repo()
  for (const c of ['flaky', 'mutation']) {
    const r = cli(d, [c, 'test/a.spec.ts'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /needs the test runner: it runs in the pipeline, node bin\/pipeline\.mjs <spec…>/)
    assert.doesNotMatch(r.stderr, /coming in parts/)
  }
  assert.match(cli(d, ['flaky', 'test/a.spec.ts']).stderr, /--flaky N/)
})
test('hook: silent allow without a run or without a config; deny JSON and a log line during a run', () => {
  const d = repo()
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(d, 'src/a.ts') }, session_id: 's1' })
  let r = cli(d, ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  r = cli(mkdtempSync(join(tmpdir(), 'qc-cli-')), ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  put(d, '.claude/quality-code/run.active', '')
  r = cli(d, ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /src\/a\.ts is off limits during a test run/)
  const log = readFileSync(join(d, '.claude/quality-code/boundary.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual({ ...log[0], ts: 'x' }, { ts: 'x', decision: 'deny', tool: 'Edit', path: 'src/a.ts', session: 's1' })
  r = cli(d, ['boundary', '--hook'], '{not json')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})
test('hook: a file in a package with its own config is judged by that package, from a session at the monorepo root', () => {
  const top = mkdtempSync(join(tmpdir(), 'qc-mono-'))
  put(top, 'packages/api/.claude/quality-code.json', JSON.stringify(CFG))
  put(top, 'packages/api/.claude/quality-code/run.active', '')
  const r = cli(top, ['boundary', '--hook'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(top, 'packages/api/src/a.ts') } }))
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(cli(top, ['boundary', '--hook'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(top, 'packages/api/test/a.spec.ts') } })).stdout, '')
})
test('boundary diff mode from the CLI', () => {
  const d = repo()
  put(d, 'src/a.ts')
  const r = cli(d, ['boundary', '--json'])
  assert.equal(r.status, 1)
  assert.equal(json(r).findings[0].file, 'src/a.ts')
})
test('a crashing check exits 2 with crash message to stderr', async () => {
  const d = repo()
  registerCheck('boom', () => { throw new Error('kaput\nmore') }, 'none')
  let captured = ''
  const orig = process.stderr.write
  try {
    process.stderr.write = (s) => { captured += s; return true }
    const code = await main(['boom'], { ...process.env, CLAUDE_PROJECT_DIR: d }, d)
    assert.equal(code, 2)
    assert.match(captured, /check boom crashed: kaput/)
    assert.ok(!captured.includes('more'))
  } finally {
    process.stderr.write = orig
  }
})
test('a check that throws a non-Error still exits 2', async () => {
  const d = repo()
  registerCheck('boom2', () => { throw 'x' }, 'none')
  let captured = ''
  const orig = process.stderr.write
  try {
    process.stderr.write = (s) => { captured += s; return true }
    const code = await main(['boom2'], { ...process.env, CLAUDE_PROJECT_DIR: d }, d)
    assert.equal(code, 2)
    assert.match(captured, /check boom2 crashed: x/)
  } finally {
    process.stderr.write = orig
  }
})
test('hook: a bad config, a non-string path and null/number payloads all allow silently', () => {
  const d = repo()
  put(d, '.claude/quality-code/run.active', '')
  const deny = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(d, 'src/a.ts') } })
  const quiet = (input, why) => {
    const r = cli(d, ['boundary', '--hook'], input)
    assert.equal(r.status, 0, why)
    assert.equal(r.stdout, '', why)
  }
  quiet(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 5 } }), 'non-string file_path')
  quiet(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: { a: 1 } } }), 'object file_path')
  quiet('null', 'JSON null')
  quiet('5', 'JSON number')
  put(d, '.claude/quality-code.json', '{not json')
  quiet(deny, 'config is not JSON')
  put(d, '.claude/quality-code.json', JSON.stringify({ version: 1 }))
  quiet(deny, 'config fails validation')
})
