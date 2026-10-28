#!/usr/bin/env node
// A routine: a check that runs on a schedule and says whether the tests still pass after other people pushed,
// and whether they are stable (the same code passing and failing). The schedule itself is made by
// /quality-code:routine with Claude's scheduler; this script is what each scheduled run executes.
//   node bin/routine.mjs run [--task KEY] [--branch REF] [--since "<git date>" | --since-last] [--until YYYY-MM-DD]
//                            [--stability N] [--force] [--json] [--junit FILE]
//   node bin/routine.mjs status [--task KEY] [--last N] [--json]
// run:    fetches the watched branch, sees what others pushed (new commits, shared files such as package.json or a
//         lockfile), then runs the task's tests (the specs that name the ticket KEY) or the whole suite. With
//         --stability N every test runs N times and the ones that pass and fail on the same code are named (flaky).
//         It says so when the result went from green to not green, with the commits in between. No new commit
//         (with --since-last or --since): nothing to check, exit 0. Every run is kept in a local history.
// status: the stability of the last runs from that history: pass rate, flaky tests seen, green to red changes.
// Exit 0 green or nothing new, 1 a check failed or a test is red, 2 usage or config error, 3 something could not run (never a pass).
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from '../lib/base/config.mjs'
import { isProjectKey, keyPattern, projectKeys } from '../lib/base/keys.mjs'
import { PLAIN } from '../lib/base/git.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { SHARED_CONFIG } from '../lib/base/changes.mjs'
import { junit } from './ci.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: routine.mjs run [--task KEY] [--branch REF] [--since "<git date>" | --since-last] [--until YYYY-MM-DD] [--stability N] [--force] [--json] [--junit FILE] | routine.mjs status [--task KEY] [--last N] [--json]'
const VALUE = ['--task', '--branch', '--since', '--until', '--stability', '--flaky', '--junit', '--last', '--id']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_RUNS = 3

const git = (root, args) => {
  try { return execFileSync('git', [...PLAIN, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

function parse(argv) {
  const [cmd, ...rest] = argv
  const a = { cmd, force: false, json: false, sinceLast: false }
  if (!['run', 'status'].includes(cmd)) throw new Error(`the first word is run or status. ${USAGE}`)
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i]
    if (VALUE.includes(x)) {
      const v = rest[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--force') a.force = true
    else if (x === '--json') a.json = true
    else if (x === '--since-last') a.sinceLast = true
    else throw new Error(`unknown option ${x}`)
  }
  // --id names the scheduled task that calls this; the script only accepts it.
  a.stability ??= a.flaky
  for (const k of ['stability', 'last']) if (a[k] !== undefined && !/^[1-9]\d*$/.test(a[k])) throw new Error(`--${k} must be a whole number of 1 or more, not "${a[k]}"`)
  if (a.until !== undefined && !DATE.test(a.until)) throw new Error(`--until must be a date like 2026-12-31, not "${a.until}"`)
  if (a.since !== undefined && a.sinceLast) throw new Error('give --since or --since-last, not both')
  if (cmd === 'status' && (a.since || a.sinceLast || a.until || a.stability || a.junit || a.branch || a.force)) throw new Error('status takes --task, --last and --json')
  return a
}

const dirOf = cfg => (cfg.auditDir ? join(cfg.auditDir, 'routine') : null)
const readState = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} } }
function keep(dir, name, text, append) {
  try {
    mkdirSync(dir, { recursive: true })
    // The folder ignores itself, like the audit log, so it stays out of git.
    try { writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' }) } catch {}
    ;(append ? appendFileSync : writeFileSync)(join(dir, name), text)
  } catch {}
}
const readHistory = dir => {
  try { return readFileSync(join(dir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
}

/** The stability of a list of runs { at, exit, flaky:[names] }, newest last. */
export function stabilityOf(runs) {
  const passed = runs.filter(r => r.exit === 0).length
  const flakyCount = new Map()
  for (const r of runs) for (const t of r.flaky ?? []) flakyCount.set(t, (flakyCount.get(t) ?? 0) + 1)
  let flips = 0, streak = 0
  for (let i = 0; i < runs.length; i++) if (i && runs[i - 1].exit === 0 && runs[i].exit !== 0) flips++
  for (let i = runs.length - 1; i >= 0 && runs[i].exit === 0; i--) streak++
  const rate = runs.length ? Math.round((passed / runs.length) * 100) : null
  const flaky = [...flakyCount].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
  const verdict = runs.length < MIN_RUNS ? 'NOT ENOUGH DATA' : flaky.length || rate < 90 ? 'UNSTABLE' : 'STABLE'
  return { runs: runs.length, passed, failed: runs.length - passed, rate, streak, flips, flaky, verdict }
}

/** Runs the task's tests or the whole suite → { exit, verdict, phases, flaky }. */
function realRun({ root, specs, key, stability, env }) {
  const extra = stability ? ['--flaky', stability] : []
  if (specs) {
    const r = spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), ...specs, '--key', key, '--json', ...extra], { cwd: root, env: { ...env, CI: '1' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    let o = null
    try { o = JSON.parse(r.stdout) } catch {}
    const t = o?.steps?.find(x => x.check === 'tests')?.data ?? {}
    const flaky = (o?.steps?.find(x => x.check === 'flaky')?.data?.tests ?? []).filter(x => x.verdict === 'flaky').map(x => x.title)
    return { exit: o ? r.status : 3, verdict: o?.verdict ?? 'not_verified', flaky, phases: [{ name: key, verdict: o?.verdict ?? 'not_verified', passed: t.passed, failed: t.failed, detail: o ? '' : (r.stderr || r.stdout).trim() }] }
  }
  const r = spawnSync(process.execPath, [join(HERE, 'ci.mjs'), '--all', '--json', ...extra], { cwd: root, env: { ...env, CI: '1' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  let o = null
  try { o = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('{'))) } catch {}
  return { exit: o?.exit ?? 3, verdict: o ? (o.exit === 0 ? 'green' : o.exit === 1 ? 'checks_failed' : 'not_verified') : 'not_verified', flaky: (o?.phases ?? []).flatMap(p => p.flaky ?? []), phases: o?.phases ?? [{ name: 'suite', verdict: 'not_verified', detail: (r.stderr || r.stdout).trim() }] }
}

function status(a, cfg, dir, stdout) {
  let runs = dir ? readHistory(dir) : []
  if (a.task) runs = runs.filter(r => r.task === a.task)
  else runs = runs.filter(r => !r.task)
  runs = runs.slice(-Number(a.last ?? 20))
  const s = stabilityOf(runs)
  if (a.json) { stdout(`${JSON.stringify({ task: a.task ?? null, ...s, flaky: s.flaky.map(([test, times]) => ({ test, times })) })}\n`); return 0 }
  const lines = [`quality-code routine status · ${a.task ? `task ${a.task}` : 'whole suite'} · ${s.runs ? `last ${s.runs} run${s.runs === 1 ? '' : 's'}, ${runs[0].at.slice(0, 10)} to ${runs.at(-1).at.slice(0, 10)}` : 'no runs kept yet'}`]
  if (!dir) lines.push('Files and logs are kept only in the chat, so there is no history. Change it with /quality-code:config, item 7.')
  if (s.runs) {
    lines.push(`  passed ${s.passed} · not green ${s.failed} · pass rate ${s.rate}%`, `  green in a row now: ${s.streak} · green to red changes: ${s.flips}`)
    if (s.flaky.length) {
      lines.push(`  flaky tests seen (${s.flaky.length}):`)
      for (const [t, n] of s.flaky.slice(0, 10)) lines.push(`    ${t}: in ${n} run${n === 1 ? '' : 's'}`)
      if (s.flaky.length > 10) lines.push(`    … and ${s.flaky.length - 10} more`)
    } else if (runs.some(r => r.stability)) lines.push('  no flaky test seen')
    else lines.push('  flaky tests were not looked for: run the routine with --stability 5')
  }
  lines.push(`Stability: ${s.verdict}${s.verdict === 'NOT ENOUGH DATA' ? ` (needs ${MIN_RUNS} runs)` : s.verdict === 'UNSTABLE' ? ' (a flaky test was seen, or fewer than 90% of the runs were green)' : ''}`)
  stdout(`${lines.join('\n')}\n`)
  return 0
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s), run = realRun, now = new Date() } = {}) {
  let a
  try { a = parse(argv) } catch (e) { stderr(`${e.message}\n`); return 2 }
  const root = projectRoot(env, cwd)
  const today = now.toISOString().slice(0, 10)
  if (a.cmd === 'run' && a.until && today > a.until) { stdout(`routine ended on ${a.until}: nothing to do. Delete its schedule.\n`); return 0 }
  const cfg = loadConfig(root)
  if (!cfg.ok) { stderr(`${cfg.errors.join('\n')}\n`); return 2 }
  if (cfg.source === 'personal') { stderr('A routine needs a repo with its own .claude/quality-code.json (run /quality-code:setup in the project).\n'); return 2 }
  const config = cfg.config
  if (a.task && !isProjectKey(config, a.task)) { stderr(`--task ${a.task} is not a key of ${projectKeys(config).join(', ')}\n`); return 2 }
  const dir = dirOf(cfg)
  if (a.cmd === 'status') return status(a, cfg, dir, stdout)
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') { stderr('A routine needs a git repo: it watches what others push.\n'); return 2 }

  const branch = a.branch ?? config.git?.base ?? git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? 'main'
  const bare = branch.replace(/^origin\//, '')
  const fetched = git(root, ['fetch', '--quiet', 'origin', bare]) !== null
  const ref = [`origin/${bare}`, bare].find(r => git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]) !== null)
  if (!ref) { stderr(`Branch ${branch} was not found (fetch it, or give --branch).\n`); return 2 }
  const tip = git(root, ['rev-parse', ref])
  const stateName = `last${a.task ? `-${a.task}` : ''}.json`
  const prev = dir && existsSync(join(dir, stateName)) ? readState(join(dir, stateName)) : {}

  // What is new: since the last check (--since-last, needs the kept result), or since a date (--since); else everything counts.
  const log = args => (git(root, ['log', '--format=%h%x09%an%x09%s', ...args]) ?? '').split('\n').filter(Boolean).map(l => { const [h, an, ...s] = l.split('\t'); return { sha: h, author: an, subject: s.join('\t') } })
  const known = a.sinceLast && prev.sha && prev.branch === ref
  let newCommits = []
  if (known) newCommits = prev.sha === tip ? [] : log([`${prev.sha}..${tip}`])
  else if (a.since) newCommits = log([`--since=${a.since}`, ref])
  const filtering = a.sinceLast ? known : Boolean(a.since)
  const lines = [`quality-code routine · ${a.task ? `task ${a.task}` : 'whole suite'} · ${ref}${fetched ? '' : ' (could not fetch: using what is here)'}`]
  if (filtering && !newCommits.length && !a.force) {
    lines.push(`No new commits on ${ref} ${a.sinceLast ? `since the last check (${prev.sha.slice(0, 7)}, ${prev.verdict})` : `since ${a.since}`}: nothing to check.`)
    stdout(`${lines.join('\n')}\n`)
    return 0
  }
  if (newCommits.length) {
    const authors = new Set(newCommits.map(c => c.author))
    const changed = (git(root, ['diff', '--name-only', `${newCommits.at(-1).sha}^`, tip]) ?? '').split('\n').filter(Boolean)
    const shared = changed.filter(f => SHARED_CONFIG.test(f))
    lines.push(`New: ${newCommits.length} commit${newCommits.length === 1 ? '' : 's'} by ${authors.size} author${authors.size === 1 ? '' : 's'}, ${changed.length} file${changed.length === 1 ? '' : 's'}.`)
    if (shared.length) lines.push(`Integral change: ${shared.slice(0, 5).join(', ')}${shared.length > 5 ? ` and ${shared.length - 5} more` : ''}.`)
  } else lines.push(a.force ? 'Forced run.' : 'First check of this branch: running.')

  let specs = null
  if (a.task) {
    const own = keyPattern(a.task)
    specs = projectSpecs(root, config).map(s => s.path).filter(p => own.test(p) || own.test(readFileSync(join(root, p), 'utf8')))
    if (!specs.length) {
      lines.push(`No spec names ${a.task}, so nothing was verified.`)
      stdout(`${lines.join('\n')}\n`)
      return 3
    }
    lines.push(`Running ${specs.length} spec${specs.length === 1 ? '' : 's'} of ${a.task}${a.stability ? `, each test ${a.stability} times` : ''}.`)
  } else lines.push(`Running every test of the project${a.stability ? `, each test ${a.stability} times` : ''}.`)
  const result = await run({ root, specs, key: a.task, stability: a.stability, env })
  const green = result.exit === 0
  const regression = !green && prev.verdict === 'green' && prev.sha && prev.sha !== tip
  lines.push('')
  for (const p of result.phases) lines.push(`  ${String(p.name).padEnd(14)} ${p.verdict}${p.passed !== undefined ? ` · ${p.passed} passed · ${p.failed} failed` : ''}`)
  const flaky = [...new Set(result.flaky ?? [])]
  if (a.stability) lines.push(flaky.length ? `  Flaky (${flaky.length}), passed and failed on the same code in ${a.stability} runs:` : `  Stable: no test changed its result in ${a.stability} runs.`, ...flaky.slice(0, 10).map(t => `    ${t}`), ...(flaky.length > 10 ? [`    … and ${flaky.length - 10} more`] : []))
  lines.push('', `Result: ${green ? 'PASSED' : result.exit === 1 ? 'FAILED' : 'NOT VERIFIED'}${green ? '' : ` (exit ${result.exit})`}`)
  if (regression) {
    const between = log([`${prev.sha}..${tip}`])
    lines.push(`REGRESSION: green at ${prev.sha.slice(0, 7)} (${prev.at?.slice(0, 16).replace('T', ' ')}), not green at ${tip.slice(0, 7)}. Commits in between:`)
    for (const c of between.slice(0, 15)) lines.push(`  ${c.sha} ${c.author}: ${c.subject}`)
    if (between.length > 15) lines.push(`  … and ${between.length - 15} more`)
  }
  if (dir && result.exit !== 2) {
    keep(dir, stateName, JSON.stringify({ branch: ref, sha: tip, verdict: green ? 'green' : 'not green', at: now.toISOString(), task: a.task ?? null }), false)
    keep(dir, 'history.jsonl', `${JSON.stringify({ at: now.toISOString(), sha: tip, task: a.task ?? null, exit: result.exit, stability: a.stability ? Number(a.stability) : null, flaky })}\n`, true)
  }
  if (a.junit) { try { mkdirSync(dirname(resolve(root, a.junit)), { recursive: true }); writeFileSync(resolve(root, a.junit), junit(result.phases.map(p => ({ ...p, detail: p.detail || lines.join('\n') })))) } catch {} }
  if (a.json) stdout(`${JSON.stringify({ exit: result.exit, ref, sha: tip, task: a.task ?? null, regression, newCommits: newCommits.length, flaky, phases: result.phases.map(({ detail, ...p }) => p) })}\n`)
  else stdout(`${lines.join('\n')}\n`)
  return result.exit
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
