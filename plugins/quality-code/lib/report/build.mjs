// Builds the one-file HTML reports (--report) of /quality-code:report --kpi, tickets-eval and consumption from the
// numbers those commands already compute. Only keys, scores and numbers go in: every text is redacted and a
// ticket key is shown only when it has the shape of one. Never ticket text, never a path.
import { redact } from '../ticket/sanitize.mjs'
import { columns, gauge, hbar, legend, line } from './charts.mjs'
import { card, empty, esc, grid, page, tiles } from './page.mjs'
import { fmtCost, fmtTokens } from './consumption.mjs'

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const CUSTOMER_ID = /\bU\d{5,}\b/g
const DAY = 86400000
const MAX_DAYS = 31
const VERDICTS = [['green', 'green', 'pass'], ['checks_failed', 'checks failed', 'warn'], ['tests_red', 'tests red', 'fail'], ['not_verified', 'not verified', 'idle']]
const BANDS = [['0-29', 0, 29, 'fail'], ['30-49', 30, 49, 'fail'], ['50-69', 50, 69, 'warn'], ['70-89', 70, 89, 'pass'], ['90-100', 90, 100, 'pass']]
const FOOT = 'Keys, scores and numbers only. Built on this machine; nothing was sent anywhere.'

/** Text that may reach the page: redacted with the config's patterns, and any customer id masked. */
export const safe = (config, text) => redact(config, String(text ?? '')).replace(CUSTOMER_ID, 'U######')
/** A ticket key as shown: the key when it is one, else a neutral word. */
export const safeKey = (config, key) => (KEY.test(String(key ?? '')) ? safe(config, key) : 'no ticket')

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)
const dayOf = ms => new Date(ms).toISOString().slice(0, 10)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const word = (n, one, many = `${one}s`) => (n === 1 ? one : many)

/** What the kpi charts need beyond the report: verdicts per day, the pass rate per ticket, mutation per run. */
export function kpiSeries(events, period) {
  const at = e => Date.parse(e.date ?? e.ts)
  const runs = (events.pipeline ?? []).filter(e => at(e) >= period.since && at(e) < period.until).sort((a, b) => at(a) - at(b))
  const last = Math.floor((period.until - 1) / DAY) * DAY
  const first = Math.max(Math.floor(period.since / DAY) * DAY, last - (MAX_DAYS - 1) * DAY)
  const days = []
  for (let t = first; t <= last; t += DAY) days.push({ day: dayOf(t), counts: Object.fromEntries(VERDICTS.map(([v]) => [v, 0])) })
  const byDay = new Map(days.map(d => [d.day, d]))
  const tickets = new Map()
  for (const r of runs) {
    const d = byDay.get(dayOf(at(r)))
    if (d && r.verdict in d.counts) d.counts[r.verdict]++
    if (!KEY.test(r.key ?? '')) continue
    const t = tickets.get(r.key) ?? { key: r.key, runs: 0, green: 0 }
    t.runs++
    if (r.verdict === 'green') t.green++
    tickets.set(r.key, t)
  }
  const kill = s => (typeof s?.score === 'number' ? s.score : s?.total > 0 && typeof s.killed === 'number' ? Math.round((100 * s.killed) / s.total) : null)
  return {
    days,
    truncated: first > Math.floor(period.since / DAY) * DAY,
    tickets: [...tickets.values()].map(t => ({ ...t, percent: pct(t.green, t.runs) })),
    mutation: runs.map(r => ({ day: dayOf(at(r)), value: kill((r.steps ?? []).find(s => s.check === 'mutation')) })).filter(m => m.value !== null),
  }
}

/** The headline number the chat's small gauge card shows: { label, value, unit } or null. */
function headline(label, value, unit = '%') {
  return typeof value === 'number' ? { label, value, unit } : null
}

/** { html, headline } for /quality-code:report --kpi. `report` is buildKpi's object, `series` is kpiSeries'. */
export function kpiReport(report, series, { config = null, now = new Date() } = {}) {
  const s = t => safe(config, t)
  const g = report.gate
  const p = report.pipeline
  const q = report.quality
  const nothing = !g.evaluations && !p.runs && !report.jira.comments && !report.jira.updates && !report.forced.runs && !report.boundary.blocked
  const sub = `${s(report.project)} · ${s(report.period.label)} (${report.period.since} to ${report.period.until})`
  if (nothing) {
    return { html: page({ title: 'Quality Code KPI', subtitle: sub, body: empty('No tickets gated and no pipeline run in this period. The charts fill as tickets are gated and checks run.'), foot: FOOT }), headline: null }
  }
  const trend = columns(series.days.map(d => ({ label: d.day.slice(5), parts: VERDICTS.map(([v, name, tone]) => ({ tone, name, value: d.counts[v] })) })), { name: 'Pipeline verdicts per day', emptyText: 'No pipeline run in this period.' })
  const perTicket = [...series.tickets].sort((a, b) => b.runs - a.runs || a.percent - b.percent || a.key.localeCompare(b.key, 'en', { numeric: true })).slice(0, 12)
  const bandTone = Object.fromEntries(BANDS.map(([n, , , tone]) => [n, tone]))
  const dist = hbar(BANDS.map(([name]) => ({ label: name, value: g.scores[name] ?? 0, tone: bandTone[name] })), { name: 'Readiness score distribution', emptyText: 'No ticket gated in this period.' })
  const traceNote = q?.traceability ? `${q.traceability.traced} of ${q.traceability.specs} spec files name a ticket` : 'no project config to find the specs'
  const t = q?.targets ?? {}
  const gauges = q ? [
    gauge(q.traceability?.pct ?? null, { label: 'Traceability', target: t.traceability ?? null }),
    gauge(q.completeness.mean, { label: 'Completeness (mean score)', target: t.completeness ?? null, unit: '' }),
    gauge(q.suiteHonesty?.pct ?? null, { label: 'Suite honesty', target: t.suiteHonesty ?? null }),
    gauge(q.gateIntegrity.runs ? q.gateIntegrity.pct : null, { label: 'Gate integrity', target: t.gateIntegrity ?? null }),
    gauge(q.adoption.ready ? q.adoption.pct : null, { label: 'Adoption', target: t.adoption ?? null }),
    gauge(q.coverage?.pct ?? null, { label: 'Line coverage', target: t.coverage ?? null }),
    gauge(q.mutation.mean, { label: 'Mutation kill rate (mean)' }),
  ] : []
  const body = [
    tiles([
      [g.tickets, word(g.tickets, 'ticket gated', 'tickets gated')],
      [`${g.passed} / ${g.refused}`, 'passed / refused'],
      [p.runs, word(p.runs, 'pipeline run')],
      [report.forced.runs, 'forced past the gate'],
      [report.boundary.blocked, word(report.boundary.blocked, 'write blocked', 'writes blocked')],
    ]),
    grid([
      card('Verdict trend', trend + legend(VERDICTS.map(([, name, tone]) => [tone, name])), { wide: true, note: series.truncated ? `The last ${MAX_DAYS} days of the period.` : '' }),
      card('Pass rate per ticket', hbar(perTicket.map(x => ({ label: safeKey(config, x.key), value: x.percent, text: `${x.percent}% of ${x.runs}`, tone: x.percent >= 70 ? 'pass' : x.percent > 0 ? 'warn' : 'fail' })), { max: 100, name: 'Green runs per ticket', emptyText: 'No pipeline run with a ticket key in this period.' }), { note: 'Share of a ticket\'s pipeline runs that ended green (up to 12 tickets with the most runs).' }),
      card('Readiness score distribution', dist, { note: `Final score of ${plural(g.tickets, 'ticket')}; the gate passes at 70.` }),
      card('Mutation kill rate per run', line(series.mutation.map(m => ({ label: m.day.slice(5), value: m.value })), { name: 'Mutation kill rate per run', emptyText: 'No run had assertions to mutate yet.' })),
      ...(g.missing.length ? [card('Most often missing', hbar(g.missing.map(m => ({ label: s(m.label), value: m.tickets, tone: 'warn' })), { name: 'Most often missing' }), { note: 'Criteria missing on the most refused tickets.' })] : []),
    ]),
    q ? `<h2>Quality Program</h2>${grid(gauges.map(x => `<div class="card">${x}</div>`))}<p class="note">Traceability: ${esc(traceNote)}.</p>` : '',
  ].join('\n')
  return {
    html: page({ title: 'Quality Code KPI', subtitle: sub, body, foot: `${FOOT} Generated ${now.toISOString().slice(0, 10)}.` }),
    headline: headline('Gate integrity', q?.gateIntegrity.runs ? q.gateIntegrity.pct : null) ?? headline('Tickets passing', g.tickets ? pct(g.passed, g.tickets) : null),
  }
}

/** { html, headline } for /quality-code:ticket --eval. `result` is evalTickets' { rows, summary }. */
export function ticketsEvalReport({ rows, summary }, { config = null, project = null, now = new Date() } = {}) {
  const s = t => safe(config, t)
  const sub = `${project ? `${s(project)} · ` : ''}${plural(summary.scored, 'ticket')} scored · ${now.toISOString().slice(0, 10)}`
  if (!rows.length) return { html: page({ title: 'Tickets readiness', subtitle: sub, body: empty('No tickets were scored.'), foot: FOOT }), headline: null }
  const shown = rows.slice(0, 40)
  const bands = BANDS.map(([name, lo, hi, tone]) => ({ label: name, value: rows.filter(r => r.score >= lo && r.score <= hi).length, tone }))
  const body = [
    tiles([
      [summary.scored, 'tickets scored'],
      [`${summary.passing} of ${summary.scored}`, 'pass the gate'],
      [`${summary.average}%`, 'average score'],
    ]),
    grid([
      card('Passing', gauge(summary.passingPercent, { label: 'Tickets passing the gate', target: 100 })),
      card('Score distribution', hbar(bands, { name: 'Tickets per score band' }), { note: 'The gate passes at 70.' }),
      card('Score per ticket', hbar(shown.map(r => ({ label: safeKey(config, r.key), value: r.score, text: `${r.score}%`, tone: r.gate === 'pass' ? 'pass' : r.score >= 50 ? 'warn' : 'fail' })), { max: 100, marker: 70, name: 'Readiness score per ticket' }), { wide: true, note: rows.length > shown.length ? `The ${shown.length} lowest scores of ${rows.length}. The dashed line is the 70-point gate.` : 'Lowest first. The dashed line is the 70-point gate.' }),
      card('Most often missing', hbar(summary.mostMissing.map(m => ({ label: s(m.item), value: m.tickets, tone: 'warn' })), { name: 'Most often missing', emptyText: 'Nothing is missing.' })),
      ...(summary.byTeam?.length ? [card('Pass rate per component', hbar(summary.byTeam.map(x => ({ label: s(x.team), value: x.passingPercent, text: `${x.passingPercent}% of ${x.scored}`, tone: x.passingPercent >= 70 ? 'pass' : 'warn' })), { max: 100, name: 'Pass rate per component' }))] : []),
    ]),
  ].join('\n')
  return { html: page({ title: 'Tickets readiness', subtitle: sub, body, foot: FOOT }), headline: headline('Tickets passing', summary.passingPercent) }
}

const toneOf = (tones, i) => tones[i % tones.length]
const TONES = ['accent', 'pass', 'warn', 'fail', 'idle']

/** { html, headline } for /quality-code:report --cost. `reports` holds buildReport's object by command, day and model. */
export function consumptionReport(reports, { config = null, now = new Date() } = {}) {
  const s = t => safe(config, t)
  const base = reports.command ?? reports.day ?? reports.model
  const t = base.totals
  const sub = `${s(base.project)} · ${s(base.period.label)} (${base.period.since} to ${base.period.until})`
  if (!t.runs) return { html: page({ title: 'Quality Code consumption', subtitle: sub, body: empty(`No quality-code runs from ${base.period.since} to ${base.period.until}.`), foot: FOOT }), headline: null }
  const costs = (r, f = x => x.name) => (r?.groups ?? []).map((x, i) => ({ label: s(f(x)), value: x.cost ?? 0, text: fmtCost(x.cost, x.costPartial), tone: toneOf(TONES, i) }))
  const perDay = (reports.day?.groups ?? []).map(x => ({ label: x.name.slice(5), parts: [{ tone: 'accent', name: 'cost', value: x.cost ?? 0 }] }))
  const body = [
    tiles([
      [t.runs, word(t.runs, 'run')],
      [fmtCost(t.cost, t.costPartial), 'estimated cost'],
      [t.costPerRun === null ? '-' : fmtCost(t.costPerRun, t.costPartial), 'per run'],
      [fmtTokens(t.tokens.input + t.tokens.output), 'tokens in + out'],
      [fmtTokens(t.tokens.cacheRead + t.tokens.cacheWrite), 'cache tokens'],
    ]),
    grid([
      card('Cost per day', columns(perDay, { name: 'Estimated cost per day', unit: ' USD', emptyText: 'No cost in this period.' }), { wide: true, note: 'Days are UTC; dollars at API list prices.' }),
      card('Cost by command', hbar(costs(reports.command), { name: 'Estimated cost by command', emptyText: 'No cost in this period.' })),
      card('Cost by model', hbar(costs(reports.model), { name: 'Estimated cost by model', emptyText: 'No cost in this period.' })),
    ]),
    `<p class="note">${esc(`Estimate at API list prices as of ${base.prices?.asOf ?? 'an unknown date'}; subscription plans are not billed this way.${base.unknownModels?.length ? ` No price for ${base.unknownModels.map(s).join(', ')}: tokens counted, no cost.` : ''}`)}</p>`,
  ].join('\n')
  return { html: page({ title: 'Quality Code consumption', subtitle: sub, body, foot: FOOT }), headline: headline('Estimated cost', t.cost === null ? null : Math.round(t.cost * 100) / 100, ' USD') }
}
