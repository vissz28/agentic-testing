// The Quality Program numbers (its §9) a repo can show by itself, as the old in-repo kpi.mjs did:
// traceability, completeness of the tickets, suite honesty, gate integrity, adoption, coverage and the
// mutation kill rate. Each is a number or "no data", never a made-up 100%.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { layersOf } from '../base/config.mjs'
import { e2eFolder } from '../base/e2e-folder.mjs'
import { dialectFor } from '../base/dialects/index.mjs'
import { keySource } from '../base/keys.mjs'
import { grade } from '../pipeline/checks/suite-honesty.mjs'
import { adaptersOf, asAdapter } from '../base/stack.mjs'

// ponytail: fixed targets, the Quality Program's defaults; a config field when a team needs its own.
export const TARGETS = Object.freeze({ traceability: 100, completeness: 95, suiteHonesty: 100, gateIntegrity: 100, coverage: 80, adoption: null })
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/
const SKIP = new Set(['node_modules', '.git', 'dist'])
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null)

function specsIn(root, folder, budget = { n: 20000 }) {
  const out = []
  const walk = rel => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      const p = `${rel.replace(/\/$/, '')}/${e.name}`
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('mut-tmp-')) walk(p) }
      else if (SPEC.test(e.name) && !e.name.startsWith('mut-tmp-')) out.push(p)
    }
  }
  walk(folder)
  return out
}

/** The project's spec files, each with its adapter: the Vitest layer folders and the e2e folder. */
export function projectSpecs(root, config) {
  const seen = new Map()
  for (const adapter of adaptersOf(config)) {
    const view = asAdapter(config, adapter)
    const folders = adapter === 'vitest' ? layersOf(view).map(l => l.folder) : [e2eFolder(root, view).folder].filter(Boolean)
    for (const f of folders) for (const p of specsIn(root, f)) if (!seen.has(p)) seen.set(p, adapter)
  }
  return [...seen].map(([path, adapter]) => ({ path, adapter }))
}

/** Traceability and suite honesty, read from the spec files themselves. */
export function scanSpecs(root, config) {
  const specs = projectSpecs(root, config)
  const key = new RegExp(keySource(config))
  let traced = 0
  const byAdapter = new Map()
  for (const s of specs) {
    let src
    try { src = readFileSync(join(root, s.path), 'utf8') } catch { continue }
    const d = dialectFor(s.adapter)
    // Linked to a ticket: its key in a group's or a test's title, or in the file name (ABC-123.spec.ts).
    const titles = [...src.matchAll(new RegExp(d.groupRe.source, 'gm')), ...src.matchAll(new RegExp(d.suite.testRe.source, 'g'))].map(m => m[3] ?? '')
    if ([...titles, s.path.split('/').at(-1)].some(t => key.test(t.toUpperCase()))) traced++
    if (!byAdapter.has(s.adapter)) byAdapter.set(s.adapter, [])
    byAdapter.get(s.adapter).push({ path: s.path, src })
  }
  let tests = 0
  let honest = 0
  for (const [adapter, files] of byAdapter) {
    const r = grade(files, {}, dialectFor(adapter))
    tests += r.data?.tests ?? 0
    honest += r.data?.withAssertion ?? 0
  }
  return { specs: specs.length, traced, tests, honest }
}

/** total.lines.pct of an Istanbul coverage summary, when the project has one. */
export function readCoverage(root) {
  for (const p of ['coverage/coverage-summary.json']) {
    if (!existsSync(join(root, p))) continue
    try {
      const v = JSON.parse(readFileSync(join(root, p), 'utf8'))?.total?.lines?.pct
      if (typeof v === 'number') return { pct: Math.round(v), file: p }
    } catch {}
  }
  return null
}

/** The numbers, from the period's audit events and the repo scan. */
export function qualityKpi({ finals, runs, scan, coverage }) {
  const scored = finals.filter(g => typeof g.score === 'number')
  // A run with every gate: not forced past the readiness gate, and with the ticket, so the value check ran.
  const known = runs.filter(r => r.flags)
  const relaxed = known.filter(r => r.incompleteTicket || !r.flags.ticket)
  const ready = finals.filter(g => g.gate === 'pass' && g.key)
  const ran = new Set(runs.map(r => r.key).filter(Boolean))
  // The pipeline logs the mutation counts (killed of total), not a score.
  const killRate = s => (typeof s?.score === 'number' ? s.score : s?.total > 0 && typeof s.killed === 'number' ? (100 * s.killed) / s.total : null)
  const mutation = runs.map(r => killRate((r.steps ?? []).find(s => s.check === 'mutation'))).filter(v => v !== null)
  return {
    traceability: scan ? { pct: pct(scan.traced, scan.specs), traced: scan.traced, specs: scan.specs } : null,
    completeness: { mean: scored.length ? Math.round(scored.reduce((n, g) => n + g.score, 0) / scored.length) : null, tickets: scored.length },
    suiteHonesty: scan ? { pct: pct(scan.honest, scan.tests), honest: scan.honest, tests: scan.tests } : null,
    gateIntegrity: { pct: pct(known.length - relaxed.length, known.length), full: known.length - relaxed.length, runs: known.length, relaxed: relaxed.length },
    adoption: { pct: pct(ready.filter(g => ran.has(g.key)).length, ready.length), checked: ready.filter(g => ran.has(g.key)).length, ready: ready.length },
    coverage,
    mutation: { mean: mutation.length ? Math.round(mutation.reduce((n, v) => n + v, 0) / mutation.length) : null, runs: mutation.length },
    targets: TARGETS,
  }
}

const mark = (value, target) => (value === null || value === undefined || target === null ? '— ' : value >= target ? '✅' : '⚠️')
const shown = (v, unit = '%') => (v === null || v === undefined ? 'no data' : `${v}${unit}`)

/** The card's Quality lines. */
export function formatQuality(q) {
  const t = q.targets
  const line = (name, value, target, detail, unit = '%') =>
    `  ${mark(value, target)} ${name.padEnd(16)}${shown(value, unit).padEnd(9)}${(target === null ? '' : `target ${target}${unit}`).padEnd(13)}${detail}`
  return [
    'Quality (the Quality Program numbers this repo can show)',
    line('Traceability', q.traceability?.pct, t.traceability, q.traceability ? `${q.traceability.traced} of ${q.traceability.specs} spec files name a ticket` : 'no project config to find the specs'),
    line('Completeness', q.completeness.mean, t.completeness, q.completeness.tickets ? `mean readiness score of ${q.completeness.tickets} ticket(s)` : 'no ticket gated', ''),
    line('Suite honesty', q.suiteHonesty?.pct, t.suiteHonesty, q.suiteHonesty ? `${q.suiteHonesty.honest} of ${q.suiteHonesty.tests} tests assert something` : 'no project config to find the specs'),
    line('Gate integrity', q.gateIntegrity.pct, t.gateIntegrity, q.gateIntegrity.runs ? `${q.gateIntegrity.full} of ${q.gateIntegrity.runs} runs with every gate${q.gateIntegrity.relaxed ? ` (${q.gateIntegrity.relaxed} forced or without the ticket)` : ''}` : 'no run logged with its gates yet'),
    line('Adoption', q.adoption.pct, t.adoption, q.adoption.ready ? `${q.adoption.checked} of ${q.adoption.ready} ready ticket(s) have a pipeline run${q.adoption.ready < 10 ? ' (few tickets: a fact, not yet a rate)' : ''}` : 'no ticket passed the gate'),
    line('Coverage', q.coverage?.pct, t.coverage, q.coverage ? `lines, from ${q.coverage.file}` : 'no coverage/coverage-summary.json (the suite is never run here)'),
    line('Mutation kill', q.mutation.mean, null, q.mutation.runs ? `mean over ${q.mutation.runs} run(s)` : 'no run had assertions to mutate yet'),
  ]
}
