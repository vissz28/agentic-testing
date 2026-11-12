// A file the plugin saved itself and that is now broken (half written, edited by hand) stops the command with
// the file's name. Before, it was taken for a missing file: saved answers were overwritten, a QA run started
// over, Xray tests were created twice, and nobody was told.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../lib/base/config.mjs'
import { saveTickets } from '../../lib/ticket/batch.mjs'
import { createdOf } from '../../bin/xray.mjs'
import { main as qa } from '../../bin/qa.mjs'
import { main as routine } from '../../bin/routine.mjs'
import { main as progress } from '../../bin/progress.mjs'
import { fileOf as progressFile } from '../../lib/base/progress.mjs'

const BROKEN = '{"filled": ['
const project = config => {
  const root = mkdtempSync(join(tmpdir(), 'qc-broken-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'] }, ...config }))
  const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: join(root, '.home'), QUALITY_CODE_PLACE: 'repo' }
  return { root, env, cfg: loadConfig(root, env) }
}
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const io = () => { const o = { out: '', err: '' }; return { o, io: { stdout: s => { o.out += s }, stderr: s => { o.err += s } } } }

test('saving tickets never overwrites a broken saved ticket: it stops, naming the file, and leaves it as it is', () => {
  const p = project()
  const file = resolve(p.root, p.cfg.config.ticketsDir, 'DEMO-1', 'ticket.json')
  put(file, BROKEN)
  assert.throws(() => saveTickets(p.root, p.cfg.config, [{ key: 'DEMO-1', summary: 's' }]), e => e.message.startsWith(`${file} is not valid JSON`))
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('ticket saved: a broken saved ticket is reported, not taken for "nothing saved"', () => {
  const p = project()
  const file = resolve(p.root, p.cfg.config.ticketsDir, 'DEMO-1', 'ticket.json')
  put(file, BROKEN)
  const cli = fileURLToPath(new URL('../../bin/ticket.mjs', import.meta.url))
  const r = spawnSync(process.execPath, [cli, 'saved', 'DEMO-1'], { cwd: '/', env: { ...process.env, ...p.env }, encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.startsWith(`ticket.mjs: ${file} is not valid JSON`), r.stderr)
})

test('qa: a broken saved run is reported, and the run does not start over', async () => {
  const p = project()
  const file = join(p.cfg.auditDir, 'qa', 'DEMO-1.json')
  put(file, BROKEN)
  const { o, io: streams } = io()
  assert.equal(await qa(['state', 'show', 'DEMO-1'], p.env, p.root, streams), 2)
  assert.ok(o.err.startsWith(`qa.mjs: ${file} is not valid JSON`), o.err)
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('xray: a broken list of tests already created is reported, so no test is created twice', () => {
  const p = project()
  const x = { folder: 'xray/' }
  const file = resolve(p.root, x.folder, 'DEMO-1', 'xray-created.json')
  put(file, BROKEN)
  assert.throws(() => createdOf(p.root, x, 'DEMO-1'), e => e.message.startsWith(`${file} is not valid JSON`))
  assert.deepEqual(createdOf(p.root, x, 'DEMO-2'), {}, 'none created yet is not an error')
})

test('routine: a broken record of the last check is reported, not taken for a first check', async () => {
  const p = project({ adapter: 'playwright', playwright: { folder: 'e2e/' } })
  put(join(p.root, 'e2e/one.spec.ts'), "test('DEMO-1 a', () => {})")
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: p.root, stdio: 'ignore' })
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base')
  const file = join(p.cfg.auditDir, 'routine', 'last.json')
  put(file, BROKEN)
  const { o, io: streams } = io()
  const code = await routine(['run', '--since-last'], p.env, p.root, { ...streams, run: async () => ({ exit: 0, verdict: 'green', phases: [] }) })
  assert.equal(code, 2)
  assert.ok(o.err.startsWith(`routine.mjs: ${file} is not valid JSON`), o.err)
})

// Files a later command reads and then rewrites: rewriting a broken one would drop what else it held.
const BIN = name => fileURLToPath(new URL(`../../bin/${name}.mjs`, import.meta.url))
const cli = (p, name, args) => spawnSync(process.execPath, [BIN(name), ...args], { cwd: p.root, env: { ...process.env, ...p.env }, encoding: 'utf8' })

test('save set: a broken list of where each project keeps its files stops it, naming the file, and is left as it is', () => {
  const p = project()
  const file = join(p.env.CLAUDE_CONFIG_DIR, 'quality-code', 'save.json')
  put(file, BROKEN)
  const r = cli(p, 'ticket', ['save', 'set', 'local'])
  assert.equal(r.status, 2, r.stdout)
  assert.ok(r.stderr.startsWith(`ticket.mjs: ${file} is not valid JSON`), r.stderr)
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('root set: a broken file of the roots picked in each repo stops it, naming the file, and is left as it is', () => {
  const p = project({ roots: ['app', 'api'] })
  mkdirSync(join(p.root, 'app')); mkdirSync(join(p.root, 'api'))
  const file = join(p.env.CLAUDE_CONFIG_DIR, 'quality-code', 'roots.json')
  put(file, BROKEN)
  const r = cli(p, 'ticket', ['root', 'set', 'app'])
  assert.equal(r.status, 2, r.stdout)
  assert.ok(r.stderr.startsWith(`ticket.mjs: ${file} is not valid JSON`), r.stderr)
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('ticket jira-posted update: a broken saved ticket stops it, naming the file, and is left as it is', () => {
  const p = project()
  const file = resolve(p.root, p.cfg.config.ticketsDir, 'DEMO-1', 'ticket.json')
  put(file, BROKEN)
  const r = cli(p, 'ticket', ['jira-posted', 'DEMO-1', 'update'])
  assert.equal(r.status, 2, r.stdout)
  assert.ok(r.stderr.startsWith(`ticket.mjs: ${file} is not valid JSON`), r.stderr)
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('qa watch fresh: a broken watch list stops it, naming the file, and is left as it is', async () => {
  const p = project()
  const file = join(p.cfg.auditDir, 'qa', 'watch.json')
  put(file, BROKEN)
  const { o, io: streams } = io()
  assert.equal(await qa(['watch', 'fresh', '--found', 'DEMO-2'], p.env, p.root, streams), 2)
  assert.ok(o.err.startsWith(`qa.mjs: ${file} is not valid JSON`), o.err)
  assert.equal(readFileSync(file, 'utf8'), BROKEN)
})

test('progress get: a broken saved step is reported, not taken for "nothing saved"', async () => {
  const p = project()
  const { o, io: streams } = io()
  assert.equal(await progress(['set', 'spec', '--step', '2', '--label', 'tests written'], { ...streams, env: p.env, cwd: p.root }), 0)
  const file = progressFile(p.root, 'spec', null, p.env)
  put(file, BROKEN)
  const again = io()
  assert.equal(await progress(['get', 'spec'], { ...again.io, env: p.env, cwd: p.root }), 2)
  assert.ok(again.o.err.startsWith(`progress.mjs: ${file} is not valid JSON`), again.o.err)
  assert.equal(o.err, '')
})

test('pipeline --key: a broken rules.json stops the run before it starts, naming the file', () => {
  const p = project()
  put(join(p.root, 'test/a.spec.ts'), "test('DEMO-1 a', () => { expect(1).toBe(1) })")
  const file = resolve(p.root, p.cfg.config.ticketsDir, 'DEMO-1', 'rules.json')
  put(file, BROKEN)
  const r = cli(p, 'pipeline', ['test/a.spec.ts', '--key', 'DEMO-1'])
  assert.equal(r.status, 2, r.stdout)
  assert.ok(r.stderr.startsWith(`${file} is not valid JSON`), r.stderr)
})
