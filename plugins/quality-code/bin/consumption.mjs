// Entry point for /quality-code:consumption: AI usage and estimated cost of the plugin's runs in this project.
// node bin/consumption.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file] [--json | --report]
// Reads local transcripts only and sends nothing anywhere. Exit 0 ok, 2 usage error, 3 no transcripts found.
import { statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { keySource } from '../lib/base/keys.mjs'
import { configHome, loadConfig, projectRoot } from '../lib/base/config.mjs'
import { AS_OF, PRICES, SOURCE, loadPrices } from '../lib/report/prices.mjs'
import { BY, buildReport, formatCard, parsePeriod } from '../lib/report/consumption.mjs'
import { consumptionReport } from '../lib/report/build.mjs'
import { reportLines, reportsRoot, saveReport } from '../lib/report/save.mjs'
import { attribute, configDir, findProjectDirs, loadSessions } from '../lib/report/transcripts.mjs'

const mtimeOf = p => { try { return statSync(p).mtimeMs } catch { return 0 } }
const USAGE = 'usage: consumption.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file.json] [--session] [--json | --report]'

function parse(argv) {
  const a = { since: '30d', until: null, by: 'command', prices: null, json: false, report: false, session: false }
  const VALUE = new Set(['--since', '--until', '--by', '--prices'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json') a.json = true
    else if (x === '--report') a.report = true
    else if (x === '--session') a.session = true
    else throw new Error(`unknown option ${x}`)
  }
  if (!BY.includes(a.by)) throw new Error(`--by must be one of ${BY.join(', ')}, not "${a.by}"`)
  if (a.json && a.report) throw new Error('--json and --report do not go together')
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
  // A project with "root" set (an app in a monorepo) is often worked on from the repo top: look under both.
  const homes = [...new Set([root, configHome(root)])]
  const found = homes.map(h => findProjectDirs(h, configDir(env)))
  const dirs = [...new Set(found.flatMap(f => f.dirs))]
  const files = Object.assign({}, ...found.map(f => f.sessions ?? {}))
  const looked = found.flatMap(f => f.looked)
  // --session: only this session, the transcript written to last.
  if (a.session) {
    const all = dirs.flatMap(d => (files[d] ?? []).map(f => ({ d, f, at: mtimeOf(join(d, f)) })))
    const last = all.sort((x, y) => y.at - x.at)[0]
    for (const d of dirs) files[d] = last && d === last.d ? [last.f] : []
  }
  const sessions = dirs.flatMap(d => loadSessions(d, files[d]))
  if (!sessions.length) {
    stdout(`No Claude Code transcripts found for ${root}.\nLooked in:\n${looked.map(l => `  ${l}`).join('\n')}\n`)
    return 3
  }
  const cfg = loadConfig(root, env)
  const usage = attribute(sessions, cfg.ok ? { keySource: keySource(cfg.config) } : {})
  const report = buildReport(usage, { period, by: a.by, prices, project: basename(root), priceInfo })
  stdout(`${a.json ? JSON.stringify(report) : formatCard(report)}\n`)
  if (a.report) {
    // One self-contained HTML file with the cost by command, day and model; the card above stays the text version.
    const by = Object.fromEntries(['command', 'day', 'model'].map(b => [b, b === a.by ? report : buildReport(usage, { period, by: b, prices, project: basename(root), priceInfo })]))
    const built = consumptionReport(by, { config: cfg.ok ? cfg.config : null, now: new Date(now) })
    try {
      const path = saveReport(reportsRoot(root, cfg, env), 'consumption', new Date(now).toISOString().slice(0, 10), built.html)
      stdout(`${reportLines(path, 'Quality Code consumption', built.headline).join('\n')}\n`)
    } catch (e) { return err(`consumption: cannot save the report (${e.code ?? e.message})`) }
  }
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
