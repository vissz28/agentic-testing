// Entry point for the pipeline (Vitest and Playwright): node core/pipeline/cli.mjs <spec...> [--key KEY] [--range A...B] [--flaky N] [--ticket @file] [--target path] [--json]
// Exit 0 green, 1 checks failed or tests red, 2 usage/config error or a crash, 3 not verified.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialectFor } from '../checks/dialects/index.mjs'
import { isProjectKey, projectKeys } from '../checks/keys.mjs'
import { loadConfig, projectRoot } from '../config.mjs'
import { formatCard } from './card.mjs'
import { normalizeSpec, runPipeline as realRunPipeline } from './pipeline.mjs'

const USAGE = 'usage: cli.mjs <spec...> [--key KEY] [--range A...B] [--flaky N] [--ticket @file] [--target path] [--json]'
const EXIT = { green: 0, checks_failed: 1, tests_red: 1, not_verified: 3 }

function parse(argv) {
  const a = { json: false, specs: [] }
  const VALUE = new Set(['--range', '--key', '--flaky', '--ticket', '--target'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json') a.json = true
    else if (x.startsWith('-')) throw new Error(`unknown option ${x}`)
    else a.specs.push(x)
  }
  if (a.flaky !== undefined && !/^[1-9]\d*$/.test(a.flaky)) throw new Error(`--flaky must be a whole number of 1 or more, not "${a.flaky}"`)
  return a
}

const isFile = p => { try { return statSync(p).isFile() } catch { return false } }

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { runPipeline = realRunPipeline } = {}) {
  const err = m => { process.stderr.write(`${m}\n`); return 2 }
  let a
  try { a = parse(argv) } catch (e) { return err(e.message) }
  if (!a.specs.length) return err(`needs at least one spec path. ${USAGE}`)
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root)
  if (!cfg.ok) return err(cfg.errors.join('\n'))
  const config = cfg.config
  for (const s of a.specs) {
    const rel = normalizeSpec(root, resolve(root, s))
    if (rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return err(`spec must be inside the project: ${s}`)
    if (!isFile(resolve(root, rel))) return err(`spec not found: ${s}`)
  }
  if (a.key && !isProjectKey(config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(config).join(', ')}`)
  const inside = rel => !(rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/'))
  let ticket = null
  if (a.ticket !== undefined) {
    const t = a.ticket.replace(/^@/, '')
    if (!t) return err('--ticket needs a file, like --ticket @path/ticket.json')
    ticket = resolve(root, t)
    let obj
    try { obj = JSON.parse(readFileSync(ticket, 'utf8')) } catch (e) { return err(`--ticket ${t}: ${isFile(ticket) ? `not valid JSON (${e.message.split('\n')[0]})` : 'file not found'}`) }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return err(`--ticket ${t}: not a ticket object`)
  }
  let target = null
  if (a.target !== undefined && config.adapter === 'playwright') return err('--target runs Stryker, which is for Vitest projects: leave it out for Playwright specs')
  if (a.target !== undefined) {
    target = normalizeSpec(root, resolve(root, a.target))
    if (!inside(target)) return err(`--target must be inside the project: ${a.target}`)
    if (!isFile(resolve(root, target))) return err(`--target not found: ${a.target}`)
    if (a.specs.some(s => normalizeSpec(root, resolve(root, s)) === target)) return err(`--target ${a.target} is one of the specs: name the code the tests check`)
  }
  const ctx = { config, dialect: dialectFor(config.adapter), root }
  let outcome
  try {
    outcome = await runPipeline({ specs: a.specs, key: a.key ?? null, range: a.range ?? null, flakyRuns: a.flaky ? Number(a.flaky) : null, ticket, target }, ctx)
  } catch (e) {
    process.stderr.write(`check ${e?.step ?? 'pipeline'} crashed: ${String(e?.message ?? e).split('\n')[0]}\n`)
    return 2
  }
  const specs = [...new Set(a.specs.map(s => normalizeSpec(root, s)))]
  process.stdout.write(`${a.json ? JSON.stringify(outcome) : formatCard(outcome, { specs, key: a.key ?? null })}\n`)
  return EXIT[outcome.verdict] ?? 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
