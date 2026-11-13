import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evalTickets, formatCard } from '../lib/ticket/batch.mjs'
import { buildBrief } from '../lib/ticket/score.mjs'
import { sanitizeTicket } from '../lib/ticket/sanitize.mjs'
import { sides } from './config-fields.mjs'
import { validateConfig } from '../lib/config/config.mjs'

const CLI = new URL('../bin/ticket.mjs', import.meta.url).pathname
const cfg = (adapter = 'vitest', extra = {}) => ({
  version: 2, ...sides(adapter), jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ...extra,
})
// The config as the scripts get it from the file.
const loaded = (...a) => validateConfig(cfg(...a)).config
const proj = (config = cfg()) => {
  const d = mkdtempSync(join(tmpdir(), 'qcb-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(config))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

const GOOD = `## Context
Orders need an export so support can check them.
## Acceptance criteria
Given a signed-in user with orders
When they click Export
Then a CSV file with all their orders is downloaded
Given a signed-in user with no orders
When they click Export
Then the message "No orders to export" is shown
## Steps to reproduce
1. Open the orders page
2. Click Export
## Environment
Env: staging`
const raw = (key, description, extra = {}) => ({ key, issuetype: 'Story', status: 'To Do', summary: `Ticket ${key}`, labels: [], text: { description }, scenarios: [], ...extra })
const good = key => raw(key, GOOD, { attachments: 1, links: [{ url: 'https://jira.example.com/browse/ABC-99', title: 'ABC-99 related' }] })
const thin = key => raw(key, 'Broken.')

test('a thin ticket is refused and a well-written one passes, each scored like cli score', () => {
  const config = loaded()
  const r = evalTickets(config, [good('ABC-1'), thin('ABC-2')])
  const by = Object.fromEntries(r.rows.map(x => [x.key, x]))
  assert.equal(by['ABC-2'].gate, 'refuse')
  assert.equal(by['ABC-1'].gate, 'pass')
  for (const t of [good('ABC-1'), thin('ABC-2')]) {
    const b = buildBrief(config, sanitizeTicket(config, t))
    assert.equal(by[t.key].score, b.score)
    assert.equal(by[t.key].gate, b.gate)
    assert.equal(by[t.key].biggestMissing, b.missing.filter(m => !b.omitted.has(m.key))[0]?.label ?? null)
  }
  assert.ok(by['ABC-1'].score > by['ABC-2'].score)
})
test('rows are sorted lowest score first, ties by key', () => {
  const r = evalTickets(loaded(), [good('ABC-3'), thin('ABC-9'), thin('ABC-10'), good('ABC-1')])
  assert.deepEqual(r.rows.map(x => x.key), ['ABC-9', 'ABC-10', 'ABC-1', 'ABC-3'])
})
test('a legacy ticket (prose, no Gherkin) is flagged legacy', () => {
  const r = evalTickets(loaded(), [raw('ABC-4', 'The export should download a file when the user clicks the button and show a message when there are no orders.')])
  assert.equal(typeof r.rows[0].legacy, 'boolean')
  assert.equal(r.rows[0].score, buildBrief(loaded(), sanitizeTicket(loaded(), raw('ABC-4', 'The export should download a file when the user clicks the button and show a message when there are no orders.'))).score)
})
test('fullstack: both sides are scored and the lower decides', () => {
  const config = loaded('fullstack')
  const t = good('ABC-5')
  const row = evalTickets(config, [t]).rows[0]
  const b = buildBrief(config, sanitizeTicket(config, t))
  assert.equal(row.score, b.score)
  if (b.sides) assert.equal(row.score, Math.min(...Object.values(b.sides).map(s => s.score)))
})
test('summary: passing count and rounded percent, rounded average', () => {
  const s = evalTickets(loaded(), [good('ABC-1'), thin('ABC-2'), thin('ABC-3')]).summary
  assert.equal(s.scored, 3)
  const passing = evalTickets(loaded(), [good('ABC-1'), thin('ABC-2'), thin('ABC-3')]).rows.filter(r => r.gate === 'pass').length
  assert.equal(s.passing, passing)
  assert.equal(s.passingPercent, Math.round((passing / 3) * 100))
  const scores = evalTickets(loaded(), [good('ABC-1'), thin('ABC-2'), thin('ABC-3')]).rows.map(r => r.score)
  assert.equal(s.average, Math.round(scores.reduce((a, b) => a + b, 0) / 3))
})
test('summary: top-3 missing items by count, ties broken by name, at most 3', () => {
  const s = evalTickets(loaded(), [thin('ABC-1'), thin('ABC-2'), good('ABC-3')]).summary
  assert.ok(s.mostMissing.length <= 3 && s.mostMissing.length >= 1)
  for (let i = 1; i < s.mostMissing.length; i++) {
    const a = s.mostMissing[i - 1], b = s.mostMissing[i]
    assert.ok(a.tickets > b.tickets || (a.tickets === b.tickets && a.item < b.item), `${a.item} before ${b.item}`)
  }
  assert.equal(s.mostMissing[0].tickets, 2)
})
test('an empty list gives an empty summary without dividing by zero', () => {
  const r = evalTickets(loaded(), [])
  assert.deepEqual(r.summary, { scored: 0, passing: 0, passingPercent: 0, average: 0, mostMissing: [], unreadFiles: 0, byTeam: [] })
  assert.equal(formatCard(r), 'No tickets to score.')
})
test('the card: one line per ticket, then the project lines', () => {
  const card = formatCard(evalTickets(loaded(), [good('ABC-1'), thin('ABC-2')]))
  const lines = card.split('\n')
  assert.match(lines[0], /^ABC-2 · \d+\/100 · refuse · missing: .+/)
  assert.match(lines[1], /^ABC-1 · \d+\/100 · (pass|refuse)/)
  assert.match(card, /^Project: 2 tickets scored$/m)
  assert.match(card, /^Passing: \d of 2 \(\d+%\)$/m)
  assert.match(card, /^Average score: \d+%$/m)
  assert.match(card, /^Most often missing: .+/m)
})
test('customer ids are redacted before scoring and never reach the output', () => {
  const id = `U${'7'.repeat(7)}`
  const r = evalTickets(loaded('vitest', { redact: { customerId: '\\bU\\d{5,}\\b' } }), [raw('ABC-1', `Customer ${id} cannot export.`)])
  assert.ok(!JSON.stringify(r).includes(id))
})

test('cli: prints the card and the machine line, exits 0 whatever the pass rate', () => {
  const d = proj()
  writeFileSync(join(d, 'r.json'), JSON.stringify([thin('ABC-1'), thin('ABC-2')]))
  const r = run(d, 'tickets-eval', '--in', '@r.json')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^ABC-1 · \d+\/100 · refuse/m)
  const m = r.stdout.split('\n').find(l => l.startsWith('TICKETS_EVAL_JSON:'))
  const j = JSON.parse(m.slice('TICKETS_EVAL_JSON:'.length))
  assert.equal(j.summary.scored, 2)
  assert.equal(j.tickets.length, 2)
})
test('cli --json prints only the machine line', () => {
  const d = proj()
  writeFileSync(join(d, 'r.json'), JSON.stringify([thin('ABC-1')]))
  const lines = run(d, 'tickets-eval', '--in', '@r.json', '--json').stdout.trim().split('\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith('TICKETS_EVAL_JSON:'))
})
test('cli: writes no per-ticket files unless --save', () => {
  const d = proj()
  writeFileSync(join(d, 'r.json'), JSON.stringify([thin('ABC-1')]))
  run(d, 'tickets-eval', '--in', '@r.json')
  assert.ok(!existsSync(join(d, '.quality-code/tickets')))
  assert.ok(existsSync(join(d, 'r.json')), 'any other input is left as it is')
  const list = '.quality-code/tickets/tickets-eval.json'
  mkdirSync(join(d, '.quality-code/tickets'), { recursive: true })
  writeFileSync(join(d, list), JSON.stringify([thin('ABC-1')]))
  run(d, 'tickets-eval', '--in', `@${list}`)
  assert.ok(!existsSync(join(d, list)), 'the search results the command wrote are removed once scored')
  rmSync(join(d, '.quality-code/tickets'), { recursive: true })
  assert.equal(run(d, 'tickets-eval', '--in', '@r.json', '--save').status, 0)
  assert.deepEqual(readdirSync(join(d, '.quality-code/tickets')), ['ABC-1'])
  assert.ok(existsSync(join(d, '.quality-code/tickets/ABC-1/ticket.json')))
})
test('cli: --save keeps the fill-in answers of a ticket already saved, and saves a key with "_"', () => {
  const d = proj()
  const saved = join(d, '.quality-code/tickets/ABC-1')
  mkdirSync(saved, { recursive: true })
  writeFileSync(join(saved, 'ticket.json'), JSON.stringify({ ...thin('ABC-1'), filled: [{ key: 'environment' }], sent: 1 }))
  writeFileSync(join(d, 'r.json'), JSON.stringify([thin('ABC-1'), thin('A_B-2')]))
  assert.equal(run(d, 'tickets-eval', '--in', '@r.json', '--save').status, 0)
  const t = JSON.parse(readFileSync(join(saved, 'ticket.json'), 'utf8'))
  assert.deepEqual([t.filled, t.sent], [[{ key: 'environment' }], 1])
  assert.ok(existsSync(join(d, '.quality-code/tickets/A_B-2/ticket.json')))
})
test('cli: --save keeps a configured ticketsDir (AGT-107)', () => {
  const d = proj({ ...cfg(), ticketsDir: '.claude/quality-code/tickets' })
  writeFileSync(join(d, 'r.json'), JSON.stringify([thin('ABC-1')]))
  assert.equal(run(d, 'tickets-eval', '--in', '@r.json', '--save').status, 0)
  assert.ok(existsSync(join(d, '.claude/quality-code/tickets/ABC-1/ticket.json')))
  assert.ok(!existsSync(join(d, '.quality-code')))
})
test('cli: bad input exits 2', () => {
  const d = proj()
  writeFileSync(join(d, 'obj.json'), '{"key":"ABC-1"}')
  writeFileSync(join(d, 'bad.json'), 'nope')
  assert.equal(run(d, 'tickets-eval').status, 2)
  assert.equal(run(d, 'tickets-eval', '--in', '@missing.json').status, 2)
  assert.equal(run(d, 'tickets-eval', '--in', '@bad.json').status, 2)
  const o = run(d, 'tickets-eval', '--in', '@obj.json')
  assert.equal(o.status, 2)
  assert.match(o.stderr, /JSON array/)
  assert.equal(run(d, 'tickets-eval', '--in', '[1]').status, 2)
})
test('cli: an empty array is fine', () => {
  const r = run(proj(), 'tickets-eval', '--in', '[]')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /No tickets to score/)
})
