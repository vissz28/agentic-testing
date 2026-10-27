import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit, readAudit } from '../../lib/base/audit.mjs'
import { loadConfig } from '../../lib/base/config.mjs'
import { pickPlace, placeDirs, placeOf, placesFor, savedPlace } from '../../lib/base/places.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'qc-place-'))
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'] } }

function repo(extra = {}) {
  const root = tmp()
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ ...CFG, ...extra }))
  return root
}
const run = (root, claude, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: claude }, encoding: 'utf8' })
const saveJson = out => JSON.parse(out.split('\n').find(l => l.startsWith('SAVE_JSON:')).slice('SAVE_JSON:'.length))

test('never asked: the repo in a repo, this machine with no repo', () => {
  const root = tmp(), env = { CLAUDE_CONFIG_DIR: tmp() }
  assert.equal(savedPlace(root, 'repo', env), null)
  assert.equal(placeOf(root, 'repo', env), 'repo')
  assert.equal(placeOf(root, 'personal', env), 'local')
  assert.deepEqual(placesFor('repo'), ['repo', 'local', 'chat'])
  assert.deepEqual(placesFor('personal'), ['local', 'chat'], 'no repo to keep files in')
})

test('each place has its folders; the config ticketsDir applies in the repo', () => {
  const root = tmp(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude }
  assert.deepEqual(placeDirs(root, { source: 'repo' }, 'repo', env), { place: 'repo', ticketsDir: '.quality-code/tickets', auditDir: join(root, '.claude/quality-code/audit') })
  assert.equal(placeDirs(root, { source: 'repo', ticketsDir: 'qa/tickets/' }, 'repo', env).ticketsDir, 'qa/tickets')
  const local = placeDirs(root, { source: 'repo', ticketsDir: 'qa/tickets' }, 'local', env)
  assert.match(local.ticketsDir, new RegExp(`^${claude}/quality-code/projects/qc-place-[^/]+-[0-9a-f]{8}/tickets$`))
  assert.equal(local.auditDir, join(local.ticketsDir, '..', 'audit'))
  const chat = placeDirs(root, { source: 'repo' }, 'chat', env)
  assert.ok(chat.ticketsDir.startsWith(tmpdir()), 'a temp folder')
  assert.equal(chat.auditDir, null, 'no log in the chat')
  assert.equal(placeDirs(root, { source: 'personal' }, 'local', env).ticketsDir, join(claude, 'quality-code', 'tickets'))
})

test('loadConfig gives the place, its tickets folder and its log folder', () => {
  const root = repo(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude }
  let c = loadConfig(root, env)
  assert.equal(c.place, 'repo')
  assert.equal(c.config.ticketsDir, '.quality-code/tickets')
  pickPlace(root, { source: 'repo' }, 'local', env)
  c = loadConfig(root, env)
  assert.equal(c.place, 'local')
  assert.ok(c.config.ticketsDir.startsWith(join(claude, 'quality-code', 'projects')))
  pickPlace(root, { source: 'repo' }, 'chat', env)
  assert.equal(loadConfig(root, env).auditDir, null)
})

test('picking a place moves the tickets folder and the audit log, and appends to a log already there', () => {
  const root = repo(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude }
  mkdirSync(join(root, '.quality-code/tickets/ABC-1'), { recursive: true })
  writeFileSync(join(root, '.quality-code/tickets/ABC-1/run.md'), 'run')
  assert.equal(audit(root, 'gate', { key: 'ABC-1', score: 80, gate: 'pass' }, { env }), true)
  const r = pickPlace(root, { source: 'repo' }, 'local', env)
  assert.equal(r.from, 'repo')
  assert.equal(r.to, 'local')
  assert.equal(r.moved, 2)
  assert.equal(existsSync(join(root, '.quality-code/tickets/ABC-1/run.md')), false, 'gone from the repo')
  assert.equal(readFileSync(join(r.dirs.ticketsDir, 'ABC-1/run.md'), 'utf8'), 'run')
  assert.equal(readAudit(root, 'gate', r.dirs.auditDir).length, 1)
  // A new event goes to the new log; moving back appends it to the repo's.
  audit(root, 'gate', { key: 'ABC-2', score: 50, gate: 'refuse' }, { env, dir: r.dirs.auditDir })
  audit(root, 'gate', { key: 'ABC-3', score: 90, gate: 'pass' }, { env })
  pickPlace(root, { source: 'repo' }, 'repo', env)
  assert.deepEqual(readAudit(root, 'gate').map(e => e.key), ['ABC-3', 'ABC-1', 'ABC-2'])
})

test('the chat keeps no audit log', () => {
  const root = tmp()
  assert.equal(audit(root, 'gate', { key: 'ABC-1' }, { env: {}, dir: null }), false)
  assert.deepEqual(readAudit(root, 'gate', null), [])
})

test('save get and save set: asked once, remembered per project', () => {
  const root = repo(), claude = tmp()
  let r = run(root, claude, 'save', 'get')
  assert.equal(r.status, 0, r.stderr)
  let j = saveJson(r.stdout)
  assert.equal(j.place, 'repo')
  assert.equal(j.asked, false)
  assert.deepEqual(j.options.map(o => o.place), ['repo', 'local', 'chat'])
  r = run(root, claude, 'save', 'set', 'chat')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^ok: files and logs go only in the chat: nothing is kept\./)
  j = saveJson(run(root, claude, 'save', 'get').stdout)
  assert.equal(j.place, 'chat')
  assert.equal(j.asked, true)
  assert.match(run(root, claude, 'config', 'check').stdout, /\ntickets folder: .+ \(files kept only in the chat\)/)
  assert.equal(run(root, claude, 'save', 'set', 'cloud').status, 2)
  assert.equal(saveJson(run(repo(), claude, 'save', 'get').stdout).asked, false, 'another project is asked on its own')
})

test('a setup with no repo offers this machine and the chat only', () => {
  const root = tmp(), claude = tmp()
  writeFileSync(join(claude, 'quality-code.json'), JSON.stringify(CFG))
  const j = saveJson(run(root, claude, 'save', 'get').stdout)
  assert.equal(j.place, 'local')
  assert.deepEqual(j.options.map(o => o.place), ['local', 'chat'])
  assert.equal(run(root, claude, 'save', 'set', 'repo').status, 2)
})
