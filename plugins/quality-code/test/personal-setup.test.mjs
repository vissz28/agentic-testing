// The personal (no-repo) setup: lookup order, the Claude-folder override, the tickets default, the
// personal write, and the wording of the commands that need a repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadConfig, personalConfigPath, personalTicketsDir } from '../lib/base/config.mjs'
import { writePersonal, detect } from '../bin/setup.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../bin/ticket.mjs')
const SETUP = join(HERE, '../bin/setup.mjs')
const tmp = () => mkdtempSync(join(tmpdir(), 'qc-pers-'))
const cfg = adapter => ({ version: 1, adapter, jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] })
const repoWith = (d, adapter) => { mkdirSync(join(d, '.claude'), { recursive: true }); writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(cfg(adapter))) }
const personalWith = (claude, c) => { mkdirSync(claude, { recursive: true }); writeFileSync(join(claude, 'quality-code.json'), JSON.stringify(c)) }
const run = (cwd, claude, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CONFIG_DIR: claude }, encoding: 'utf8' })

test('repo config wins over the personal one', () => {
  const d = tmp(), claude = tmp()
  repoWith(d, 'vitest'); personalWith(claude, cfg('playwright'))
  const r = loadConfig(d, { CLAUDE_CONFIG_DIR: claude })
  assert.equal(r.ok, true)
  assert.equal(r.source, 'repo')
  assert.equal(r.config.adapter, 'vitest')
  assert.equal(r.path, join(d, '.claude/quality-code.json'))
  assert.equal(r.config.ticketsDir, '.claude/quality-code/tickets')
})
test('personal only: it is used, with the absolute tickets default', () => {
  const d = tmp(), claude = tmp()
  personalWith(claude, cfg('fullstack'))
  const r = loadConfig(d, { CLAUDE_CONFIG_DIR: claude })
  assert.equal(r.ok, true)
  assert.equal(r.source, 'personal')
  assert.equal(r.path, join(claude, 'quality-code.json'))
  assert.equal(r.config.adapter, 'fullstack')
  assert.ok(isAbsolute(r.config.ticketsDir))
  assert.equal(r.config.ticketsDir, join(claude, 'quality-code', 'tickets'))
})
test('personal ticketsDir set in the file is kept', () => {
  const d = tmp(), claude = tmp()
  personalWith(claude, { ...cfg('vitest'), ticketsDir: '/data/tickets' })
  assert.equal(loadConfig(d, { CLAUDE_CONFIG_DIR: claude }).config.ticketsDir, '/data/tickets')
})
test('neither: not set up, source absent', () => {
  const r = loadConfig(tmp(), { CLAUDE_CONFIG_DIR: tmp() })
  assert.equal(r.ok, false)
  assert.equal(r.missing, true)
  assert.equal(r.source, undefined)
})
test('a personal config is validated like any other', () => {
  const claude = tmp()
  personalWith(claude, { ...cfg('vitest'), adapter: 'nope' })
  const r = loadConfig(tmp(), { CLAUDE_CONFIG_DIR: claude })
  assert.equal(r.ok, false)
  assert.equal(r.source, 'personal')
  assert.ok(r.errors.some(e => e.startsWith('adapter')))
})
test('a broken personal file names its path', () => {
  const claude = tmp()
  writeFileSync(join(claude, 'quality-code.json'), '{nope')
  const r = loadConfig(tmp(), { CLAUDE_CONFIG_DIR: claude })
  assert.equal(r.ok, false)
  assert.ok(r.errors[0].includes(join(claude, 'quality-code.json')))
})
test('CLAUDE_CONFIG_DIR overrides ~/.claude', () => {
  const claude = tmp()
  assert.equal(personalConfigPath({ CLAUDE_CONFIG_DIR: claude }), join(claude, 'quality-code.json'))
  assert.equal(personalTicketsDir({ CLAUDE_CONFIG_DIR: claude }), join(claude, 'quality-code', 'tickets'))
  assert.match(personalConfigPath({}), /\.claude[\\/]quality-code\.json$/)
})
test('config check says which config it used', () => {
  const d = tmp(), claude = tmp()
  assert.equal(run(d, claude, 'config', 'check').status, 2)
  personalWith(claude, cfg('playwright'))
  assert.equal(run(d, claude, 'config', 'check').stdout.trim(), `ok (personal: ${join(claude, 'quality-code.json')})`)
  repoWith(d, 'vitest')
  assert.equal(run(d, claude, 'config', 'check').stdout.trim(), `ok (repo: ${join(d, '.claude/quality-code.json')})`)
})
test('writePersonal writes the personal file only, and refuses an invalid config', () => {
  const claude = tmp()
  const r = writePersonal(cfg('fullstack'), { CLAUDE_CONFIG_DIR: claude })
  assert.equal(r.ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(claude, 'quality-code.json'), 'utf8')), cfg('fullstack'))
  assert.equal(writePersonal(cfg('x'), { CLAUDE_CONFIG_DIR: claude }).ok, false)
})
test('setup.mjs --write-personal and scope "personal" never touch the repo', () => {
  for (const flag of ['--write-personal', '--write']) {
    const d = tmp(), claude = tmp()
    writeFileSync(join(d, 'p.json'), JSON.stringify(flag === '--write' ? { scope: 'personal', config: cfg('vitest') } : { config: cfg('vitest') }))
    const r = spawnSync(process.execPath, [SETUP, flag, '@p.json'], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: claude }, encoding: 'utf8' })
    assert.equal(r.stdout.trim(), 'ok')
    assert.ok(existsSync(join(claude, 'quality-code.json')))
    assert.deepEqual(readdirSync(d), ['p.json'])
  }
})
test('detect shows the existing personal config', () => {
  const claude = tmp()
  assert.equal(detect(tmp(), { CLAUDE_CONFIG_DIR: claude }).personal.existing, null)
  personalWith(claude, cfg('vitest'))
  const p = detect(tmp(), { CLAUDE_CONFIG_DIR: claude }).personal
  assert.deepEqual(p.existing, cfg('vitest'))
  assert.equal(p.path, join(claude, 'quality-code.json'))
})

const cmd = n => readFileSync(join(HERE, '../commands', `${n}.md`), 'utf8')
test('setup: the first card after the connectors, with both options', () => {
  const s = cmd('setup')
  for (const t of ['Where will you use Quality Code?', '1. In a repo (developers)', '2. No repo, Jira only (QA, PO)', 'Which tickets?', '1. Frontend', '2. Backend', '3. Both', '--write-personal']) assert.ok(s.includes(t), t)
  assert.ok(s.indexOf('0. **Connectors.**') < s.indexOf('Where will you use Quality Code?'))
  assert.ok(s.indexOf('Where will you use Quality Code?') < s.indexOf('2. **This project.**'))
})
for (const n of ['write', 'check', 'seed', 'xray', 'start']) {
  test(`${n}: a personal config or no git repo stops with the needs-a-repo line`, () => {
    const s = cmd(n)
    assert.ok(s.includes('config check'))
    assert.ok(s.includes('ok (personal: …)'))
    assert.ok(s.includes('This needs a repo. Open the project folder, or run /quality-code:setup there.'))
  })
}
for (const n of ['ticket-eval', 'ticket']) {
  test(`${n}: works with either config`, () => assert.ok(!cmd(n).includes('This needs a repo.')))
}
