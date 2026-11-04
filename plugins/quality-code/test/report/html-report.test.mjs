// The HTML report (--report): self-contained, redacted, saved where the place rules say.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consumptionReport, kpiReport, kpiSeries, safe, safeKey, ticketsEvalReport } from '../../lib/report/build.mjs'
import { columns, gauge, hbar } from '../../lib/report/charts.mjs'
import { esc } from '../../lib/report/page.mjs'
import { reportPath, reportsRoot, saveReport } from '../../lib/report/save.mjs'
import { buildKpi } from '../../bin/kpi.mjs'
import { buildReport, parsePeriod } from '../../lib/report/consumption.mjs'
import { evalTickets } from '../../lib/ticket/batch.mjs'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const period = parsePeriod({ since: '30d' }, NOW)
const CUSTOMER = `U${'12345'}`
const day = d => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`

const EVENTS = {
  gate: [
    { key: 'ABC-1', score: 40, gate: 'refuse', rubric: 'vitest', missing: ['ac_present'], filled: 0, date: day(2) },
    { key: 'ABC-1', score: 85, gate: 'pass', rubric: 'vitest', missing: [], filled: 1, date: day(3) },
    { key: 'ABC-2', score: 92, gate: 'pass', rubric: 'vitest', missing: [], filled: 0, date: day(4) },
  ],
  pipeline: [
    { key: 'ABC-1', verdict: 'green', decidedBy: null, steps: [{ check: 'mutation', killed: 8, total: 10 }], date: day(3) },
    { key: 'ABC-2', verdict: 'checks_failed', decidedBy: 'mutation', steps: [{ check: 'mutation', score: 55 }], date: day(4) },
    { key: 'ABC-2', verdict: 'tests_red', decidedBy: 'tests', steps: [], date: day(5) },
    { key: 'ABC-2', verdict: 'green', decidedBy: null, steps: [], date: day(6) },
  ],
  jira: [], override: [], fill: [], boundary: [],
}

// No external reference of any kind: no script, link, image, font, import or URL.
function assertSelfContained(html) {
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/)
  assert.match(html, /prefers-color-scheme:dark/)
  assert.match(html, /--bg:/)
  assert.doesNotMatch(html, /https?:|\/\/[a-z]/i)
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|<object|<embed|@import|@font-face|url\(|\ssrc=|\shref=/i)
  assert.doesNotMatch(html, /\son[a-z]+=/i)
  assert.equal((html.match(/<svg/g) ?? []).length, (html.match(/<\/svg>/g) ?? []).length)
  assert.match(html, /<title>[^<]+<\/title>/)
}

test('kpi report: valid, self-contained, with the charts', () => {
  const report = buildKpi(EVENTS, { period, project: 'demo' })
  const { html, headline } = kpiReport(report, kpiSeries(EVENTS, period), { now: new Date(NOW) })
  assertSelfContained(html)
  for (const t of ['Verdict trend', 'Pass rate per ticket', 'Readiness score distribution', 'Mutation kill rate per run', 'Quality Program']) assert.ok(html.includes(t), t)
  assert.ok(html.includes('ABC-2'))
  assert.equal(headline.label, 'Tickets passing')
})
test('kpi series: verdicts per day, pass rate per ticket, mutation per run', () => {
  const s = kpiSeries(EVENTS, period)
  assert.equal(s.days.length, 30)
  assert.deepEqual(s.days.find(d => d.day === '2026-10-04').counts, { green: 0, checks_failed: 1, tests_red: 0, not_verified: 0 })
  assert.deepEqual(s.tickets.find(t => t.key === 'ABC-2'), { key: 'ABC-2', runs: 3, green: 1, percent: 33 })
  assert.deepEqual(s.mutation.map(m => m.value), [80, 55])
})
test('kpi report: empty data shows an empty state, not blank charts', () => {
  const empty = { gate: [], pipeline: [], jira: [], override: [], fill: [], boundary: [] }
  const { html, headline } = kpiReport(buildKpi(empty, { period, project: 'demo' }), kpiSeries(empty, period))
  assertSelfContained(html)
  assert.match(html, /class="empty"/)
  assert.match(html, /No tickets gated and no pipeline run/)
  assert.equal(headline, null)
})
test('kpi report: a chart with no data says so', () => {
  const only = { ...EVENTS, pipeline: [] }
  const { html } = kpiReport(buildKpi(only, { period, project: 'demo' }), kpiSeries(only, period))
  assert.match(html, /No pipeline run in this period/)
  assert.match(html, /No pipeline run with a ticket key/)
})

const RAW = [
  { key: 'ABC-1', issuetype: 'Story', summary: 'SECRET summary text', labels: [], components: [`Team ${CUSTOMER}`, 'x'], text: { description: 'Private description words here.' }, attachments: 0 },
  { key: 'ABC-2', issuetype: 'Bug', summary: 's', labels: [], components: ['Core'], text: { description: 'Broken.' }, attachments: 0 },
]
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null }, languages: ['en'], features: [], redact: { customerId: '\\bU\\d{5,}\\b' } }

test('tickets-eval report: charts, no ticket text, customer ids redacted', () => {
  const r = evalTickets(CFG, RAW)
  const { html, headline } = ticketsEvalReport(r, { config: CFG, project: 'ABC', now: new Date(NOW) })
  assertSelfContained(html)
  for (const t of ['Score per ticket', 'Score distribution', 'Most often missing', 'Tickets passing']) assert.ok(html.includes(t), t)
  assert.ok(!html.includes('SECRET') && !html.includes('Private description'))
  assert.ok(!html.includes(CUSTOMER))
  assert.equal(typeof headline.value, 'number')
})
test('tickets-eval report: a component name with a customer id is masked', () => {
  const r = { rows: [{ key: 'ABC-1', score: 80, gate: 'pass', missing: [] }], summary: { scored: 1, passing: 1, passingPercent: 100, average: 80, mostMissing: [], byTeam: [{ team: `Team ${CUSTOMER}`, scored: 1, passing: 1, passingPercent: 100 }] } }
  const { html } = ticketsEvalReport(r, { config: null })
  assert.ok(!html.includes(CUSTOMER))
  assert.ok(html.includes('Team U######'))
})
test('tickets-eval report: empty list shows an empty state', () => {
  const { html } = ticketsEvalReport(evalTickets(CFG, []), { config: CFG })
  assertSelfContained(html)
  assert.match(html, /No tickets were scored/)
})
test('consumption report: cost by command, day and model; empty state', () => {
  const run = { command: 'kpi', key: 'ABC-1', start: NOW - 86400000, sessionId: 's' }
  const usage = { runs: [run], events: [{ run, t: NOW - 86400000, model: 'm1', tokens: { input: 1000, output: 500, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } }] }
  const prices = { m1: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 } }
  const mk = by => buildReport(usage, { period, by, prices, project: 'demo', priceInfo: { asOf: '2026-10-01', source: 'x', override: null } })
  const { html } = consumptionReport({ command: mk('command'), day: mk('day'), model: mk('model') }, { now: new Date(NOW) })
  assertSelfContained(html)
  for (const t of ['Cost per day', 'Cost by command', 'Cost by model']) assert.ok(html.includes(t), t)
  const none = buildReport({ runs: [], events: [] }, { period, by: 'command', prices: {}, project: 'demo', priceInfo: { asOf: null } })
  const e = consumptionReport({ command: none })
  assertSelfContained(e.html)
  assert.match(e.html, /No quality-code runs/)
})

test('redaction: configured patterns and bare customer ids never reach the page; keys keep their shape only', () => {
  assert.equal(safe(CFG, `id ${CUSTOMER}`), 'id U######')
  assert.equal(safe(null, `id ${CUSTOMER}`), 'id U######')
  assert.equal(safe({ redact: { token: 'tok_\\w+' } }, 'a tok_abc1'), 'a [redacted:token]')
  assert.equal(safeKey(CFG, 'ABC-12'), 'ABC-12')
  assert.equal(safeKey(CFG, `<b>${CUSTOMER}</b>`), 'no ticket')
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
})
test('charts: markup is escaped and empty inputs give an empty state', () => {
  assert.match(hbar([]), /class="empty"/)
  assert.match(columns([{ label: 'a', parts: [{ tone: 'pass', value: 0 }] }]), /class="empty"/)
  assert.ok(!hbar([{ label: '<script>', value: 1 }]).includes('<script>'))
  assert.match(gauge(null, { label: 'X' }), /no data/)
  assert.match(gauge(80, { label: 'X', target: 70 }), /t-pass/)
  assert.match(gauge(50, { label: 'X', target: 70 }), /t-warn/)
})

test('placement: <ticketsDir>/reports/<kind>-<date>.html, only for a known kind and a real date', () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-rep-'))
  const dir = reportsRoot(root, { ok: true, config: { ticketsDir: '.quality-code/tickets' } })
  assert.equal(dir, join(root, '.quality-code/tickets/reports'))
  const p = saveReport(dir, 'kpi', '2026-10-14', '<!doctype html>')
  assert.equal(p, join(dir, 'kpi-2026-10-14.html'))
  assert.ok(existsSync(p))
  assert.equal(reportPath(dir, '../x', '2026-10-14'), null)
  assert.equal(reportPath(dir, 'kpi', '../../etc'), null)
  assert.throws(() => saveReport(dir, 'kpi', 'today', ''))
  const out = mkdtempSync(join(tmpdir(), 'qc-out-'))
  assert.equal(reportsRoot(root, { ok: true, config: { ticketsDir: out } }), join(out, 'reports'))
  assert.equal(readFileSync(p, 'utf8'), '<!doctype html>')
})
