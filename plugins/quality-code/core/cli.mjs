#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { audit } from './audit.mjs'
import { loadConfig, projectRoot } from './config.mjs'
import { e2eFolder, e2eFolderLine } from './e2e-folder.mjs'
import { buildBrief, formatReport, sideFor } from './score.mjs'
import { isFullstack, SIDES, ticketSide } from './stack.mjs'
import { formatRefuseComment, formatRiskComment, jiraUpdate, formatJiraUpdate } from './jira.mjs'
import { sanitizeTicket } from './sanitize.mjs'
import { resolveField, storeField } from './fields.mjs'
import { evalTickets, formatCard, saveTickets } from './batch.mjs'
import { fillMenu, projectPick, formatFillMenu, formatPick, applyAnswer, exampleFor } from './fill.mjs'

const out = s => process.stdout.write(`${s}\n`)
const err = s => process.stderr.write(`${s}\n`)

// --no-audit turns the local audit log off for this call (as QC_NO_AUDIT=1 does).
const KNOWN_FLAGS = new Set(['--ci', '--json', '--no-audit', '--save'])

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
  const cfg = loadConfig(root, env)
  if (cmd === 'config' && a._[0] === 'check') {
    if (cfg.ok) { out(`ok (${cfg.source}: ${cfg.path})`); return 0 }
    cfg.errors.forEach(e => out(e))
    return 2
  }
  if (!cfg.ok) { cfg.errors.forEach(e => err(e)); return 2 }
  const config = cfg.config
  const log = (kind, entry) => audit(root, kind, entry, { env, off: a.flags.has('--no-audit') })
  if (cmd === 'jira-posted') {
    // Called after the connector posted a refuse comment, pushed a fill-in or posted a risk note: the key and the kind only.
    const [key, action] = a._
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key ?? '') || !['comment', 'update', 'risk'].includes(action)) {
      err('usage: cli.mjs jira-posted <KEY> comment|update|risk')
      return 2
    }
    log('jira', { key, action })
    out('ok')
    return 0
  }
  if (cmd === 'config' && a._[0] === 'e2e-folder') {
    const r = e2eFolder(root, config)
    if (!r.ok) { err(r.error); return 2 }
    out(e2eFolderLine(r))
    out(`E2E_FOLDER_JSON:${JSON.stringify(r)}`)
    return 0
  }
  if (cmd === 'field') {
    const [sub, project, value] = a._
    if (sub === 'get' && project) {
      const r = resolveField(root, config, project)
      out(`FIELD_JSON:${JSON.stringify({ project, field: r.field ?? null, source: r.source })}`)
      return 0
    }
    if (sub === 'set' && project && value) {
      const r = storeField(root, project, value)
      if (!r.ok) { err(r.error); return 2 }
      out('ok')
      return 0
    }
    err('usage: cli.mjs field get <PROJECT> | field set <PROJECT> <customfield_N|none>')
    return 2
  }
  if (cmd === 'tickets-eval') {
    // Project-wide: --in is a JSON array of raw tickets. Scores them all, sends nothing, writes nothing unless --save.
    if (!a.in) { err('usage: cli.mjs tickets-eval --in @<tickets.json> [--json] [--save]'); return 2 }
    let list
    const listPath = a.in.startsWith('@') ? resolve(root, a.in.slice(1)) : null
    try { list = JSON.parse(listPath ? readFileSync(listPath, 'utf8') : a.in) } catch (e) { err(`--in is not readable JSON: ${e.message}`); return 2 }
    if (!Array.isArray(list) || list.some(t => !t || typeof t !== 'object' || Array.isArray(t))) { err('--in must be a JSON array of tickets'); return 2 }
    const r = evalTickets(config, list)
    if (a.flags.has('--save')) {
      try { saveTickets(root, config, r.clean) } catch (e) { err(`tickets-eval: cannot save (${e.code ?? e.message})`); return 2 }
    }
    // The raw search results go once they are scored (as sanitize removes raw.json).
    if (listPath) { try { unlinkSync(listPath) } catch { /* already gone */ } }
    const machine = `TICKETS_EVAL_JSON:${JSON.stringify({ summary: r.summary, tickets: r.rows })}`
    if (a.flags.has('--json')) out(machine)
    else { out(formatCard(r)); out(machine) }
    return 0
  }
  if (!a.in) {
    err("usage: cli.mjs <score|refuse-comment|risk-comment|fill-menu|pick|add|attachments|jira-update|sanitize|side> --in '<json>'|@file [--ci] [--json]")
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
      log('gate', {
        key: b.key, issuetype: b.issuetype, score: b.score, gate: b.gate, rubric: b.rubric, legacy: b.legacy,
        missing: b.missing.map(m => m.key), filled: Array.isArray(ticket.filled) ? ticket.filled.length : 0,
      })
      if (a.flags.has('--json')) out(JSON.stringify(b))
      else { out(formatReport(b)); out(`TICKET_EVAL_JSON:${JSON.stringify(b)}`) }
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'refuse-comment': {
      const b = buildBrief(config, ticket)
      out(formatRefuseComment(config, b))
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'risk-comment': {
      out(formatRiskComment(config, buildBrief(config, ticket)))
      return 0
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
      } else if (r.pending) {
        out(r.reason)
      } else {
        const example = exampleFor(config, ticket, key)
        out(`Not accepted: ${r.reason}${example ? `\nExample: ${example.replace(/\n/g, ' / ')}` : ''}`)
      }
      const after = r.brief ?? buildBrief(config, ticket)
      out(`FILL_JSON:${JSON.stringify({ ok: r.ok, ...(r.pending ? { pending: true } : {}), reason: r.reason ?? null, score: after.score, gate: after.gate })}`)
      return r.ok ? 0 : 1
    }
    case 'attachments': {
      // After the model read the ticket again: the file count from Jira is saved here, and the script re-scores.
      if (!inPath) { err('attachments needs --in @<ticket.json> to save the count'); return 2 }
      const n = Number(a._[0])
      if (!Number.isInteger(n) || n < 0) { err('usage: cli.mjs attachments --in @<ticket.json> <count>'); return 2 }
      const next = { ...ticket, attachments: n }
      try { writeFileSync(inPath, JSON.stringify(next)) } catch (e) { err(`attachments: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
      const b = buildBrief(config, next)
      out(`The ticket has ${n} attachment${n === 1 ? '' : 's'}: ${b.score} points (the bar is ${b.threshold})${b.gate === 'pass' ? ': enough to continue.' : `: ${b.threshold - b.score} points short.`}`)
      out(`FILL_JSON:${JSON.stringify({ attachments: n, score: b.score, gate: b.gate })}`)
      return 0
    }
    case 'side': {
      // Fullstack projects: which side a ticket gets tests on. With a side, it is saved in the ticket file.
      if (!isFullstack(config)) { err(`side is for fullstack projects: this one is ${config.adapter}`); return 2 }
      const [value] = a._
      if (value === undefined) {
        const side = sideFor(config, ticket)
        out(`SIDE_JSON:${JSON.stringify({ side, source: ticket.side ? 'set' : side ? 'ticket' : null })}`)
        return 0
      }
      if (!SIDES.includes(value)) { err(`side must be one of ${SIDES.join(', ')}, not "${value}"`); return 2 }
      if (!inPath) { err('side needs --in @<ticket.json> to save the side'); return 2 }
      try { writeFileSync(inPath, JSON.stringify({ ...ticket, side: value })) } catch (e) { err(`side: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
      out(`ok: ${ticket.key ?? 'the ticket'} gets ${value} tests${ticketSide(config, ticket) && ticketSide(config, ticket) !== value ? ` (its title or labels say ${ticketSide(config, ticket)})` : ''}`)
      return 0
    }
    case 'jira-update': {
      const u = jiraUpdate(config, ticket)
      out(formatJiraUpdate(u))
      out(`JIRA_UPDATE_JSON:${JSON.stringify(u)}`)
      return 0
    }
    default: err(`unknown command: ${cmd}`); return 2
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exit(main())
