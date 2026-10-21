import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../git-env.mjs'
import { RUN_MARKER, runActive } from '../../lib/base/boundary.mjs'
import { gitHead, runStatus, startRun, statusLine, stopRun } from '../../lib/base/run.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../bin/checks.mjs')
const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], trackingProjects: ['TRK'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
const H = 3600 * 1000
const dir = () => mkdtempSync(join(tmpdir(), 'qc-run-'))
function repo({ commit = true } = {}) {
  const d = dir()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, '.claude/quality-code.json', JSON.stringify(CFG))
  if (commit) { g('add', '-A'); g('commit', '-qm', 'i') }
  return d
}
const head = d => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim()
const marker = d => JSON.parse(readFileSync(join(d, RUN_MARKER), 'utf8'))
const cli = (d, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

test('gitHead: the commit, or null outside git and before the first commit', () => {
  const d = repo()
  assert.equal(gitHead(d), head(d))
  assert.equal(gitHead(repo({ commit: false })), null)
  assert.equal(gitHead(dir()), null)
})
test('startRun writes { key, startedAt, base } and refuses while it is active', () => {
  const d = repo()
  const now = Date.parse('2026-10-14T08:00:00.000Z')
  const r = startRun(d, 'ABC-1', now)
  assert.deepEqual(r, { ok: true, marker: { key: 'ABC-1', startedAt: '2026-10-14T08:00:00.000Z', base: head(d), dirty: {} }, replacedStale: false })
  assert.deepEqual(marker(d), r.marker)
  assert.equal(runActive(d, now), true)
  assert.deepEqual(startRun(d, 'ABC-2', now + 11 * H), { ok: false, error: "a run for ABC-1 is active: finish it or run 'run stop'" })
  assert.equal(marker(d).key, 'ABC-1')
})
test('startRun replaces a marker older than 12 hours; base is null outside git', () => {
  const d = dir()
  const now = Date.now()
  put(d, RUN_MARKER, JSON.stringify({ key: 'ABC-1', startedAt: new Date(now - 12 * H).toISOString(), base: null }))
  const r = startRun(d, 'ABC-2', now)
  assert.equal(r.ok, true)
  assert.equal(r.replacedStale, true)
  assert.deepEqual(marker(d), { key: 'ABC-2', startedAt: new Date(now).toISOString(), base: null, dirty: null })
})
test('startRun: an unreadable marker counts by its mtime', () => {
  const d = dir()
  put(d, RUN_MARKER, '')
  assert.deepEqual(startRun(d, 'ABC-2'), { ok: false, error: "a run for an unknown key is active: finish it or run 'run stop'" })
  const old = new Date(Date.now() - 13 * H)
  utimesSync(join(d, RUN_MARKER), old, old)
  assert.equal(startRun(d, 'ABC-2').ok, true)
  assert.equal(marker(d).key, 'ABC-2')
})
test('stopRun is idempotent; runStatus and statusLine for none, active and stale', () => {
  const d = repo()
  const now = Date.parse('2026-10-14T08:00:00.000Z')
  assert.deepEqual(runStatus(d), { active: false, stale: false, marker: null })
  assert.equal(statusLine(runStatus(d)), 'no active run')
  startRun(d, 'ABC-1', now)
  const s = runStatus(d, now + H)
  assert.deepEqual(s, { active: true, stale: false, marker: marker(d), startedAt: '2026-10-14T08:00:00.000Z' })
  assert.equal(statusLine(s), `active run for ABC-1 since 2026-10-14T08:00:00.000Z, base ${head(d)}`)
  const st = runStatus(d, now + 12 * H)
  assert.equal(st.active, false)
  assert.equal(st.stale, true)
  assert.match(statusLine(st), /^stale run for ABC-1 since .*older than 12 hours/)
  assert.deepEqual(stopRun(d), { removed: true })
  assert.equal(existsSync(join(d, RUN_MARKER)), false)
  assert.deepEqual(stopRun(d), { removed: false })
})
test('CLI run start / status / stop with exit codes', () => {
  const d = repo()
  let r = cli(d, ['run', 'status'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'no active run\n')
  r = cli(d, ['run', 'start', '--key', 'ABC-7'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'run started for ABC-7\n')
  assert.equal(marker(d).key, 'ABC-7')
  assert.equal(marker(d).base, head(d))
  r = cli(d, ['run', 'start', '--key', 'TRK-2'])
  assert.equal(r.status, 1)
  assert.equal(r.stderr, "a run for ABC-7 is active: finish it or run 'run stop'\n")
  r = cli(d, ['run', 'status'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^active run for ABC-7 since /)
  r = cli(d, ['run', 'status', '--json'])
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).active, true)
  r = cli(d, ['run', 'stop'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'run stopped\n')
  r = cli(d, ['run', 'stop'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'no active run\n')
  assert.equal(cli(d, ['run', 'start', '--key', 'TRK-2']).status, 0)
})
test('CLI run: usage and key errors exit 2 and write no marker', () => {
  const d = repo()
  for (const args of [['run'], ['run', 'nope'], ['run', 'start'], ['run', 'start', '--key'], ['run', 'start', '--key', 'XYZ-1'], ['run', 'start', '--key', 'ABC'], ['run', 'stop', 'extra'], ['run', 'status', '--what']]) {
    const r = cli(d, args)
    assert.equal(r.status, 2, args.join(' '))
    assert.ok(r.stderr.trim(), args.join(' '))
  }
  assert.match(cli(d, ['run', 'start', '--key', 'XYZ-1']).stderr, /--key XYZ-1 is not a key of ABC, TRK/)
  assert.equal(existsSync(join(d, RUN_MARKER)), false)
  const bare = dir()
  const r = cli(bare, ['run', 'start', '--key', 'ABC-1'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /quality-code:setup/)
})
