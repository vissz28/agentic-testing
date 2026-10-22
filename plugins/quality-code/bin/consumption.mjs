// Entry point for /quality-code:consumption: AI usage and estimated cost of the plugin's runs in this project.
// node bin/consumption.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file] [--json]
// Reads local transcripts only and sends nothing anywhere. Exit 0 ok, 2 usage error, 3 no transcripts found.
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { keySource } from '../lib/base/keys.mjs'
import { loadConfig, projectRoot } from '../lib/base/config.mjs'
import { AS_OF, PRICES, SOURCE, loadPrices } from '../lib/report/prices.mjs'
import { BY, buildReport, formatCard, parsePeriod } from '../lib/report/consumption.mjs'
import { attribute, configDir, findProjectDirs, loadSessions } from '../lib/report/transcripts.mjs'

const USAGE = 'usage: consumption.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file.json] [--json]'

function parse(argv) {
  const a = { since: '30d', until: null, by: 'command', prices: null, json: false }
  const VALUE = new Set(['--since', '--until', '--by', '--prices'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json') a.json = true
    else throw new Error(`unknown option ${x}`)
  }
  if (!BY.includes(a.by)) throw new Error(`--by must be one of ${BY.join(', ')}, not "${a.by}"`)
  return a
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { now = Date.now(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const err = m => { stderr(`${m}\n`); return 2 }
  let a, period
  try {
    a = parse(argv)
    period = parsePeriod(a, now)
  } catch (e) { return err(`${e.message}. ${USAGE}`) }
  const root = projectRoot(env, cwd)
  let prices = PRICES
  let priceInfo = { asOf: AS_OF, source: SOURCE, override: null }
  if (a.prices) {
    try {
      const p = loadPrices(resolve(root, a.prices))
      prices = p.prices
      priceInfo = { asOf: p.asOf ?? AS_OF, source: `${p.source}, then ${SOURCE}`, override: a.prices, models: p.models }
    } catch (e) { return err(e.message) }
  }
  const { dirs, sessions: files, looked } = findProjectDirs(root, configDir(env))
  const sessions = dirs.flatMap(d => loadSessions(d, files[d]))
  if (!sessions.length) {
    stdout(`No Claude Code transcripts found for ${root}.\nLooked in:\n${looked.map(l => `  ${l}`).join('\n')}\n`)
    return 3
  }
  const cfg = loadConfig(root)
  const usage = attribute(sessions, cfg.ok ? { keySource: keySource(cfg.config) } : {})
  const report = buildReport(usage, { period, by: a.by, prices, project: basename(root), priceInfo })
  stdout(`${a.json ? JSON.stringify(report) : formatCard(report)}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
