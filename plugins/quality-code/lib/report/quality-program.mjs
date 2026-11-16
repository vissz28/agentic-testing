// Quality Program (§9) numbers a repo can show on its own. Each is a number or "no data", never a made-up 100%.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { layersOf, ungradedTitlesOf } from '../config/config.mjs'
import { e2eFolder } from '../stacks/e2e-folder.mjs'
import { dialectFor } from '../stacks/dialects/index.mjs'
import { runnerOf } from '../stacks/runners.mjs'
import { keySource } from '../config/keys.mjs'
import { grade } from '../pipeline/checks/suite-honesty.mjs'
import { adaptersOf, asAdapter } from '../stacks/stack.mjs'
import { detectConventions } from '../stacks/conventions.mjs'
import { BACKENDS, isBackend } from '../stacks/backends.mjs'
import { changedPaths } from '../core/git.mjs'
import { execFileSync } from 'node:child_process'
import { readJson, tryReadJson } from '../core/files.mjs'
import { withoutOrigin } from '../core/text.mjs'

// ponytail: fixed Quality Program targets; a config field when a team needs its own.
export const TARGETS = Object.freeze({ traceability: 100, completeness: 95, suiteHonesty: 100, gateIntegrity: 100, coverage: 80, adoption: null })
// .cy is Cypress.
const SPEC = /\.(spec|test|cy)\.[cm]?[jt]sx?$/
// Runs under the unit runner even inside the e2e folder.
const UNIT = /\.unit\.(spec|test)\.[cm]?[jt]sx?$/
const SKIP = new Set(['node_modules', '.git', 'dist'])
// Other stacks' build output and envs, skipped on a whole-repo walk (Go's "./").
const SKIP_BUILD = new Set([...SKIP, 'target', 'build', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__', '.gradle', '.tox'])
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null)

function specsIn(root, folder, { spec = SPEC, skip = SKIP } = {}, budget = { n: 20000 }) {
  const out = []
  const wholeRepo = /^(?:\.\/?)*$/.test(String(folder))
  const walk = rel => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      const p = rel ? `${rel.replace(/\/$/, '')}/${e.name}` : e.name
      // Hidden folders (.build-context, .cache) hold copies, not tests.
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('mut-tmp-') && !(wholeRepo && e.name.startsWith('.'))) walk(p) }
      else if (spec.test(e.name) && !e.name.startsWith('mut-tmp-')) out.push(p)
    }
  }
  walk(String(folder).replace(/^(?:\.\/)+/, ''))
  return out
}

/**
 * Spec files with their adapter: layer folders, the e2e folder, and specs beside the code when that's the
 * project's convention. A unit spec in the e2e folder belongs to the unit runner, not Playwright.
 */
export function projectSpecs(root, config) {
  const seen = new Map()
  const has = adaptersOf(config)
  const e2e = has.includes('playwright') ? e2eFolder(root, asAdapter(config, 'playwright')).folder : null
  for (const adapter of has) {
    const view = asAdapter(config, adapter)
    const backend = isBackend(adapter)
    const folders = backend ? layersOf(view).map(l => l.folder) : [e2e].filter(Boolean)
    const names = backend && adapter !== 'vitest' ? { spec: BACKENDS[adapter].testFile, skip: SKIP_BUILD } : {}
    const pw = !backend ? { spec: { test: n => SPEC.test(n) && !UNIT.test(n) } } : null
    for (const f of folders) for (const p of specsIn(root, f, pw ?? names)) if (!seen.has(p)) seen.set(p, adapter)
  }
  // Specs beside the code belong to the JS/TS backend.
  const js = has.find(a => isBackend(a) && (a === 'vitest' || BACKENDS[a].codeFile.test('x.js')))
  if (js) {
    const conv = detectConventions(root)
    if (conv.specs > 0 && conv.beside) {
      const runner = runnerOf(config, 'vitest')
      const cache = new Map()
      for (const p of specsIn(root, '', { spec: SPEC, skip: SKIP_BUILD })) {
        if (seen.has(p)) continue
        // Skip monorepo workspaces on another unit runner (Vitest frontend beside Jest services).
        if (otherRunnersTest(root, p, runner, cache)) continue
        if (e2e && p.startsWith(e2e) && !UNIT.test(p)) continue
        seen.set(p, js)
      }
    }
  }
  const kept = withoutIgnored(root, [...seen.keys()])
  return [...seen].filter(([path]) => kept.has(path)).map(([path, adapter]) => ({ path, adapter }))
}

/** Drops git-ignored paths (build copies like .build-context/). Keeps all outside a git repo. */
export function withoutIgnored(root, paths) {
  const all = new Set(paths)
  if (!paths.length) return all
  try {
    const out = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: root, input: `${paths.join('\0')}\0`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1e8, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    for (const p of out.split('\0')) all.delete(p)
  } catch (e) {
    // Exit 1 means nothing ignored; any other failure keeps every path.
    if (e.status === 1 || !e.stdout) return all
    for (const p of String(e.stdout).split('\0')) all.delete(p)
  }
  return all
}

// Unit test tools in the nearest package.json above the spec; null if there is none.
function workspaceTools(root, spec, cache) {
  let dir = spec.includes('/') ? spec.slice(0, spec.lastIndexOf('/')) : ''
  for (;;) {
    if (cache.has(dir)) return cache.get(dir)
    const pkg = tryReadJson(join(root, dir, 'package.json'), null)
    if (pkg) {
      const deps = { ...pkg.devDependencies, ...pkg.dependencies }
      const tools = new Set(['jest', 'vitest', 'mocha'].filter(t => t in deps || (t === 'jest' && 'ts-jest' in deps)))
      cache.set(dir, tools)
      return tools
    }
    if (!dir) return null
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
  }
}
function otherRunnersTest(root, spec, runner, cache) {
  const tools = workspaceTools(root, spec, cache)
  return Boolean(tools && tools.size && ['jest', 'vitest', 'mocha'].includes(runner) && !tools.has(runner))
}

export function scanSpecs(root, config) {
  const specs = projectSpecs(root, config)
  const key = new RegExp(keySource(config))
  let traced = 0
  const tracedPaths = new Set()
  const byAdapter = new Map()
  for (const s of specs) {
    let src
    try { src = readFileSync(join(root, s.path), 'utf8') } catch { continue }
    const d = dialectFor(runnerOf(config, s.adapter))
    // Traced: ticket key in a group/test title or the file name.
    const titles = [...src.matchAll(new RegExp(d.groupRe.source, 'gm')), ...src.matchAll(new RegExp(d.suite.testRe.source, 'g'))].map(m => m[3] ?? '')
    if ([...titles, s.path.split('/').at(-1)].some(t => key.test(t.toUpperCase()))) { traced++; tracedPaths.add(s.path) }
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
  return { specs: specs.length, traced, tests, honest, branch: branchTrace(root, config, specs, tracedPaths) }
}

// git.base, preferring origin/.
function baseRef(root, config) {
  const name = config.git?.base
  if (!name) return null
  for (const ref of [`origin/${name}`, name]) {
    try { execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' }); return ref } catch {}
  }
  return null
}

// Traceability of specs changed on this branch only: an old suite drags the whole-repo number down for years.
export function branchTrace(root, config, specs, tracedPaths) {
  const ref = baseRef(root, config)
  if (!ref) return null
  const c = changedPaths(root, `${ref}...HEAD`)
  if (!c.ok) return null
  const changed = new Set(c.paths)
  const mine = specs.filter(s => changed.has(s.path))
  return mine.length ? { base: withoutOrigin(ref), specs: mine.length, traced: mine.filter(s => tracedPaths.has(s.path)).length } : null
}

/** Line coverage: Istanbul summary, else lcov, else JaCoCo/Cobertura XML. */
export function readCoverage(root) {
  const p = 'coverage/coverage-summary.json'
  try {
    const v = readJson(join(root, p))?.total?.lines?.pct
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

// Java and .NET write reports inside build output (target/, build/, TestResults/), so don't skip those.
const COVERAGE_SKIP = new Set([...SKIP, 'bin', 'obj', '.gradle', '.venv', 'venv', 'vendor', '__pycache__', '.tox'])
// JaCoCo (Maven, Gradle, aggregate) and coverlet's Cobertura.
const COVERAGE_XML = /^(?:jacoco\.xml|jacocoTestReport\.xml|testCodeCoverageReport\.xml|coverage\.cobertura\.xml)$/
const attr = (tag, name) => Number(tag.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1])

function xmlLines(text) {
  if (/<report\b/.test(text)) {
    // Report totals come after the last package/group.
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
 * Sums reports across modules. An aggregate report replaces the per-module ones; jacoco-it is skipped
 * (it double-counts unit lines). Coverlet writes a folder per run, so only the newest TestResults run counts.
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

export function qualityKpi({ finals, runs, scan, coverage }) {
  const scored = finals.filter(g => typeof g.score === 'number')
  // Relaxed: forced past the readiness gate, or run without the ticket (no value check).
  const known = runs.filter(r => r.flags)
  const relaxed = known.filter(r => r.incompleteTicket || !r.flags.ticket)
  const ready = finals.filter(g => g.gate === 'pass' && g.key)
  const ran = new Set(runs.map(r => r.key).filter(Boolean))
  // The pipeline logs killed/total, not a score.
  const killRate = s => (typeof s?.score === 'number' ? s.score : s?.total > 0 && typeof s.killed === 'number' ? (100 * s.killed) / s.total : null)
  const mutation = runs.map(r => killRate((r.steps ?? []).find(s => s.check === 'mutation'))).filter(v => v !== null)
  return {
    traceability: scan ? { pct: pct(scan.traced, scan.specs), traced: scan.traced, specs: scan.specs, ...(scan.branch ? { branch: { ...scan.branch, pct: pct(scan.branch.traced, scan.branch.specs) } } : {}) } : null,
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

export function formatQuality(q) {
  const t = q.targets
  const line = (name, value, target, detail, unit = '%') =>
    `  ${mark(value, target)} ${name.padEnd(16)}${shown(value, unit).padEnd(9)}${(target === null ? '' : `target ${target}${unit}`).padEnd(13)}${detail}`
  return [
    'Quality (the Quality Program numbers this repo can show)',
    line('Traceability', q.traceability?.pct, t.traceability, q.traceability ? `${q.traceability.traced} of ${q.traceability.specs} spec files name a ticket${q.traceability.branch ? `; on this branch ${q.traceability.branch.traced} of ${q.traceability.branch.specs} (${q.traceability.branch.pct}%, since ${q.traceability.branch.base})` : ''}` : 'no project config to find the specs'),
    line('Completeness', q.completeness.mean, t.completeness, q.completeness.tickets ? `mean readiness score of ${q.completeness.tickets} ticket(s)` : 'no ticket gated', ''),
    line('Suite honesty', q.suiteHonesty?.pct, t.suiteHonesty, q.suiteHonesty ? `${q.suiteHonesty.honest} of ${q.suiteHonesty.tests} tests assert something` : 'no project config to find the specs'),
    line('Gate integrity', q.gateIntegrity.pct, t.gateIntegrity, q.gateIntegrity.runs ? `${q.gateIntegrity.full} of ${q.gateIntegrity.runs} runs with every gate${q.gateIntegrity.relaxed ? ` (${q.gateIntegrity.relaxed} forced or without the ticket)` : ''}` : 'no run logged with its gates yet'),
    line('Adoption', q.adoption.pct, t.adoption, q.adoption.ready ? `${q.adoption.checked} of ${q.adoption.ready} ready ticket(s) have a pipeline run${q.adoption.ready < 10 ? ' (few tickets: a fact, not yet a rate)' : ''}` : 'no ticket passed the gate'),
    line('Coverage', q.coverage?.pct, t.coverage, q.coverage ? `lines, from ${q.coverage.file}` : 'no coverage report: Istanbul, lcov, JaCoCo or Cobertura (the suite is never run here)'),
    line('Mutation kill', q.mutation.mean, null, q.mutation.runs ? `mean over ${q.mutation.runs} run(s)` : 'no run had assertions to mutate yet'),
  ]
}
