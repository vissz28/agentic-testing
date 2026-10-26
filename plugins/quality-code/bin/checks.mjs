// Entry point for every check: node bin/checks.mjs <check> [args] [--json]
// Exit 0 pass, 1 fail, 2 usage or config error, 3 not run.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { configHome, findRoot, loadConfig, projectRoot } from '../lib/base/config.mjs'
import * as boundary from '../lib/base/boundary.mjs'
import { dialectFor } from '../lib/base/dialects/index.mjs'
import { runnerOf } from '../lib/base/runners.mjs'
import { adapterOfSpec, asAdapter, isFullstack, specsByAdapter } from '../lib/base/stack.mjs'
import { mergeSides } from '../lib/pipeline/pipeline.mjs'
import * as expected from '../lib/pipeline/checks/expected.mjs'
import * as flaky from '../lib/pipeline/checks/flaky.mjs'
import * as honesty from '../lib/pipeline/checks/honesty.mjs'
import { isProjectKey, projectKeys } from '../lib/base/keys.mjs'
import * as mutation from '../lib/pipeline/checks/mutation.mjs'
import * as runMarker from '../lib/base/run.mjs'
import { EXIT } from '../lib/base/result.mjs'
import * as suite from '../lib/pipeline/checks/suite-honesty.mjs'
import { backendOf } from '../lib/base/backends.mjs'

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

/** For parts 3–4: run one check with a ready context. */
export async function runCheck(name, input, ctx) {
  const c = CHECKS[name]
  if (!c) throw new Error(`unknown check: ${name}`)
  if (NEEDS_RUNNER.has(name) && typeof ctx.runTests !== 'function') throw new Error(`${name} needs ctx.runTests`)
  return c.run(input, ctx)
}

export function registerCheck(name, run, specs) {
  CHECKS[name] = { run, specs }
}

function parse(argv) {
  const a = { flags: new Set(), specs: [] }
  const VALUE = new Set(['--range', '--key', '--runs', '--timeout', '--test', '--baseline', '--max', '--ticket'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json' || x === '--hook' || x === '--thorough') a.flags.add(x)
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
  const d = boundary.hookDecision(payload, { root, home: configHome(root), config: c.ok ? c.config : null })
  if (d.decision !== 'deny') return 0
  boundary.logBlocked(root, { decision: 'deny', tool: payload.tool_name ?? null, path: d.path, session: payload.session_id ?? null })
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: boundary.hookReason(d.path, d.why) } })}\n`)
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
    if (!r.ok) { process.stderr.write(`${r.error}\n`); return 1 }
    process.stdout.write(`run started for ${r.marker.key}${r.replacedStale ? ' (a stale marker was replaced)' : ''}\n`)
    return 0
  }
  if (sub === 'stop') {
    const r = runMarker.stopRun(root)
    process.stdout.write(r.removed ? 'run stopped\n' : 'no active run\n')
    return 0
  }
  if (sub === 'status') {
    const s = runMarker.runStatus(root)
    process.stdout.write(`${a.flags.has('--json') ? JSON.stringify(s) : runMarker.statusLine(s)}\n`)
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

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = null) {
  const err = m => { process.stderr.write(`${m}\n`); return 2 }
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
    r = isFullstack(config) ? await fullstackCheck(name, check, args, config, root) : await check.run(args, { config, dialect: dialectFor(runnerOf(config)), root })
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0]
    process.stderr.write(`check ${name} crashed: ${msg}\n`)
    return 2
  }
  if (a.flags.has('--json')) process.stdout.write(`${JSON.stringify(r)}\n`)
  else {
    const lines = [`${ICON[r.status]} ${r.check}: ${r.summary}`]
    for (const f of r.findings) lines.push(`   ${[f.file, f.test && `'${f.test}'`].filter(Boolean).join(' › ')}${f.kind ? ` [${f.kind}]` : ''}${f.detail ? `: ${f.detail}` : ''}`)
    lines.push(`CHECK_JSON:${JSON.stringify(r)}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  return EXIT[r.status]
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
