// Entry point for the pipeline (Vitest, Playwright, or both): node bin/pipeline.mjs <spec...>|--suite frontend|backend|full [--key KEY] [--range A...B] [--flaky N] [--ticket @file] [--expected @file] [--target path [--function name,name]] [--incomplete-ticket SCORE] [--smoke [--url URL]] [--no-mutation] [--no-audit] [--json]
// Exit 0 green, 1 checks failed or tests red, 2 usage/config error or a crash, 3 not verified.
// --incomplete-ticket marks a run the developer forced past the readiness gate ("continue anyway"):
// the card carries the risk line, the verdict is unchanged. Every run is logged in the local audit log.
// --suite takes every spec of one side (frontend: the e2e folder, backend: the backend's layers) or of both.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { dialectFor } from '../lib/base/dialects/index.mjs'
import { runnerOf } from '../lib/base/runners.mjs'
import { isProjectKey, projectKeys } from '../lib/base/keys.mjs'
import { audit, auditOff } from '../lib/base/audit.mjs'
import { doneStatusesOf, loadConfig, projectRoot } from '../lib/base/config.mjs'
import { THRESHOLD } from '../lib/ticket/score.mjs'
import { formatCard, formatRunLog } from '../lib/pipeline/card.mjs'
import { normalizeSpec, runPipeline as realRunPipeline } from '../lib/pipeline/pipeline.mjs'
import { adaptersForSide, adaptersOf, isFullstack } from '../lib/base/stack.mjs'
import { backendOf, BACKENDS, runnerLabel } from '../lib/base/backends.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { regressionProof } from '../lib/pipeline/regression.mjs'
import { stopAll } from '../lib/pipeline/runners/tool.mjs'
import { checkUrl, smokeEnv, smokeSpecs } from '../lib/pipeline/smoke.mjs'
import { isMain, printLine, printError } from '../lib/core/script-io.mjs'
import { readJsonOr } from '../lib/core/files.mjs'

const USAGE = 'usage: pipeline.mjs <spec...>|--suite frontend|backend|full [--key KEY] [--range A...B] [--flaky N] [--ticket @file] [--expected @file] [--target path [--function name,name]] [--incomplete-ticket SCORE] [--smoke [--url URL]] [--no-mutation] [--regression-before red|green] [--no-audit] [--json]'
const EXIT = { green: 0, checks_failed: 1, tests_red: 1, not_verified: 3 }
// The suites: frontend is Playwright, backend is the project's backend runner (Vitest when it has none),
// full is whatever the project has.
const SUITES = ['frontend', 'backend', 'full']
const suiteAdapters = (suite, config) => (suite === 'full' ? null : adaptersForSide(suite, config))
const sideName = (suite, config) => `${suite} (${runnerLabel(suiteAdapters(suite, config)[0])})`

function parse(argv) {
  const a = { json: false, noAudit: false, mutation: true, specs: [] }
  const VALUE = new Set(['--range', '--key', '--flaky', '--ticket', '--target', '--function', '--incomplete-ticket', '--expected', '--suite', '--regression-before', '--url'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[{ '--incomplete-ticket': 'incomplete', '--regression-before': 'regressionBefore' }[x] ?? x.slice(2)] = v
    } else if (x === '--json') a.json = true
    else if (x === '--no-audit') a.noAudit = true
    else if (x === '--no-mutation') a.mutation = false
    else if (x === '--smoke') a.smoke = true
    else if (x.startsWith('-')) throw new Error(`unknown option ${x}`)
    else a.specs.push(x)
  }
  if (a.suite !== undefined && !SUITES.includes(a.suite)) throw new Error(`--suite must be frontend, backend or full, not "${a.suite}"`)
  if (a.suite !== undefined && a.specs.length) throw new Error('give spec paths or --suite, not both')
  if (a.regressionBefore !== undefined && !['red', 'green'].includes(a.regressionBefore)) throw new Error(`--regression-before must be red or green, not "${a.regressionBefore}"`)
  if (a.url !== undefined && !a.smoke) throw new Error('--url goes with --smoke')
  if (a.smoke && a.suite !== undefined && a.suite !== 'frontend') throw new Error('--smoke runs the frontend (Playwright) suite')
  if (a.function !== undefined && a.target === undefined) throw new Error('--function names code in the --target file: give --target too')
  if (a.function !== undefined && !/^[A-Za-z_$][\w$]*(?:,[A-Za-z_$][\w$]*)*$/.test(a.function)) throw new Error(`--function must be one or more function names, comma-separated, like upsertTotal,applyDiscount, not "${a.function}"`)
  if (a.flaky !== undefined && !/^[1-9]\d*$/.test(a.flaky)) throw new Error(`--flaky must be a whole number of 1 or more, not "${a.flaky}"`)
  if (a.incomplete !== undefined && !(/^(0|[1-9]\d?)$/.test(a.incomplete) && Number(a.incomplete) < THRESHOLD)) {
    throw new Error(`--incomplete-ticket must be the ticket's score, a whole number from 0 to ${THRESHOLD - 1}, below the bar (${THRESHOLD}), not "${a.incomplete}"`)
  }
  return a
}

const isFile = p => { try { return statSync(p).isFile() } catch { return false } }

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { runPipeline = realRunPipeline } = {}) {
  const err = m => { printError(m); return 2 }
  let a
  try { a = parse(argv) } catch (e) { return err(e.message) }
  if (a.smoke && !a.specs.length) a.suite = 'frontend'
  if (!a.specs.length && a.suite === undefined) return err(`needs at least one spec path, or --suite. ${USAGE}`)
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root)
  if (!cfg.ok) return err(cfg.errors.join('\n'))
  const config = cfg.config
  if (a.suite !== undefined) {
    const has = adaptersOf(config)
    const want = suiteAdapters(a.suite, config) ?? has
    if (!want.some(x => has.includes(x))) return err(`This project has no ${sideName(a.suite, config)} tests: its config has no "${a.suite}".`)
    a.specs = projectSpecs(root, config).filter(s => want.includes(s.adapter)).map(s => s.path)
    if (!a.specs.length) return err(`No ${a.suite === 'full' ? '' : `${sideName(a.suite, config)} `}spec files found in the project's test folders.`)
    if (a.target !== undefined && a.suite === 'frontend') return err('--target runs Stryker, which is for Vitest specs: leave it out for the frontend suite')
  }
  let smokeVars = null
  if (a.smoke) {
    // Only the Playwright runner reads the smoke grep and the url: any other would run every test against its own baseUrl.
    if (runnerOf(config, 'playwright') !== 'playwright') return err(`--smoke runs the Playwright e2e suite: this project's e2e runner is ${runnerOf(config, 'playwright')}`)
    const u = a.url === undefined ? { url: null } : checkUrl(a.url)
    if (u.error) return err(u.error)
    const tagged = smokeSpecs(root, a.specs)
    if (!tagged.length) return err('No @smoke tests found. Tag the critical tests with @smoke (/quality-code:spec offers it at the plan card).')
    a.specs = tagged
    a.mutation = false
    smokeVars = smokeEnv(u.url)
  }
  for (const s of a.specs) {
    const rel = normalizeSpec(root, resolve(root, s))
    if (rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return err(`spec must be inside the project: ${s}`)
    if (!isFile(resolve(root, rel))) return err(`spec not found: ${s}`)
  }
  if (a.key && !isProjectKey(config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(config).join(', ')}`)
  const inside = rel => !(rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/'))
  let ticket = null
  let jiraStatus = null
  let issueType = null
  if (a.ticket !== undefined) {
    const t = a.ticket.replace(/^@/, '')
    if (!t) return err('--ticket needs a file, like --ticket @path/ticket.json')
    ticket = resolve(root, t)
    let obj
    try { obj = JSON.parse(readFileSync(ticket, 'utf8')) } catch (e) { return err(`--ticket ${t}: ${isFile(ticket) ? `not valid JSON (${e.message.split('\n')[0]})` : 'file not found'}`) }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return err(`--ticket ${t}: not a ticket object`)
    jiraStatus = typeof obj.status === 'string' ? obj.status : null
    issueType = typeof obj.issuetype === 'string' ? obj.issuetype : null
  }
  // --expected: the values the writer says its tests pin, as a JSON list; the check keeps only those the ticket's expected text holds.
  let candidates = []
  if (a.expected !== undefined) {
    if (!ticket) return err('--expected needs --ticket: the values are checked against the ticket')
    const f = resolve(root, a.expected.replace(/^@/, ''))
    let obj
    try { obj = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { return err(`--expected ${a.expected}: ${isFile(f) ? `not valid JSON (${e.message.split('\n')[0]})` : 'file not found'}`) }
    const list = Array.isArray(obj) ? obj : obj?.expected ?? obj?.candidates
    if (!Array.isArray(list) || list.some(x => typeof x !== 'string' && typeof x !== 'number')) return err(`--expected ${a.expected}: must be a list of values, like ["80", "unit_cost"]`)
    candidates = list.map(String)
  }
  let target = null
  if (a.target !== undefined && config.adapter === 'playwright') return err('--target runs Stryker, which is for Vitest projects: leave it out for Playwright specs')
  const backend = backendOf(config)
  if (a.target !== undefined && backend && !BACKENDS[backend].stryker) return err(`--target runs Stryker, which is for Vitest projects: leave it out for ${runnerLabel(backend)} specs`)
  if (a.target !== undefined) {
    target = normalizeSpec(root, resolve(root, a.target))
    if (!inside(target)) return err(`--target must be inside the project: ${a.target}`)
    if (!isFile(resolve(root, target))) return err(`--target not found: ${a.target}`)
    if (a.specs.some(s => normalizeSpec(root, resolve(root, s)) === target)) return err(`--target ${a.target} is one of the specs: name the code the tests check`)
  }
  // What /quality-code:spec read before it wrote these tests (rules.mjs --key): Central Context, or the fallback.
  let rules = null
  if (a.key) try { rules = readJsonOr(resolve(root, config.ticketsDir, a.key, 'rules.json'), null) } catch (e) { return err(e.message) }
  // A fullstack run picks the dialect per spec.
  const ctx = { config, dialect: isFullstack(config) ? null : dialectFor(runnerOf(config)), root }
  const incompleteTicket = a.incomplete === undefined ? null : { score: Number(a.incomplete), bar: THRESHOLD }
  const log = (kind, entry) => audit(root, kind, entry, { env, off: a.noAudit, dir: cfg.auditDir })
  if (incompleteTicket) log('override', { key: a.key ?? null, ...incompleteTicket })
  let outcome
  const before = { ...process.env }
  const restore = () => { for (const k of Object.keys(smokeVars ?? {})) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k] } }
  if (smokeVars) Object.assign(process.env, smokeVars)
  try {
    outcome = await runPipeline({ specs: a.specs, key: a.key ?? null, range: a.range ?? null, flakyRuns: a.flaky ? Number(a.flaky) : null, ticket, target, functions: a.function ? a.function.split(',') : [], candidates, mutation: a.mutation }, ctx)
  } catch (e) {
    restore()
    printError(`check ${e?.step ?? 'pipeline'} crashed: ${String(e?.message ?? e).split('\n')[0]}`)
    return 2
  }
  restore()
  if (incompleteTicket) outcome = { ...outcome, incompleteTicket }
  const proof = regressionProof(a.regressionBefore, outcome.verdict)
  if (proof) outcome = { ...outcome, regression: proof }
  const specs = [...new Set(a.specs.map(s => normalizeSpec(root, s)))]
  const tests = (outcome.steps || []).find(x => x.check === 'tests')?.data ?? {}
  log('pipeline', {
    key: a.key ?? null, verdict: outcome.verdict, decidedBy: outcome.decidedBy, adapter: isFullstack(config) ? 'fullstack' : config.adapter,
    steps: outcome.steps || [],
    counts: { specs: specs.length, passed: tests.passed, failed: tests.failed, skipped: tests.skipped },
    incompleteTicket,
    rules: rules && { source: rules.source, hub: rules.hub, release: rules.release },
    flags: { ticket: Boolean(ticket), expected: candidates.length > 0, target: Boolean(target), range: Boolean(a.range), flaky: a.flaky ? Number(a.flaky) : null },
  })
  // The developer log, next to the ticket's other files: local like the audit log, and off with it.
  let logPath = null
  if (a.key && !auditOff(env, a.noAudit)) {
    const rel = `${config.ticketsDir}/${a.key}/run.md`
    try {
      mkdirSync(dirname(resolve(root, rel)), { recursive: true })
      writeFileSync(resolve(root, rel), formatRunLog(outcome, { specs, key: a.key, jiraStatus, issueType, doneStatuses: doneStatusesOf(config), rules }))
      logPath = rel
    } catch {}
  }
  const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR
  printLine(a.json ? JSON.stringify(outcome) : formatCard(outcome, { specs, key: a.key ?? null, color, jiraStatus, issueType, doneStatuses: doneStatusesOf(config), log: logPath, rules }))
  return EXIT[outcome.verdict] ?? 2
}

if (isMain(import.meta.url)) {
  // A killed run (Ctrl-C, a tool call's timeout) stops the tools it started, their workers too, and
  // removes their temp files from the project. The mutation step's own handler, when one is set, exits.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); if (process.listenerCount(sig) === 1) process.exit(130) })
  process.exitCode = await main()
}
