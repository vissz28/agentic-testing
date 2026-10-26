#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { audit } from '../lib/base/audit.mjs'
import { loadConfig, normaliseTicketsDir, projectRoot } from '../lib/base/config.mjs'
import { e2eFolder, e2eFolderLine } from '../lib/base/e2e-folder.mjs'
import { buildBrief, formatReport, sideFor } from '../lib/ticket/score.mjs'
import { isFullstack, SIDES, ticketSide } from '../lib/base/stack.mjs'
import { formatRefuseComment, formatRiskComment, jiraUpdate, formatJiraUpdate } from '../lib/ticket/jira.mjs'
import { sanitizeTicket } from '../lib/ticket/sanitize.mjs'
import { findFields, resolveField, storeField } from '../lib/ticket/fields.mjs'
import { projectKeys } from '../lib/base/keys.mjs'
import { evalTickets, formatCard, saveTickets } from '../lib/ticket/batch.mjs'
import { fillMenu, projectPick, formatFillMenu, formatPick, applyAnswer, exampleFor, figmaLinks, nextStep, formatNextStep } from '../lib/ticket/fill.mjs'

const out = s => process.stdout.write(`${s}\n`)
const err = s => process.stderr.write(`${s}\n`)

// --no-audit turns the local audit log off for this call (as QC_NO_AUDIT=1 does). --next adds the
// gate's band and the cheapest way over the bar to `score` (its default output stays as it is).
// --save keeps the per-ticket results of `tickets-eval`. --drafted marks an `add` answer as the
// model's draft the author confirmed (the script still decides whether it counts).
const KNOWN_FLAGS = new Set(['--ci', '--json', '--no-audit', '--next', '--save', '--drafted'])

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
  // A crash is an error (2), never a refuse (1): the commands read exit 1 as "the ticket is too thin".
  try { return run(argv, env, cwd) } catch (e) { err(`ticket.mjs: ${e.message}`); return 2 }
}

function run(argv, env, cwd) {
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
  // The saved copy of a ticket: <ticketsDir>/<KEY>/ticket.json, for a key that cannot leave that folder.
  const ticketsRoot = resolve(root, normaliseTicketsDir(config.ticketsDir))
  const savedPath = key => (/^[A-Z][A-Z0-9_]*-\d+$/.test(key ?? '') ? join(ticketsRoot, key, 'ticket.json') : null)
  // The only file sanitize may delete: a raw ticket in its own key folder under ticketsDir.
  const isRawTicket = p => basename(p) === 'raw.json' && dirname(dirname(p)) === ticketsRoot && /^[A-Z][A-Z0-9_]*-\d+$/.test(basename(dirname(p)))
  if (cmd === 'jira-posted') {
    // Called after the connector posted a refuse comment, pushed a fill-in or posted a risk note, or
    // after qa filed a defect, posted a retest comment or moved a status: the key and the kind only.
    const [key, action] = a._
    if (!savedPath(key) || !['comment', 'update', 'risk', 'defect', 'retest', 'status'].includes(action)) {
      err('usage: ticket.mjs jira-posted <KEY> comment|update|risk|defect|retest|status')
      return 2
    }
    log('jira', { key, action })
    // The fill-in answers now on Jira are no longer waiting: `saved` stops offering them.
    if (action === 'update' && existsSync(savedPath(key))) {
      try {
        const t = JSON.parse(readFileSync(savedPath(key), 'utf8'))
        writeFileSync(savedPath(key), JSON.stringify({ ...t, sent: (t.filled ?? []).length }))
      } catch {}
    }
    out('ok')
    return 0
  }
  if (cmd === 'saved') {
    // What an earlier run left for this ticket: fill-in answers typed here that never reached Jira.
    const [key] = a._
    if (!savedPath(key) || a._.length > 1) { err('usage: ticket.mjs saved <KEY>'); return 2 }
    let t = null
    try { t = JSON.parse(readFileSync(savedPath(key), 'utf8')) } catch {}
    const filled = Array.isArray(t?.filled) ? t.filled.length : 0
    out(`SAVED_JSON:${JSON.stringify({ key, exists: Boolean(t), unsent: Math.max(0, filled - (t?.sent ?? 0)), score: t ? buildBrief(config, t).score : null })}`)
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
    if (sub === 'find' && project?.startsWith('@')) {
      // project is the saved field-metadata file here: the fields whose name is the criteria heading.
      let text
      try { text = readFileSync(resolve(root, project.slice(1)), 'utf8') } catch (e) { err(`field find: cannot read ${project.slice(1)} (${e.code ?? e.message})`); return 2 }
      const r = findFields(config, text)
      if (!r.ok) { err(r.error); return 2 }
      out(`FIELD_MATCHES_JSON:${JSON.stringify({ matches: r.matches })}`)
      return 0
    }
    err('usage: ticket.mjs field get <PROJECT> | field set <PROJECT> <customfield_N|none> | field find @<metadata file>')
    return 2
  }
  if (cmd === 'tickets-eval') {
    // Project-wide: --in is a JSON array of raw tickets. Scores them all, sends nothing, writes nothing unless --save.
    if (!a.in) { err('usage: ticket.mjs tickets-eval --in @<tickets.json> [--json] [--save]'); return 2 }
    let list
    const listPath = a.in.startsWith('@') ? resolve(root, a.in.slice(1)) : null
    try { list = JSON.parse(listPath ? readFileSync(listPath, 'utf8') : a.in) } catch (e) { err(`--in is not readable JSON: ${e.message}`); return 2 }
    if (!Array.isArray(list) || list.some(t => !t || typeof t !== 'object' || Array.isArray(t))) { err('--in must be a JSON array of tickets'); return 2 }
    const r = evalTickets(config, list)
    if (a.flags.has('--save')) {
      try { saveTickets(root, config, r.clean) } catch (e) { err(`tickets-eval: cannot save (${e.code ?? e.message})`); return 2 }
    }
    // The raw search results go once they are scored (as sanitize removes raw.json).
    // Only the search results file the command writes; any other input is left as it is.
    if (listPath === join(ticketsRoot, 'tickets-eval.json')) { try { unlinkSync(listPath) } catch { /* already gone */ } }
    const machine = `TICKETS_EVAL_JSON:${JSON.stringify({ summary: r.summary, tickets: r.rows })}`
    if (a.flags.has('--json')) out(machine)
    else { out(formatCard(r)); out(machine) }
    return 0
  }
  if (!a.in) {
    err("usage: ticket.mjs <score|refuse-comment|risk-comment|fill-menu|pick|add|attachments|jira-update|sanitize|side|tickets-eval> --in '<json>'|@file [--ci] [--json]")
    return 2
  }
  const inPath = a.in.startsWith('@') ? resolve(root, a.in.slice(1)) : null
  let ticket
  try { ticket = JSON.parse(inPath ? readFileSync(inPath, 'utf8') : a.in) } catch (e) { err(`--in is not readable JSON: ${e.message}`); return 2 }
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) { err('--in must be a JSON object'); return 2 }
  // Lists the connector or the model may hand over as one value: a single label, a single scenario.
  for (const k of ['labels', 'scenarios', 'flags']) if (k in ticket && !Array.isArray(ticket[k])) ticket[k] = ticket[k] == null ? [] : [ticket[k]]
  const project = String(ticket.key ?? '').replace(/-\d+$/, '')
  // A tracking project's keys belong to the project too (start proposes them).
  const keys = projectKeys(config)
  const mismatch = Boolean(ticket.key) && !keys.includes(project)
  // With --json, stdout is the JSON alone: the mismatch line goes to stderr.
  if (mismatch) (a.flags.has('--json') ? err : out)(`PROJECT_MISMATCH:${JSON.stringify({ key: ticket.key, projects: keys })}`)
  switch (cmd) {
    case 'sanitize': {
      if (!a.out) { err('sanitize needs --out <path>'); return 2 }
      // sanitize deletes its input, so a file input must be a raw ticket: <ticketsDir>/<KEY>/raw.json.
      // Anything else (package.json, a spec) is refused and left as it is, with nothing written.
      if (inPath && !isRawTicket(inPath)) {
        err(`sanitize reads only <ticketsDir>/<KEY>/raw.json, and deletes it; ${a.in.slice(1)} is left as it is`)
        return 2
      }
      const outPath = resolve(root, a.out)
      try {
        writeFileSync(outPath, `${JSON.stringify(sanitizeTicket(config, ticket))}\n`)
        // The raw input goes once the clean copy is on disk, unless the two are the same file.
        if (inPath && inPath !== outPath) unlinkSync(inPath)
      } catch (e) { err(`sanitize: cannot write ${a.out} (${e.code ?? e.message})`); return 2 }
      return 0
    }
    case 'score': {
      if (mismatch && a.flags.has('--ci')) { err(`${ticket.key} is not a ticket of this project's Jira projects (${keys.join(', ')})`); return 2 }
      const b = buildBrief(config, ticket)
      log('gate', {
        key: b.key, issuetype: b.issuetype, score: b.score, gate: b.gate, rubric: b.rubric, legacy: b.legacy,
        missing: b.missing.map(m => m.key), filled: Array.isArray(ticket.filled) ? ticket.filled.length : 0,
      })
      const next = a.flags.has('--next') ? nextStep(config, b) : null
      if (a.flags.has('--json')) out(JSON.stringify(next ? { ...b, next } : b))
      else {
        out(formatReport(b))
        if (next && formatNextStep(next)) out(formatNextStep(next))
        out(`TICKET_EVAL_JSON:${JSON.stringify(b)}`)
        if (next) out(`GATE_JSON:${JSON.stringify(next)}`)
      }
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'refuse-comment': {
      const b = buildBrief(config, ticket)
      out(formatRefuseComment(config, b))
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'risk-comment': {
      // The risk note marks tests written past the gate ("continue anyway"): a ticket that passes has none.
      const b = buildBrief(config, ticket)
      if (b.gate === 'pass') { err(`risk-comment is for a ticket below the bar: ${b.key} has ${b.score} of the ${b.threshold} points it needs, so there is no risk note to post`); return 2 }
      out(formatRiskComment(config, b))
      return 0
    }
    case 'fill-menu': {
      const m = fillMenu(config, buildBrief(config, ticket))
      out(formatFillMenu(m))
      out(`FILL_JSON:${JSON.stringify({ score: m.score, threshold: m.threshold, items: m.items, figma: figmaLinks(ticket) })}`)
      return 0
    }
    case 'pick': {
      // `pick 1 3` and `pick "1 3"` alike.
      const nums = a._.join(' ').split(/[\s,]+/).filter(Boolean)
      const p = projectPick(fillMenu(config, buildBrief(config, ticket)), nums)
      out(formatPick(p))
      out(`FILL_JSON:${JSON.stringify(p)}`)
      return p.error ? 2 : p.enough ? 0 : 1
    }
    case 'add': {
      if (!inPath) { err('add needs --in @<ticket.json> so the accepted answer can be saved'); return 2 }
      const [key, answer] = a._
      const drafted = a.flags.has('--drafted')
      const r = applyAnswer(config, ticket, key, answer, { drafted })
      if (r.ok) {
        try { writeFileSync(inPath, JSON.stringify(r.input)) } catch (e) { err(`add: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
        // One line per accepted answer: the key, the item and whether it began as a draft. Never the text.
        log('fill', { key: r.input.key, item: key, drafted })
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
      if (!Number.isInteger(n) || n < 0) { err('usage: ticket.mjs attachments --in @<ticket.json> <count>'); return 2 }
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
