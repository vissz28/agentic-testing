import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit, readAudit } from '../../lib/state/audit.mjs'
import { loadConfig } from '../../lib/config/config.mjs'
import { pickPlace, placeDirs, placeOf, placesFor, rememberPlace, savedPlace } from '../../lib/config/places.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'qc-place-'))
const CFG = { version: 2, backend: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'] } }

function repo(extra = {}) {
  const root = tmp()
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ ...CFG, ...extra }))
  return root
}
const run = (root, claude, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, QUALITY_CODE_PLACE: '', CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: claude }, encoding: 'utf8' })
const saveJson = out => JSON.parse(out.split('\n').find(l => l.startsWith('SAVE_JSON:')).slice('SAVE_JSON:'.length))

test('never asked: this session, in a repo or with no repo', () => {
  const root = tmp(), env = { CLAUDE_CONFIG_DIR: tmp(), QUALITY_CODE_PLACE: '' }
  assert.equal(savedPlace(root, 'repo', env), null)
  assert.equal(placeOf(root, 'repo', env), 'chat')
  assert.equal(placeOf(root, 'personal', env), 'chat')
  assert.deepEqual(placesFor('repo'), ['repo', 'local', 'chat'])
  assert.deepEqual(placesFor('personal'), ['local', 'chat'], 'no repo to keep files in')
})

test('each place has its folders; the config ticketsDir applies in the repo', () => {
  const root = tmp(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' }
  assert.deepEqual(placeDirs(root, { source: 'repo' }, 'repo', env), { place: 'repo', ticketsDir: '.quality-code/tickets', auditDir: join(root, '.claude/quality-code/audit') })
  assert.equal(placeDirs(root, { source: 'repo', ticketsDir: 'qa/tickets/' }, 'repo', env).ticketsDir, 'qa/tickets')
  const local = placeDirs(root, { source: 'repo', ticketsDir: 'qa/tickets' }, 'local', env)
  assert.match(local.ticketsDir, new RegExp(`^${claude}/quality-code/projects/qc-place-[^/]+-[0-9a-f]{8}/tickets$`))
  assert.equal(local.auditDir, join(local.ticketsDir, '..', 'audit'))
  const chat = placeDirs(root, { source: 'repo' }, 'chat', env)
  assert.ok(chat.ticketsDir.startsWith(tmpdir()), 'a temp folder')
  assert.ok(chat.auditDir.startsWith(tmpdir()), 'the session keeps its log in the temp folder too')
  assert.equal(placeDirs(root, { source: 'personal' }, 'local', env).ticketsDir, join(claude, 'quality-code', 'tickets'))
})

test('loadConfig gives the place, its tickets folder and its log folder', () => {
  const root = repo(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' }
  let c = loadConfig(root, env)
  assert.equal(c.place, 'chat', 'the session until a place is picked')
  assert.ok(c.auditDir.startsWith(tmpdir()))
  pickPlace(root, { source: 'repo' }, 'repo', env)
  c = loadConfig(root, env)
  assert.equal(c.place, 'repo')
  assert.equal(c.config.ticketsDir, '.quality-code/tickets')
  pickPlace(root, { source: 'repo' }, 'local', env)
  c = loadConfig(root, env)
  assert.equal(c.place, 'local')
  assert.ok(c.config.ticketsDir.startsWith(join(claude, 'quality-code', 'projects')))
  pickPlace(root, { source: 'repo' }, 'chat', env)
  assert.ok(loadConfig(root, env).auditDir.startsWith(tmpdir()))
})

test('picking a place moves the tickets folder and the audit log, and appends to a log already there', () => {
  const root = repo(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' }
  pickPlace(root, { source: 'repo' }, 'repo', env)
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
  assert.equal(j.place, 'chat')
  assert.equal(j.asked, false)
  assert.deepEqual(j.options.map(o => o.place), ['repo', 'local', 'chat'])
  r = run(root, claude, 'save', 'set', 'chat')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^ok: files and logs go in this session, in .+\/ \(a temp folder/)
  j = saveJson(run(root, claude, 'save', 'get').stdout)
  assert.equal(j.place, 'chat')
  assert.equal(j.asked, true)
  assert.match(run(root, claude, 'config', 'check').stdout, /\ntickets folder: .+ \(files kept in this session \(a temp folder\)\)/)
  assert.equal(run(root, claude, 'save', 'set', 'cloud').status, 2)
  assert.equal(saveJson(run(repo(), claude, 'save', 'get').stdout).asked, false, 'another project is asked on its own')
})

test('a setup with no repo offers this machine and the chat only', () => {
  const root = tmp(), claude = tmp()
  writeFileSync(join(claude, 'quality-code.json'), JSON.stringify(CFG))
  const j = saveJson(run(root, claude, 'save', 'get').stdout)
  assert.equal(j.place, 'chat')
  assert.deepEqual(j.options.map(o => o.place), ['local', 'chat'])
  assert.equal(run(root, claude, 'save', 'set', 'repo').status, 2)
})

test('a monorepo: the pick and the criteria field are one per repo, not one per project folder', async () => {
  const { storeField, resolveField } = await import('../../lib/ticket/fields.mjs')
  const top = tmp(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' }
  mkdirSync(join(top, '.claude'), { recursive: true })
  mkdirSync(join(top, 'a'), { recursive: true })
  mkdirSync(join(top, 'b'), { recursive: true })
  const write = root => writeFileSync(join(top, '.claude/quality-code.json'), JSON.stringify({ ...CFG, root }))
  write('a')
  rememberPlace(join(top, 'a'), 'repo', 'local', env)
  assert.equal(storeField(join(top, 'a'), 'ABC', 'customfield_11707').ok, true)
  write('b')
  assert.equal(placeOf(join(top, 'b'), 'repo', env), 'local', 'the pick follows the repo to the new project root')
  assert.deepEqual(resolveField(join(top, 'b'), CFG, 'ABC'), { field: 'customfield_11707', source: 'stored' }, 'and so does the field')
})

// The setup config sits with the tickets and audit files, in the place picked at setup's last step.
import { configFileOf, configPath } from '../../lib/config/config.mjs'
import { placeConfigPath } from '../../lib/config/places.mjs'
import { write } from '../../bin/setup.mjs'

test('the setup config is in the picked place, beside the tickets folder and the audit log', () => {
  const root = tmp(), claude = tmp(), env = { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' }
  assert.equal(placeConfigPath(root, env, 'repo'), join(root, '.quality-code/config.json'))
  const local = placeConfigPath(root, env, 'local')
  assert.equal(local, join(placeDirs(root, { source: 'repo' }, 'local', env).ticketsDir, '..', 'config.json'))
  assert.match(local, new RegExp(`^${claude}/quality-code/projects/`))
  assert.equal(placeConfigPath(root, env, 'chat').includes('/.claude/'), false)
  assert.equal(placeConfigPath(root, env), placeConfigPath(root, env, 'chat'), 'unpicked: this session')
})

test('the config in the place is read first; the legacy repo file is the fallback', () => {
  const root = repo({ languages: ['it'] })
  const env = { CLAUDE_CONFIG_DIR: tmp(), QUALITY_CODE_PLACE: 'repo' }
  assert.equal(configFileOf(root, env), join(root, '.claude/quality-code.json'), 'only the legacy file exists')
  assert.deepEqual(loadConfig(root, env).config.languages, ['it'])
  mkdirSync(join(root, '.quality-code'), { recursive: true })
  writeFileSync(join(root, '.quality-code/config.json'), JSON.stringify({ ...CFG, languages: ['en'] }))
  assert.equal(configFileOf(root, env), join(root, '.quality-code/config.json'))
  assert.equal(configPath(root, env), join(root, '.quality-code/config.json'))
  assert.deepEqual(loadConfig(root, env).config.languages, ['en'], 'the new location wins')
})

test('setup writes the config to the place, never into the repo .gitignore, and leaves the legacy file alone', () => {
  const root = repo(), claude = tmp()
  writeFileSync(join(root, 'package.json'), '{}')
  const before = readFileSync(join(root, '.claude/quality-code.json'), 'utf8')
  const r = write(root, { ...CFG, ticketsDir: '.quality-code/tickets' })
  assert.equal(r.ok, true)
  assert.match(r.note, /is still there/)
  assert.equal(readFileSync(join(root, '.claude/quality-code.json'), 'utf8'), before)
  assert.equal(existsSync(join(root, '.gitignore')), false)
  assert.equal(existsSync(join(root, '.quality-code/config.json')), true)
  void claude
})

test('save set moves the config with the tickets and the audit log, and back', () => {
  const root = tmp(), claude = tmp()
  writeFileSync(join(root, 'package.json'), '{}')
  const env = { ...process.env, QUALITY_CODE_PLACE: '', CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: claude }
  // Setup's order: the config first, in the default place (this session), then the last-step question moves it.
  const w = spawnSync(process.execPath, [new URL('../../bin/setup.mjs', import.meta.url).pathname, '--write', JSON.stringify({ config: CFG })], { cwd: root, env, encoding: 'utf8' })
  assert.equal(w.stdout.split('\n')[0], 'ok', w.stderr)
  const chat = placeConfigPath(root, { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: '' })
  assert.equal(existsSync(chat), true, 'written to the session folder first')
  assert.equal(existsSync(join(root, '.claude/quality-code.json')), false)
  assert.equal(run(root, claude, 'save', 'set', 'local').status, 0)
  const local = placeConfigPath(root, { CLAUDE_CONFIG_DIR: claude }, 'local')
  assert.equal(existsSync(local), true)
  assert.equal(existsSync(chat), false)
  assert.equal(run(root, claude, 'config', 'check').status, 0, 'the config is found in its new place')
  assert.equal(run(root, claude, 'save', 'set', 'repo').status, 0)
  assert.equal(existsSync(join(root, '.quality-code/config.json')), true)
  assert.equal(readFileSync(join(root, '.quality-code/.gitignore'), 'utf8'), '*\n')
  assert.equal(existsSync(local), false)
  assert.equal(existsSync(join(root, '.gitignore')), false)
})

test('before a pick nothing lands in the repo: the Jira field goes to the session folder, and after save set local no stray folder is left', () => {
  const root = tmp(), claude = tmp()
  writeFileSync(join(root, 'package.json'), '{}')
  const env = { ...process.env, QUALITY_CODE_PLACE: '', CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: claude }
  const w = spawnSync(process.execPath, [new URL('../../bin/setup.mjs', import.meta.url).pathname, '--write', JSON.stringify({ config: CFG })], { cwd: root, env, encoding: 'utf8' })
  assert.equal(w.stdout.split('\n')[0], 'ok', w.stderr)
  assert.equal(run(root, claude, 'field', 'set', 'ABC', 'customfield_100').status, 0)
  assert.equal(existsSync(join(root, '.claude')), false, 'no .claude/ in the repo before the pick')
  assert.equal(existsSync(join(root, '.quality-code')), false, 'no .quality-code/ in the repo before the pick')
  assert.match(run(root, claude, 'field', 'get', 'ABC').stdout, /"field":"customfield_100"/)
  assert.equal(run(root, claude, 'save', 'set', 'local').status, 0)
  assert.equal(existsSync(join(root, '.claude')), false)
  assert.equal(existsSync(join(root, '.quality-code')), false)
  assert.match(run(root, claude, 'field', 'get', 'ABC').stdout, /"field":"customfield_100"/, 'the field moved with the config')
  assert.equal(run(root, claude, 'save', 'set', 'repo').status, 0)
  assert.equal(existsSync(join(root, '.quality-code/jira-fields.json')), true)
  assert.equal(run(root, claude, 'save', 'set', 'local').status, 0)
  assert.equal(existsSync(join(root, '.quality-code')), false, 'moving out of the repo leaves it clean')
  assert.equal(existsSync(join(root, '.claude')), false)
})
