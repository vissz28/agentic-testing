// --report on kpi, consumption and tickets-eval: the file is written next to the others, the card stays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as kpi } from '../../bin/kpi.mjs'
import { main as consumption } from '../../bin/consumption.mjs'
import { NOW, install } from '../report/helpers.mjs'

const TICKET = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const day = d => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`

async function call(fn, args, env, now = NOW) {
  let out = ''
  let err = ''
  const code = await fn(args, env, '/', { now, stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}
const reportOf = out => JSON.parse(out.split('\n').find(l => l.startsWith('REPORT_JSON:')).slice('REPORT_JSON:'.length))

test('kpi --report writes the file under <ticketsDir>/reports and keeps the card', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-kpi-rep-'))
  mkdirSync(join(root, '.claude/quality-code/audit'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code/audit/pipeline.jsonl'), `${JSON.stringify({ key: 'ABC-1', verdict: 'green', decidedBy: null, backend: 'vitest', steps: [], counts: {}, date: day(10) })}\n`)
  const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: join(root, '.claude-home'), QUALITY_CODE_PLACE: 'repo' }
  const r = await call(kpi, ['--report'], env)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^quality-code KPI · last 30 days/)
  assert.match(r.out, /^KPI_JSON:/m)
  const rep = reportOf(r.out)
  assert.equal(rep.path, join(root, '.quality-code/tickets/reports/kpi-2026-10-14.html'))
  assert.ok(existsSync(rep.path))
  assert.match(readFileSync(rep.path, 'utf8'), /^<!doctype html>/)
  assert.ok(r.out.includes(`Report: ${rep.path}`))
  const plain = await call(kpi, [], env)
  assert.doesNotMatch(plain.out, /REPORT_JSON|Report:/)
})
test('kpi --report keeps the exit 3 when there is no audit data, and rejects --json with it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-kpi-rep-'))
  const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: join(root, '.claude-home') }
  assert.equal((await call(kpi, ['--report'], env)).code, 3)
  const both = await call(kpi, ['--report', '--json'], env)
  assert.equal(both.code, 2)
  assert.match(both.err, /do not go together/)
})
test('kpi --report in the chat place saves outside the repo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-kpi-rep-'))
  mkdirSync(join(root, '.claude/quality-code/audit'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code/audit/override.jsonl'), `${JSON.stringify({ key: 'ABC-1', score: 10, bar: 70, date: day(10) })}\n`)
  const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: join(root, '.claude-home'), QUALITY_CODE_PLACE: 'chat' }
  const r = await call(kpi, ['--report'], env)
  const rep = reportOf(r.out)
  assert.ok(!rep.path.startsWith(root), rep.path)
  assert.match(rep.path, /\/reports\/kpi-2026-10-14\.html$/)
  assert.ok(existsSync(rep.path))
})
test('consumption --report writes the file and keeps the card', async () => {
  const f = install()
  const env = { CLAUDE_PROJECT_DIR: f.root, CLAUDE_CONFIG_DIR: f.configDir, QUALITY_CODE_PLACE: 'repo' }
  const r = await call(consumption, ['--report', '--by', 'ticket'], env)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^quality-code consumption/)
  const rep = reportOf(r.out)
  assert.equal(rep.path, join(f.root, '.quality-code/tickets/reports/consumption-2026-10-14.html'))
  const html = readFileSync(rep.path, 'utf8')
  assert.match(html, /Cost by command/)
  assert.match(html, /Cost by model/)
  assert.doesNotMatch(html, /https?:|<script/)
  assert.equal((await call(consumption, ['--report', '--json'], env)).code, 2)
})

test('tickets-eval --report writes the file in <ticketsDir>/reports and keeps the card', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-te-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
  writeFileSync(join(d, 'list.json'), JSON.stringify([{ key: 'DEMO-1', issuetype: 'Bug', summary: 'PRIVATE words', labels: [], text: { description: 'Broken.' } }]))
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d, QUALITY_CODE_PLACE: 'repo' }
  const r = spawnSync('node', [TICKET, 'tickets-eval', '--in', '@list.json', '--report'], { cwd: '/', env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Project: 1 ticket scored/)
  const rep = reportOf(r.stdout)
  assert.equal(rep.path, join(d, '.quality-code/tickets/reports', `tickets-eval-${new Date().toISOString().slice(0, 10)}.html`))
  const html = readFileSync(rep.path, 'utf8')
  assert.match(html, /DEMO-1/)
  assert.ok(!html.includes('PRIVATE') && !html.includes('Broken'))
  const both = spawnSync('node', [TICKET, 'tickets-eval', '--in', '@list.json', '--report', '--json'], { cwd: '/', env, encoding: 'utf8' })
  assert.equal(both.status, 2)
})
