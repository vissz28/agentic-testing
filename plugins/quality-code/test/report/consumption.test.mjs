import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRICES } from '../../lib/report/prices.mjs'
import { buildReport, fmtCost, fmtTokens, formatCard, parsePeriod } from '../../lib/report/consumption.mjs'
import { attribute, findProjectDirs, loadSessions } from '../../lib/report/transcripts.mjs'
import { NOW, install } from './helpers.mjs'

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
function report({ by = 'command', since = '2026-10-01', until = null, keySource } = {}) {
  const f = install()
  const found = findProjectDirs(f.root, f.configDir)
  const sessions = found.dirs.flatMap(d => loadSessions(d, found.sessions[d]))
  const usage = attribute(sessions, keySource ? { keySource } : {})
  return buildReport(usage, { period: parsePeriod({ since, until }, NOW), by, prices: PRICES, project: 'demo', priceInfo: { asOf: '2026-10-06', source: 's', override: null } })
}
const group = (r, name) => r.groups.find(g => g.name === name)

test('period: relative days end now, dates are whole UTC days, bad values refused', () => {
  const p = parsePeriod({ since: '7d' }, NOW)
  assert.equal(new Date(p.since).toISOString(), '2026-10-08T00:00:00.000Z')
  assert.equal(p.until, NOW)
  assert.equal(p.label, 'last 7 days')
  const q = parsePeriod({ since: '2026-10-01', until: '2026-10-10' }, NOW)
  assert.equal(new Date(q.until).toISOString(), '2026-10-11T00:00:00.000Z')
  assert.equal(q.label, '2026-10-01 to 2026-10-10')
  assert.throws(() => parsePeriod({ since: 'yesterday' }, NOW), /--since must be a date/)
  assert.throws(() => parsePeriod({ since: '30d', until: '2026-13-45' }, NOW), /--until must be a date/)
  assert.throws(() => parsePeriod({ since: '2026-10-10', until: '2026-10-01' }, NOW), /after/)
  assert.throws(() => parsePeriod({ since: '2026-02-31' }, NOW), /--since must be a date/)
  const back = parsePeriod({ until: '2026-08-31' }, NOW)
  assert.equal(back.label, '2026-08-02 to 2026-08-31', '30d counts back from --until, not from today')
  assert.equal(parsePeriod({ since: '7d', until: '2026-10-01' }, NOW).label, '2026-09-25 to 2026-10-01')
})

test('totals by command: runs, requests, tokens, cost, and cost per run', () => {
  const r = report()
  assert.equal(r.totals.runs, 3)
  assert.equal(r.totals.sessions, 2)
  assert.equal(r.totals.requests, 6)
  assert.deepEqual(r.groups.map(g => [g.name, g.runs, g.requests]), [['check', 2, 4], ['start', 1, 2]])
  const check = group(r, 'check')
  assert.deepEqual(check.tokens, { input: 2000, output: 4000, cacheWrite: 2000, cacheRead: 10000 })
  close(check.cost, 0.039 + 0.012 + 0.02 + 0.02)
  close(check.costPerRun, 0.091 / 2)
  assert.equal(check.costPartial, false)
})

test('other usage is kept apart from the plugin totals', () => {
  const r = report()
  assert.equal(r.other.requests, 3)
  close(r.other.cost, 3 * 0.00204)
  assert.equal(r.other.runs, 0)
})

test('an unknown model: tokens counted, cost marked unknown, never guessed', () => {
  const r = report()
  const start = group(r, 'start')
  assert.equal(start.tokens.input, 500 + 1000)
  close(start.cost, 0.006)
  assert.equal(start.costPartial, true)
  assert.deepEqual(r.unknownModels, ['claude-unknown-9'])
  const m = group(report({ by: 'model' }), 'claude-unknown-9')
  assert.equal(m.cost, null)
  assert.equal(m.costPerRun, null)
})

test('period filter: a run counts on the day it started, with all its usage', () => {
  assert.equal(report({ since: '2026-10-11' }).totals.runs, 2)
  const r = report({ since: '2026-10-10', until: '2026-10-10' })
  assert.equal(r.totals.runs, 1)
  assert.equal(r.totals.requests, 3, 'the subagent working after the next prompt still counts')
  assert.equal(r.other.requests, 2)
  assert.equal(report({ since: '30d' }).totals.runs, 3)
  assert.equal(report({ since: '2026-08-01' }).totals.runs, 4)
})

test('by ticket, by day, by model', () => {
  assert.deepEqual(report({ by: 'ticket', since: '2026-08-01' }).groups.map(g => g.name).sort(), ['ABC-12', 'ABC-34', 'XYZ-7', 'no ticket'])
  assert.deepEqual(report({ by: 'ticket', since: '2026-08-01', keySource: '(?:ABC)-\\d+' }).groups.map(g => g.name).sort(), ['ABC-12', 'ABC-34', 'no ticket'])
  assert.deepEqual(report({ by: 'day' }).groups.map(g => [g.name, g.runs]), [['2026-10-10', 1], ['2026-10-11', 1], ['2026-10-12', 1]])
  const m = report({ by: 'model' })
  assert.deepEqual(m.groups.map(g => g.name).sort(), ['claude-haiku-4-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-unknown-9'])
  assert.equal(group(m, 'claude-opus-5-5').runs, 2)
})

test('number formats', () => {
  assert.equal(fmtTokens(999), '999')
  assert.equal(fmtTokens(1234), '1.2k')
  assert.equal(fmtTokens(45678), '46k')
  assert.equal(fmtTokens(1234567), '1.2M')
  assert.equal(fmtCost(null), 'unknown price')
  assert.equal(fmtCost(0.004), '<$0.01')
  assert.equal(fmtCost(1.234, true), '$1.23 + unknown')
})

test('the card: title, totals, table, other line, disclaimer, machine line last', () => {
  const lines = formatCard(report()).split('\n')
  assert.equal(lines[0], 'quality-code consumption · 2026-10-01 to 2026-10-14 · demo')
  assert.ok(lines.some(l => l.startsWith('Runs      3 runs in 2 sessions · 6 API requests')))
  assert.ok(lines.some(l => l.startsWith('Cost      $0.10 + unknown estimated')))
  assert.ok(lines.some(l => /^By command\s+runs\s+in\s+out\s+cache\s+cost\s+per run$/.test(l)))
  assert.ok(lines.some(l => /^ {2}check\s+2\s+2\.0k\s+4\.0k\s+12k\s+\$0\.09\s+\$0\.05$/.test(l)))
  assert.ok(lines.some(l => l.startsWith('Other (not quality-code): 3 requests')))
  assert.ok(lines.includes('Unknown price for claude-unknown-9: tokens counted, no cost.'))
  assert.ok(lines.some(l => /^Estimate at API list prices as of 2026-10-06 .*subscription plans are not billed this way\.$/.test(l)))
  assert.ok(lines.at(-1).startsWith('CONSUMPTION_JSON:{'))
  assert.equal(JSON.parse(lines.at(-1).slice('CONSUMPTION_JSON:'.length)).totals.runs, 3)
})

test('no runs in the period: says so and still shows the other line', () => {
  const card = formatCard(report({ since: '2026-10-13' }))
  assert.match(card, /No quality-code runs from 2026-10-13 to 2026-10-14\./)
  assert.match(card, /Other \(not quality-code\): 0 requests/)
})
