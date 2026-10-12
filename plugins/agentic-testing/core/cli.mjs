#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from './config.mjs'
import { buildBrief, formatReport } from './score.mjs'
import { formatRefuseComment, jiraUpdate, formatJiraUpdate } from './jira.mjs'
import { sanitizeTicket } from './sanitize.mjs'
import { fillMenu, projectPick, formatFillMenu, formatPick, applyAnswer, exampleFor } from './fill.mjs'

const out = s => process.stdout.write(`${s}\n`)
const err = s => process.stderr.write(`${s}\n`)

// --no-audit is accepted and ignored: today's skills still pass it.
const KNOWN_FLAGS = new Set(['--ci', '--json', '--no-audit'])

function parseArgs(argv) {
  const a = { _: [], flags: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    // `--` ends the flags: everything after it is positional, so an answer may start with "--".
    if (t === '--') { a._.push(...argv.slice(i + 1)); break }
    if (t === '--in' || t === '--out') a[t.slice(2)] = argv[++i]
    else if (t.startsWith('--')) {
      if (!KNOWN_FLAGS.has(t)) throw new Error(`unknown arg: ${t}`)
      a.flags.add(t)
    } else a._.push(t)
  }
  return a
}

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const [cmd, ...rest] = argv
  let a
  try { a = parseArgs(rest) } catch (e) { err(e.message); return 2 }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root)
  if (cmd === 'config' && a._[0] === 'check') {
    if (cfg.ok) { out('ok'); return 0 }
    cfg.errors.forEach(e => out(e))
    return 2
  }
  if (!cfg.ok) { cfg.errors.forEach(e => err(e)); return 2 }
  const config = cfg.config
  if (!a.in) {
    err("usage: cli.mjs <score|refuse-comment|fill-menu|pick|add|jira-update|sanitize> --in '<json>'|@file [--ci] [--json]")
    return 2
  }
  const inPath = a.in.startsWith('@') ? resolve(root, a.in.slice(1)) : null
  let ticket
  try { ticket = JSON.parse(inPath ? readFileSync(inPath, 'utf8') : a.in) } catch (e) { err(`--in is not readable JSON: ${e.message}`); return 2 }
  if (!ticket || typeof ticket !== 'object') { err('--in must be a JSON object'); return 2 }
  const project = String(ticket.key ?? '').split('-')[0]
  const mismatch = Boolean(ticket.key) && !config.jira.projects.includes(project)
  if (mismatch) out(`PROJECT_MISMATCH:${JSON.stringify({ key: ticket.key, projects: config.jira.projects })}`)
  switch (cmd) {
    case 'sanitize': {
      if (!a.out) { err('sanitize needs --out <path>'); return 2 }
      const outPath = resolve(root, a.out)
      try {
        writeFileSync(outPath, `${JSON.stringify(sanitizeTicket(config, ticket))}\n`)
        // The raw input goes once the clean copy is on disk, unless the two are the same file.
        if (inPath && inPath !== outPath) unlinkSync(inPath)
      } catch (e) { err(`sanitize: cannot write ${a.out} (${e.code ?? e.message})`); return 2 }
      return 0
    }
    case 'score': {
      if (mismatch && a.flags.has('--ci')) return 2
      const b = buildBrief(config, ticket)
      if (a.flags.has('--json')) out(JSON.stringify(b))
      else { out(formatReport(b)); out(`TICKET_EVAL_JSON:${JSON.stringify(b)}`) }
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'refuse-comment': {
      const b = buildBrief(config, ticket)
      out(formatRefuseComment(config, b))
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'fill-menu': {
      const m = fillMenu(config, buildBrief(config, ticket))
      out(formatFillMenu(m))
      out(`FILL_JSON:${JSON.stringify({ score: m.score, threshold: m.threshold, items: m.items })}`)
      return 0
    }
    case 'pick': {
      const nums = String(a._[0] ?? '').split(/[\s,]+/).filter(Boolean)
      const p = projectPick(fillMenu(config, buildBrief(config, ticket)), nums)
      out(formatPick(p))
      out(`FILL_JSON:${JSON.stringify(p)}`)
      return p.error ? 2 : p.enough ? 0 : 1
    }
    case 'add': {
      if (!inPath) { err('add needs --in @<ticket.json> so the accepted answer can be saved'); return 2 }
      const [key, answer] = a._
      const r = applyAnswer(config, ticket, key, answer)
      if (r.ok) {
        try { writeFileSync(inPath, JSON.stringify(r.input)) } catch (e) { err(`add: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
        const b = r.brief
        out(`Accepted. The ticket now has ${b.score} points (the bar is ${b.threshold})${b.gate === 'pass' ? ': enough to continue.' : `: ${b.threshold - b.score} points short.`}`)
      } else {
        const example = exampleFor(config, ticket, key)
        out(`Not accepted: ${r.reason}${example ? `\nExample: ${example.replace(/\n/g, ' / ')}` : ''}`)
      }
      const after = r.brief ?? buildBrief(config, ticket)
      out(`FILL_JSON:${JSON.stringify({ ok: r.ok, reason: r.reason ?? null, score: after.score, gate: after.gate })}`)
      return r.ok ? 0 : 1
    }
    case 'jira-update': {
      const u = jiraUpdate(ticket)
      out(formatJiraUpdate(u))
      out(`JIRA_UPDATE_JSON:${JSON.stringify(u)}`)
      return 0
    }
    default: err(`unknown command: ${cmd}`); return 2
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exit(main())
