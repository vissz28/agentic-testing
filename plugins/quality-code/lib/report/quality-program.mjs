// The Quality Program numbers (its §9) a repo can show by itself, as the old in-repo kpi.mjs did:
// traceability, completeness of the tickets, suite honesty, gate integrity, adoption, coverage and the
// mutation kill rate. Each is a number or "no data", never a made-up 100%.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { layersOf, ungradedTitlesOf } from '../base/config.mjs'
import { e2eFolder } from '../base/e2e-folder.mjs'
import { dialectFor } from '../base/dialects/index.mjs'
import { runnerOf } from '../base/runners.mjs'
import { keySource } from '../base/keys.mjs'
import { grade } from '../pipeline/checks/suite-honesty.mjs'
import { adaptersOf, asAdapter } from '../base/stack.mjs'
import { detectConventions } from '../base/conventions.mjs'
import { BACKENDS, isBackend } from '../base/backends.mjs'

// ponytail: fixed targets, the Quality Program's defaults; a config field when a team needs its own.
export const TARGETS = Object.freeze({ traceability: 100, completeness: 95, suiteHonesty: 100, gateIntegrity: 100, coverage: 80, adoption: null })
// Cypress names its specs *.cy.ts.
const SPEC = /\.(spec|test|cy)\.[cm]?[jt]sx?$/
// A unit spec by name (foo.unit.test.jsx): it runs under the unit runner even when it sits in the e2e folder.
const UNIT = /\.unit\.(spec|test)\.[cm]?[jt]sx?$/
const SKIP = new Set(['node_modules', '.git', 'dist'])
// The build output and environments of the other stacks: a walk of a whole repo (Go's "./") skips them.
const SKIP_BUILD = new Set([...SKIP, 'target', 'build', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__', '.gradle', '.tox'])
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null)

function specsIn(root, folder, { spec = SPEC, skip = SKIP } = {}, budget = { n: 20000 }) {
  const out = []
  const walk = rel => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      // The repo itself ("./", Go's default layer) lists its files without a "./" in front.
      const p = rel ? `${rel.replace(/\/$/, '')}/${e.name}` : e.name
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('mut-tmp-')) walk(p) }
      else if (spec.test(e.name) && !e.name.startsWith('mut-tmp-')) out.push(p)
    }
  }
  walk(String(folder).replace(/^(?:\.\/)+/, ''))
  return out
}

/**
 * The project's spec files, each with its adapter: the backend's layer folders and the e2e folder, and
 * when most of the project's tests sit next to the code (foo.unit.test.js next to foo.js), those too: a unit spec is
 * found by its name wherever it is, as the runner's own include would find it. A unit spec inside the e2e
 * folder runs under the unit runner, not Playwright.
 */
export function projectSpecs(root, config) {
  const seen = new Map()
  const has = adaptersOf(config)
  const e2e = has.includes('playwright') ? e2eFolder(root, asAdapter(config, 'playwright')).folder : null
  for (const adapter of has) {
    const view = asAdapter(config, adapter)
    const backend = isBackend(adapter)
    const folders = backend ? layersOf(view).map(l => l.folder) : [e2e].filter(Boolean)
    // Each backend's own test file names; Vitest and Playwright keep the JS/TS spec names.
    const names = backend && adapter !== 'vitest' ? { spec: BACKENDS[adapter].testFile, skip: SKIP_BUILD } : {}
    const pw = !backend ? { spec: { test: n => SPEC.test(n) && !UNIT.test(n) } } : null
    for (const f of folders) for (const p of specsIn(root, f, pw ?? names)) if (!seen.has(p)) seen.set(p, adapter)
  }
  // Tests beside the code: the JS/TS backend (Vitest, or Jest as the unit runner) owns them.
  const js = has.find(a => isBackend(a) && (a === 'vitest' || BACKENDS[a].codeFile.test('x.js')))
  if (js) {
    const conv = detectConventions(root)
    if (conv.specs > 0 && conv.beside) {
      for (const p of specsIn(root, '', { spec: SPEC, skip: SKIP_BUILD })) {
        if (seen.has(p)) continue
        if (e2e && p.startsWith(e2e) && !UNIT.test(p)) continue
        seen.set(p, js)
      }
    }
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
    const d = dialectFor(runnerOf(config, s.adapter))
    // Linked to a ticket: its key in a group's or a test's title, or in the file name (ABC-123.spec.ts).
    const titles = [...src.matchAll(new RegExp(d.groupRe.source, 'gm')), ...src.matchAll(new RegExp(d.suite.testRe.source, 'g'))].map(m => m[3] ?? '')
    if ([...titles, s.path.split('/').at(-1)].some(t => key.test(t.toUpperCase()))) traced++
    if (!byAdapter.has(s.adapter)) byAdapter.set(s.adapter, [])
    byAdapter.get(s.adapter).push({ path: s.path, src })
  }
  let tests = 0
  let honest = 0
  for (const [adapter, files] of byAdapter) {
    const dialect = dialectFor(runnerOf(config, adapter))
    const r = grade(files, { ungraded: ungradedTitlesOf(config, dialect), helpers: config.assertionHelpers ?? [] }, dialect)
    tests += r.data?.tests ?? 0
    honest += r.data?.withAssertion ?? 0
  }
  return { specs: specs.length, traced, tests, honest }
}

/** Line coverage from an Istanbul summary, else an lcov report (most runners' default), else the JaCoCo and Cobertura reports, when the project has one. */
export function readCoverage(root) {
  const p = 'coverage/coverage-summary.json'
  try {
    const v = JSON.parse(readFileSync(join(root, p), 'utf8'))?.total?.lines?.pct
    if (typeof v === 'number') return { pct: Math.round(v), file: p }
  } catch {}
  const l = 'coverage/lcov.info'
  try {
    const sum = re => [...readFileSync(join(root, l), 'utf8').matchAll(re)].reduce((n, m) => n + Number(m[1]), 0)
    const found = sum(/^LF:(\d+)/gm)
    if (found) return { pct: Math.round((100 * sum(/^LH:(\d+)/gm)) / found), file: l }
  } catch {}
  return xmlCoverage(root)
}

// Java and .NET write their reports inside the build output (target/, build/, TestResults/), so this walk enters it.
const COVERAGE_SKIP = new Set([...SKIP, 'bin', 'obj', '.gradle', '.venv', 'venv', 'vendor', '__pycache__', '.tox'])
// JaCoCo: Maven's jacoco.xml, Gradle's jacocoTestReport.xml and the aggregation plugin's testCodeCoverageReport.xml.
// Cobertura: coverlet's coverage.cobertura.xml (dotnet test --collect "XPlat Code Coverage", or coverlet.msbuild).
const COVERAGE_XML = /^(?:jacoco\.xml|jacocoTestReport\.xml|testCodeCoverageReport\.xml|coverage\.cobertura\.xml)$/
const attr = (tag, name) => Number(tag.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1])

/** Covered and valid lines of one JaCoCo or Cobertura report, or null when it has no line totals. */
function xmlLines(text) {
  if (/<report\b/.test(text)) {
    // The report's own counters come last, after every package (and group, in an aggregate report).
    const tail = text.slice(Math.max(text.lastIndexOf('</package>'), text.lastIndexOf('</group>'), 0))
    const tag = tail.match(/<counter\b[^>]*\btype="LINE"[^>]*>/)?.[0]
    if (!tag) return null
    const covered = attr(tag, 'covered')
    const valid = covered + attr(tag, 'missed')
    return valid > 0 ? { covered, valid } : null
  }
  const tag = text.match(/<coverage\b[^>]*>/)?.[0]
  if (!tag) return null
  const covered = attr(tag, 'lines-covered')
  const valid = attr(tag, 'lines-valid')
  return valid > 0 ? { covered, valid } : null
}

/**
 * Line coverage from the JaCoCo (Java, Kotlin) and Cobertura (.NET) reports anywhere in the repo, summed over the
 * modules. An aggregate JaCoCo report stands for the modules when there is one; JaCoCo's integration-test report
 * (jacoco-it) is left out, as its lines are the unit report's too. Each TestResults folder keeps only its newest
 * run, since coverlet writes a new one per run.
 */
function xmlCoverage(root) {
  let files = specsIn(root, '', { spec: COVERAGE_XML, skip: COVERAGE_SKIP }).filter(p => !p.includes('jacoco-it/'))
  const aggregate = files.filter(p => p.includes('jacoco-aggregate/') || p.endsWith('testCodeCoverageReport.xml'))
  if (aggregate.length) files = aggregate
  const newest = new Map()
  for (const p of files) {
    const run = p.replace(/(^|\/)TestResults\/[^/]+\//, '$1TestResults/')
    let mtime = 0
    try { mtime = statSync(join(root, p)).mtimeMs } catch {}
    if (!newest.has(run) || newest.get(run).mtime < mtime) newest.set(run, { p, mtime })
  }
  let covered = 0, valid = 0
  const used = []
  for (const { p } of newest.values()) {
    let lines = null
    try { lines = xmlLines(readFileSync(join(root, p), 'utf8')) } catch {}
    if (!lines) continue
    covered += lines.covered
    valid += lines.valid
    used.push(p)
  }
  if (!valid) return null
  return { pct: Math.round((100 * covered) / valid), file: used.length === 1 ? used[0] : `${used.length} reports (${used[0]}, …)` }
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
    line('Coverage', q.coverage?.pct, t.coverage, q.coverage ? `lines, from ${q.coverage.file}` : 'no coverage report: Istanbul, lcov, JaCoCo or Cobertura (the suite is never run here)'),
    line('Mutation kill', q.mutation.mean, null, q.mutation.runs ? `mean over ${q.mutation.runs} run(s)` : 'no run had assertions to mutate yet'),
  ]
}
