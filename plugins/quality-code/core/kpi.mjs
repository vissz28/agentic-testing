#!/usr/bin/env node
// Entry point for /quality-code:kpi: the rollup of the local audit log and the boundary log.
// node core/kpi.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--json]
// Reads local files only and sends nothing anywhere. Exit 0 ok, 2 usage error, 3 no audit data yet.
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUDIT_DIR, KINDS, readAudit, readJsonl } from './audit.mjs'
import { BOUNDARY_LOG } from './checks/boundary.mjs'
import { projectRoot } from './config.mjs'
import { parsePeriod } from './consumption/report.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'

const USAGE = 'usage: kpi.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--json]'
const RUBRICS = { vitest, playwright }
const BANDS = [['0-29', 0, 29], ['30-49', 30, 49], ['50-69', 50, 69], ['70-89', 70, 89], ['90-100', 90, 100]]
const VERDICTS = { green: 'green', checks_failed: 'checks failed', tests_red: 'tests red', not_verified: 'not verified' }
const day = ms => new Date(ms).toISOString().slice(0, 10)

function parse(argv) {
  const a = { since: '30d', until: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--since' || x === '--until') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json') a.json = true
    else throw new Error(`unknown option ${x}`)
  }
  return a
}

/** Every event of every kind, plus the boundary log, and the places read. */
export function loadEvents(root) {
  const events = Object.fromEntries(KINDS.map(k => [k, readAudit(root, k)]))
  events.boundary = readJsonl(join(root, BOUNDARY_LOG))
  events.looked = [`${join(root, AUDIT_DIR)}/`, join(root, BOUNDARY_LOG)]
  return events
}

// The short name of a criterion: its rubric label up to the first bracket, colon, dash or comma.
function criterionLabel(key, rubric) {
  const label = (RUBRICS[rubric] ?? vitest).weights[key]?.[1] ?? vitest.weights[key]?.[1] ?? playwright.weights[key]?.[1]
  return label ? label.split(/ \(| — |:|,/)[0].trim() : key
}

const countBy = (list, f) => list.reduce((m, x) => { const k = f(x); if (k !== null && k !== undefined) m.set(k, (m.get(k) ?? 0) + 1); return m }, new Map())
const ranked = m => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))

/** The report object behind the card and KPI_JSON. */
export function buildKpi(events, { period, project }) {
  const at = e => Date.parse(e.date ?? e.ts)
  const inPeriod = e => { const t = at(e); return t >= period.since && t < period.until }
  const pick = k => (events[k] ?? []).filter(inPeriod).sort((a, b) => at(a) - at(b))
  const [gates, runs, jira, overrides, blocked] = ['gate', 'pipeline', 'jira', 'override', 'boundary'].map(pick)

  // One ticket per key; an evaluation without a key is its own ticket.
  const tickets = new Map()
  gates.forEach((g, i) => {
    const id = g.key ?? `#${i}`
    if (!tickets.has(id)) tickets.set(id, [])
    tickets.get(id).push(g)
  })
  const finals = [...tickets.values()].map(list => list.at(-1))
  const missing = new Map()
  let filledThenPassed = 0
  for (const list of tickets.values()) {
    const lastRefuse = list.findLast(g => g.gate === 'refuse')
    for (const key of new Set(lastRefuse?.missing ?? [])) {
      if (!missing.has(key)) missing.set(key, { key, label: criterionLabel(key, lastRefuse.rubric), tickets: 0 })
      missing.get(key).tickets++
    }
    const firstRefuse = list.findIndex(g => g.gate === 'refuse')
    if (firstRefuse >= 0 && list.slice(firstRefuse + 1).some(g => g.gate === 'pass' && g.filled > 0)) filledThenPassed++
  }
  const scores = Object.fromEntries(BANDS.map(([name, lo, hi]) => [name, finals.filter(g => g.score >= lo && g.score <= hi).length]))
  const verdicts = Object.fromEntries(Object.keys(VERDICTS).map(v => [v, runs.filter(r => r.verdict === v).length]))
  const since = day(period.since)
  const until = day(period.until - 1)
  return {
    project,
    period: { since, until, label: period.label },
    gate: {
      evaluations: gates.length,
      tickets: tickets.size,
      passed: finals.filter(g => g.gate === 'pass').length,
      refused: finals.filter(g => g.gate === 'refuse').length,
      scores,
      missing: [...missing.values()].sort((a, b) => b.tickets - a.tickets || (a.key < b.key ? -1 : 1)).slice(0, 3),
      filledThenPassed,
    },
    jira: { comments: jira.filter(j => j.action === 'comment').length, updates: jira.filter(j => j.action === 'update').length, risks: jira.filter(j => j.action === 'risk').length },
    forced: { runs: overrides.length, tickets: [...new Set(overrides.map(o => o.key).filter(Boolean))].sort() },
    pipeline: { runs: runs.length, verdicts, decidedBy: ranked(countBy(runs, r => r.decidedBy)).map(([check, n]) => ({ check, runs: n })) },
    boundary: { blocked: blocked.length },
    consumption: `/quality-code:consumption --since ${since} --until ${until}`,
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const row = (name, text) => `${name.padEnd(12)}${text}`

export function formatKpiCard(r) {
  const g = r.gate
  const lines = [`quality-code KPI · ${r.period.label} · ${r.project}`, '']
  if (!g.evaluations) lines.push(row('Gate', 'no ticket gated'))
  else {
    lines.push(row('Gate', `${plural(g.tickets, 'ticket')} · ${g.passed} passed · ${g.refused} refused · ${plural(g.evaluations, 'evaluation')}`))
    lines.push(row('Scores', Object.entries(g.scores).map(([band, n]) => `${band}: ${n}`).join(' · ')))
    if (g.missing.length) lines.push(row('Missing', g.missing.map(m => `${m.label} ${m.tickets}`).join(' · ')))
    if (g.filledThenPassed) lines.push(row('Filled in', `${plural(g.filledThenPassed, 'refused ticket')} filled in here, then passed`))
  }
  const j = r.jira
  lines.push(row('Jira', j.comments || j.updates || j.risks ? `${plural(j.comments, 'comment')} posted · ${plural(j.updates, 'ticket')} updated${j.risks ? ` · ${plural(j.risks, 'risk note')}` : ''}` : 'nothing posted'))
  const f = r.forced
  lines.push(row('Forced', f.runs ? `${plural(f.runs, 'run')} past the gate (continue anyway)${f.tickets.length ? `: ${f.tickets.join(', ')}` : ''}` : 'none'))
  const p = r.pipeline
  if (!p.runs) lines.push(row('Pipeline', 'no run'))
  else {
    lines.push(row('Pipeline', [plural(p.runs, 'run'), ...Object.entries(VERDICTS).map(([v, name]) => `${p.verdicts[v]} ${name}`)].join(' · ')))
    if (p.decidedBy.length) lines.push(row('Decided by', p.decidedBy.map(d => `${d.check} ${d.runs}`).join(' · ')))
  }
  lines.push(row('Boundary', r.boundary.blocked ? `${plural(r.boundary.blocked, 'write')} blocked` : 'no write blocked'))
  lines.push('', `AI cost: ${r.consumption}`)
  lines.push(`KPI_JSON:${JSON.stringify(r)}`)
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { now = Date.now(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  let a, period
  try {
    a = parse(argv)
    period = parsePeriod(a, now)
  } catch (e) { stderr(`${e.message}. ${USAGE}\n`); return 2 }
  const root = projectRoot(env, cwd)
  const events = loadEvents(root)
  if (![...KINDS, 'boundary'].some(k => events[k].length)) {
    stdout(`No quality-code audit data yet for ${root}.\nLooked in:\n${events.looked.map(l => `  ${l}`).join('\n')}\nThe log fills as tickets are gated and checks run.\n`)
    return 3
  }
  const report = buildKpi(events, { period, project: basename(root) })
  stdout(`${a.json ? JSON.stringify(report) : formatKpiCard(report)}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
