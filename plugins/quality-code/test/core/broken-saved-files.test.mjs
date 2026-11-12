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

const BROKEN = '{"filled": ['
const project = config => {
  const root = mkdtempSync(join(tmpdir(), 'qc-broken-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'] }, ...config }))
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
  const p = project({ frontend: 'playwright', playwright: { folder: 'e2e/' } })
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
