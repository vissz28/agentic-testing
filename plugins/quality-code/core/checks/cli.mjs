// Entry point for every check: node core/checks/cli.mjs <check> [args] [--json]
// Exit 0 pass, 1 fail, 2 usage or config error, 3 not run.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from '../config.mjs'
import * as boundary from './boundary.mjs'
import { dialectFor } from './dialects/index.mjs'
import * as flaky from './flaky.mjs'
import * as honesty from './honesty.mjs'
import { isProjectKey, projectKeys } from './keys.mjs'
import * as mutation from './mutation.mjs'
import { EXIT } from './result.mjs'
import * as suite from './suite-honesty.mjs'

const CHECKS = {
  boundary: { run: boundary.run, specs: 'none' },
  honesty: { run: honesty.run, specs: 'many' },
  'suite-honesty': { run: suite.run, specs: 'many' },
}
CHECKS.mutation = { run: mutation.run, specs: 'one' }
CHECKS.flaky = { run: flaky.run, specs: 'many' }
const NEEDS_RUNNER = new Set(['flaky', 'mutation'])
const USAGE = 'usage: cli.mjs <boundary|honesty|suite-honesty|flaky|mutation> [spec...] [--range A...B] [--key KEY] [--json] | boundary --hook'
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
  const VALUE = new Set(['--range', '--key', '--runs', '--timeout', '--test', '--baseline', '--max'])
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

async function hook(root, stdin) {
  let payload = {}
  try { payload = JSON.parse(stdin || '{}') } catch { return 0 }
  const c = loadConfig(root)
  const d = boundary.hookDecision(payload, { root, config: c.ok ? c.config : null })
  if (d.decision !== 'deny') return 0
  boundary.logBlocked(root, { decision: 'deny', tool: payload.tool_name ?? null, path: d.path, session: payload.session_id ?? null })
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: boundary.hookReason(d.path, d.why) } })}\n`)
  return 0
}

const readStdin = () => new Promise(done => {
  let s = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { s += d })
  process.stdin.on('end', () => done(s))
  process.stdin.on('error', () => done(''))
})

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = null) {
  const err = m => { process.stderr.write(`${m}\n`); return 2 }
  const [name, ...rest] = argv
  const root = projectRoot(env, cwd)
  if (name === 'boundary' && rest.includes('--hook')) {
    try { return await hook(root, stdin ?? await readStdin()) } catch { return 0 }
  }
  if (!name || (!CHECKS[name] && !NEEDS_RUNNER.has(name))) return err(USAGE)
  let a
  try { a = parse(rest) } catch (e) { return err(e.message) }
  const cfg = loadConfig(root)
  if (!cfg.ok) return err(cfg.errors.join('\n'))
  const config = cfg.config
  if (NEEDS_RUNNER.has(name)) return err(`${name} needs the test runner from the Vitest or Playwright adapter (coming in parts 3–4).`)
  const check = CHECKS[name]
  if (check.specs === 'many' && !a.specs.length) return err(`${name} needs at least one spec path. ${USAGE}`)
  for (const s of a.specs) if (!existsSync(resolve(root, s))) return err(`spec not found: ${s}`)
  if (a.key && !isProjectKey(config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(config).join(', ')}`)
  const ctx = { config, dialect: dialectFor(config.adapter), root }
  let r
  try {
    r = await check.run({ specs: a.specs, range: a.range ?? null, key: a.key ?? null }, ctx)
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
