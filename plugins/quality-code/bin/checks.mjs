// Entry point for every check: node bin/checks.mjs <check> [args] [--json]
// Exit 0 pass, 1 fail, 2 usage or config error, 3 not run.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { claudeDir, configHome, configPath, findRoot, loadConfig, projectRoot } from '../lib/config/config.mjs'
import * as boundary from '../lib/pipeline/boundary.mjs'
import { dialectFor } from '../lib/stacks/dialects/index.mjs'
import { runnerOf } from '../lib/stacks/runners.mjs'
import { adapterOfSpec, asAdapter, isFullstack, specsByAdapter } from '../lib/stacks/stack.mjs'
import { mergeSides } from '../lib/pipeline/pipeline.mjs'
import * as expected from '../lib/pipeline/checks/expected.mjs'
import * as flaky from '../lib/pipeline/checks/flaky.mjs'
import * as honesty from '../lib/pipeline/checks/honesty.mjs'
import { isProjectKey, projectKeys } from '../lib/config/keys.mjs'
import * as mutation from '../lib/pipeline/checks/mutation.mjs'
import * as runMarker from '../lib/pipeline/run.mjs'
import { EXIT } from '../lib/pipeline/result.mjs'
import * as suite from '../lib/pipeline/checks/suite-honesty.mjs'
import { backendOf } from '../lib/stacks/backends.mjs'
import { isMain, tag, printLine, printError } from '../lib/core/script-io.mjs'

const CHECKS = {
  boundary: { run: boundary.run, specs: 'none' },
  honesty: { run: honesty.run, specs: 'many' },
  'suite-honesty': { run: suite.run, specs: 'many' },
  expected: { run: expected.run, specs: 'many' },
}
CHECKS.mutation = { run: mutation.run, specs: 'one' }
CHECKS.flaky = { run: flaky.run, specs: 'many' }
const NEEDS_RUNNER = new Set(['flaky', 'mutation'])
const USAGE = 'usage: checks.mjs <boundary|honesty|suite-honesty|flaky|mutation> [spec...] [--range A...B] [--key KEY] [--json] | expected --ticket @file --key KEY <spec...> | boundary --hook | run start --key KEY | run stop | run status [--json] (run: exit 0 ok, 1 a run is already active, 2 usage; status exits 0 also with no active run)'
const ICON = { pass: '✅', fail: '❌', not_run: '⚠️' }

export function registerCheck(name, run, specs) {
  CHECKS[name] = { run, specs }
}

function parse(argv) {
  const a = { flags: new Set(), specs: [] }
  const VALUE = new Set(['--range', '--key', '--ticket'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json' || x === '--hook') a.flags.add(x)
    else if (x.startsWith('-')) throw new Error(`unknown option ${x}`)
    else a.specs.push(x)
  }
  return a
}

async function hook(sessionRoot, stdin) {
  let payload = {}
  try { payload = JSON.parse(stdin || '{}') } catch { return 0 }
  // The project the file is in (a package of a monorepo with its own config), else the session's.
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  const root = (typeof target === 'string' && target && findRoot(dirname(resolve(sessionRoot, target)))) || sessionRoot
  const c = loadConfig(root)
  const home = configHome(root)
  const qc = join(claudeDir(), 'quality-code')
  const guarded = [configPath(home), join(qc, 'save.json'), join(qc, 'roots.json')]
  const d = boundary.hookDecision(payload, { root, home, config: c.ok ? c.config : null, runRoots: [root, sessionRoot], guarded })
  if (d.decision !== 'deny') return 0
  boundary.logBlocked(root, { decision: 'deny', tool: payload.tool_name ?? null, path: d.path, session: payload.session_id ?? null })
  printLine(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: boundary.hookReason(d.path, d.why) } }))
  return 0
}

/** run start --key KEY | run stop | run status [--json] */
function runCmd(root, rest, err) {
  const [sub, ...more] = rest
  let a
  try { a = parse(more) } catch (e) { return err(e.message) }
  if (a.specs.length) return err(`unexpected argument ${a.specs[0]}. ${USAGE}`)
  if (sub === 'start') {
    if (!a.key) return err(`run start needs --key KEY. ${USAGE}`)
    const cfg = loadConfig(root)
    if (!cfg.ok) return err(cfg.errors.join('\n'))
    if (!isProjectKey(cfg.config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(cfg.config).join(', ')}`)
    const r = runMarker.startRun(root, a.key)
    if (!r.ok) { printError(r.error); return 1 }
    printLine(`run started for ${r.marker.key}${r.replacedStale ? ' (a stale marker was replaced)' : ''}`)
    return 0
  }
  if (sub === 'stop') {
    const r = runMarker.stopRun(root)
    process.stdout.write(r.removed ? 'run stopped\n' : 'no active run\n')
    return 0
  }
  if (sub === 'status') {
    const s = runMarker.runStatus(root)
    printLine(a.flags.has('--json') ? JSON.stringify(s) : runMarker.statusLine(s))
    return 0
  }
  return err(USAGE)
}

const readStdin = () => new Promise(done => {
  let s = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { s += d })
  process.stdin.on('end', () => done(s))
  process.stdin.on('error', () => done(''))
})

/** A fullstack project: each side's specs in their own dialect, one result. */
async function fullstackCheck(name, check, args, config, root) {
  const side = adapter => ({ config: asAdapter(config, adapter), dialect: dialectFor(runnerOf(config, adapter)), root })
  if (check.specs === 'none') return check.run(args, side(backendOf(config)))
  if (name === 'expected') return check.run(args, { config, root, dialectOf: p => dialectFor(runnerOf(config, adapterOfSpec(config, root, p))) })
  const parts = []
  for (const [adapter, specs] of specsByAdapter(config, root, args.specs)) parts.push({ adapter, steps: [await check.run({ ...args, specs }, side(adapter))] })
  return parts.length === 1 ? parts[0].steps[0] : mergeSides(parts)[0]
}

/** One check over a project's specs: each side of a fullstack project in its own dialect. */
export const checkProject = (name, args, config, root) =>
  isFullstack(config) ? fullstackCheck(name, CHECKS[name], args, config, root) : CHECKS[name].run(args, { config, dialect: dialectFor(runnerOf(config)), root })

/** A result as lines: the verdict, then one line per finding. */
export function formatResult(r) {
  const lines = [`${ICON[r.status]} ${r.check}: ${r.summary}`]
  for (const f of r.findings) lines.push(`   ${[f.file, f.test && `'${f.test}'`].filter(Boolean).join(' › ')}${f.kind ? ` [${f.kind}]` : ''}${f.detail ? `: ${f.detail}` : ''}`)
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = null) {
  const err = m => { printError(m); return 2 }
  const [name, ...rest] = argv
  const root = projectRoot(env, cwd)
  if (name === 'boundary' && rest.includes('--hook')) {
    try { return await hook(root, stdin ?? await readStdin()) } catch { return 0 }
  }
  if (name === 'run') return runCmd(root, rest, err)
  if (!name || (!CHECKS[name] && !NEEDS_RUNNER.has(name))) return err(USAGE)
  let a
  try { a = parse(rest) } catch (e) { return err(e.message) }
  const cfg = loadConfig(root)
  if (!cfg.ok) return err(cfg.errors.join('\n'))
  const config = cfg.config
  if (NEEDS_RUNNER.has(name)) return err(`${name} needs the test runner: it runs in the pipeline, node bin/pipeline.mjs <spec…>${name === 'flaky' ? ' --flaky N' : ''}`)
  const check = CHECKS[name]
  if (check.specs === 'many' && !a.specs.length) return err(`${name} needs at least one spec path. ${USAGE}`)
  for (const s of a.specs) if (!existsSync(resolve(root, s))) return err(`spec not found: ${s}`)
  if (a.key && !isProjectKey(config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(config).join(', ')}`)
  if (name === 'expected' && (!a.ticket || !a.key)) return err(`expected needs --ticket @file and --key KEY. ${USAGE}`)
  const ticket = a.ticket ? a.ticket.replace(/^@/, '') : null
  const args = { specs: a.specs, range: a.range ?? null, key: a.key ?? null, ticket }
  let r
  try {
    r = await checkProject(name, args, config, root)
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0]
    printError(`check ${name} crashed: ${msg}`)
    return 2
  }
  if (a.flags.has('--json')) printLine(JSON.stringify(r))
  else printLine(`${formatResult(r)}\n${tag('CHECK', r)}`)
  return EXIT[r.status]
}

if (isMain(import.meta.url)) process.exitCode = await main()
