#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { audit } from '../lib/base/audit.mjs'
import { detectConventions, flowOf, runFlow } from '../lib/base/conventions.mjs'
import { findTestHome } from '../lib/base/test-home.mjs'
import { configKeys, configSetGet } from '../lib/config/set.mjs'
import { pickPlace, placeDirs, placesFor, savedPlace } from '../lib/base/places.mjs'
import { configHome, loadConfig, normaliseTicketsDir, personalTicketsDir, projectRoot, rootsOf, setActiveRoot } from '../lib/base/config.mjs'
import { e2eFolder, e2eFolderLine } from '../lib/base/e2e-folder.mjs'
import { buildBrief, formatReport, sideFor } from '../lib/ticket/score.mjs'
import { containerRefusal, isContainerType } from '../lib/ticket/messages.mjs'
import { approachOf, isFullstack, SIDES, ticketSide, unitRunnerOf } from '../lib/base/stack.mjs'
import { formatRefuseComment, formatRiskComment, jiraUpdate, formatJiraUpdate } from '../lib/ticket/jira.mjs'
import { redact, sanitizeTicket, uuidsOf } from '../lib/ticket/sanitize.mjs'
import { docxText, DOCX_MAX_CHARS, MAX_BYTES } from '../lib/ticket/docx.mjs'
import { backendOf } from '../lib/base/backends.mjs'
import { runnerOf } from '../lib/base/runners.mjs'
import { toolScript } from '../lib/pipeline/runners/tool.mjs'
import { findFields, resolveField, storeField } from '../lib/ticket/fields.mjs'
import { projectKeys } from '../lib/base/keys.mjs'
import { ticketsEvalReport } from '../lib/report/build.mjs'
import { reportLines, saveReport } from '../lib/report/save.mjs'
import { evalTickets, formatCard, saveTickets } from '../lib/ticket/batch.mjs'
import { checkNegative, formatNegativeCheck } from '../lib/ticket/negative.mjs'
import { checkStory, draftPath, draftTicket, formatStoryCheck, storyPath, storyShape } from '../lib/ticket/story.mjs'
import { fillMenu, projectPick, formatFillMenu, formatPick, applyAnswer, exampleFor, figmaLinks, nextStep, formatNextStep } from '../lib/ticket/fill.mjs'
import { isMain } from '../lib/core/script-io.mjs'
import { isTicketKey } from '../lib/core/text.mjs'

const out = s => process.stdout.write(`${s}\n`)
const err = s => process.stderr.write(`${s}\n`)

// --no-audit turns the local audit log off for this call (as QC_NO_AUDIT=1 does). --next adds the
// gate's band and the cheapest way over the bar to `score` (its default output stays as it is).
// --save keeps the per-ticket results of `tickets-eval`; --report also writes the HTML report of it. --drafted marks an `add` answer as the
// model's draft the author confirmed (the script still decides whether it counts); a draft is applied only with --confirmed too, which
// the command passes after the person picked Use it (or typed an edit) on the Use it / Edit / Skip card. --runner adds to
// `config check` the test runners the config names and the project has not installed.
const KNOWN_FLAGS = new Set(['--ci', '--json', '--no-audit', '--next', '--save', '--drafted', '--confirmed', '--runner', '--report'])

// The heading `attach` puts each kind of read file under in the description.
const ATTACHED = { screenshot: 'Attached screenshot', page: 'Linked page' }

// The runners setup adds when a repo has none, and the packages that install each.
const ADDABLE = [['vitest', 'Vitest', ['vitest']], ['playwright', 'Playwright', ['@playwright/test', 'playwright']]]

/** A line per runner the config writes tests in that this project has not installed, saying how to add it. */
function missingRunners(root, config) {
  let deps = {}
  try { const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); deps = { ...pkg.dependencies, ...pkg.devDependencies } } catch {}
  const wants = { vitest: backendOf(config) === 'vitest', playwright: config.adapter === 'playwright' || isFullstack(config) }
  return ADDABLE
    .filter(([adapter, , packages]) => wants[adapter] && runnerOf(config, adapter) === adapter && !toolScript(root, packages, adapter))
    .map(([, label, packages]) => (packages.some(p => p in deps)
      ? `${label} is in package.json but not installed: run your package manager's install.`
      : `${label} is not installed in this project: run /quality-code:spec to add it.`))
}

/** The ticketsDir the config file itself names, before the place moves it; undefined when it names none. */
function rawTicketsDir(path) {
  try { const c = JSON.parse(readFileSync(path, 'utf8')); return typeof c?.ticketsDir === 'string' ? c.ticketsDir : undefined } catch { return undefined }
}

function parseArgs(argv) {
  const a = { _: [], flags: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    // `--` ends the flags: everything after it is positional, so an answer may start with "--".
    if (t === '--') { a._.push(...argv.slice(i + 1)); break }
    if (t === '--in' || t === '--out' || t === '--draft') a[t.slice(2)] = argv[++i]
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
  if (cmd === 'config' && rest[0] === 'keys') return configKeys()
  if (cmd === 'config' && ['set', 'get'].includes(rest[0])) return configSetGet(rest, env, cwd)
  let a
  try { a = parseArgs(rest) } catch (e) { err(e.message); return 2 }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root, env)
  if (cmd === 'config' && a._[0] === 'check') {
    if (!cfg.ok) { cfg.errors.forEach(e => out(e)); return 2 }
    out(`ok (${cfg.source}: ${cfg.path})`)
    // The folder the commands write ticket files in: the config's ticketsDir, where this person keeps files.
    out(`tickets folder: ${cfg.config.ticketsDir} (files kept ${{ repo: 'in the project', local: 'on this machine', chat: 'in this session (a temp folder)' }[cfg.place]})`)
    if (a.flags.has('--runner') && cfg.source === 'repo') missingRunners(root, cfg.config).forEach(m => out(`missing: ${m}`))
    return 0
  }
  if (!cfg.ok) { cfg.errors.forEach(e => err(e)); return 2 }
  const config = cfg.config
  const log = (kind, entry) => audit(root, kind, entry, { env, off: a.flags.has('--no-audit'), dir: cfg.auditDir })
  // The saved copy of a ticket: <ticketsDir>/<KEY>/ticket.json, for a key that cannot leave that folder.
  const ticketsRoot = resolve(root, normaliseTicketsDir(config.ticketsDir))
  const savedPath = key => (isTicketKey(key) ? join(ticketsRoot, key, 'ticket.json') : null)
  // The only file sanitize may delete: a raw ticket in its own key folder under ticketsDir.
  const isRawTicket = p => basename(p) === 'raw.json' && dirname(dirname(p)) === ticketsRoot && isTicketKey(basename(dirname(p)))
  if (cmd === 'save') {
    // Where this person keeps the project's files and logs: asked once, after the first run that saved some.
    const [sub, place] = a._
    const options = placesFor(cfg.source)
    const opts = { source: cfg.source, ticketsDir: rawTicketsDir(cfg.path), personalDefault: personalTicketsDir(env) }
    const where = p => placeDirs(root, opts, p, env)
    const show = p => { const d = where(p); return { place: p, ticketsDir: d.ticketsDir, auditDir: d.auditDir } }
    if (sub === 'get' && a._.length === 1) {
      out(`SAVE_JSON:${JSON.stringify({ ...show(cfg.place), asked: savedPlace(root, cfg.source, env) !== null, source: cfg.source, options: options.map(show) })}`)
      return 0
    }
    if (sub === 'set' && a._.length === 2 && options.includes(place)) {
      const r = pickPlace(root, opts, place, env)
      const line = { repo: `in the project, in ${r.dirs.ticketsDir}/ (git-ignored)`, local: `on this machine, in ${r.dirs.ticketsDir}/`, chat: `in this session, in ${r.dirs.ticketsDir}/ (a temp folder: the machine may clear it)` }[place]
      out(`ok: files and logs go ${line}.${r.moved ? ` Moved ${r.moved} file${r.moved === 1 ? '' : 's'} from the old place.` : ''}${r.kept ? ` ${r.kept} already there kept as they were.` : ''}`)
      out(`SAVE_JSON:${JSON.stringify({ ...show(place), asked: true, source: cfg.source, moved: r.moved, kept: r.kept })}`)
      return 0
    }
    err(`usage: ticket.mjs save get | save set ${options.join('|')}`)
    return 2
  }
  if (cmd === 'root') {
    // One config serving several projects of a monorepo ("roots"): which one this person works on.
    const home = configHome(root)
    const [sub, folder] = a._
    if (sub === 'get' && a._.length === 1) {
      const r = rootsOf(home, env)
      out(`ROOT_JSON:${JSON.stringify(r)}`)
      return 0
    }
    if (sub === 'set' && a._.length === 2) {
      const r = setActiveRoot(home, folder, env)
      if (!r.ok) { err(r.error); return 2 }
      out(`ok: the active root is ${folder.replace(/\/+$/, '')}. Every command now works in it.`)
      out(`ROOT_JSON:${JSON.stringify(rootsOf(home, env))}`)
      return 0
    }
    err('usage: ticket.mjs root get | root set <folder>')
    return 2
  }
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
  if (cmd === 'docx') {
    // A Word file the user named, when the connection cannot download it: its text, to add to the raw description.
    const [file] = a._
    if (!file || a._.length > 1) { err("usage: ticket.mjs docx '<path to a .docx>'"); return 2 }
    const path = resolve(file.replace(/^~(?=\/|$)/, homedir()))
    try {
      if (statSync(path).size > MAX_BYTES) { err(`${basename(path)}: over 5 MB, not read`); return 2 }
      out(`DOCX_JSON:${JSON.stringify(docxText(readFileSync(path)))}`)
      return 0
    } catch (e) { err(`${basename(path)}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); return 2 }
  }
  if (cmd === 'config' && a._[0] === 'flow') {
    // How this run writes tests: the project's own style (its naming and folders) or Quality Code's.
    // --style project|quality-code (one run) wins over testStyle in the config; with neither, the project's
    // when it has tests, else Quality Code's.
    const flag = a._[1]
    if (flag !== undefined && !['project', 'quality-code', 'both'].includes(flag)) { err('usage: ticket.mjs config flow [project|quality-code|both]'); return 2 }
    const conv = detectConventions(root)
    const flow = runFlow(config, conv, flag)
    out(flow === 'both'
      ? "test style: both: every test is written twice, like the project's existing tests and the Quality Code way (the ticket key in the file name)"
      : flow === 'project'
      ? (conv.specs > 0
        ? `test style: like the existing tests: ${conv.specs} test file${conv.specs === 1 ? '' : 's'} found, named ${conv.pattern}${conv.beside ? ', next to the code' : ''}`
        : "test style: like the existing tests, but the project has none yet: Quality Code's naming is used until it has")
      : 'test style: the Quality Code way: the ticket key in the file name, the configured test folders')
    out(`FLOW_JSON:${JSON.stringify({ flow, source: flag ? 'run' : config.testStyle ? 'config' : 'detected', configured: config.testStyle ?? null, ...conv })}`)
    return 0
  }
  if (cmd === 'config' && a._[0] === 'test-home') {
    // Where a new test for this source file goes: the file that tests it, the central test file, or a new one.
    if (!a._[1] || a._.length > 2) { err('usage: ticket.mjs config test-home <target>'); return 2 }
    const home = findTestHome(root, a._[1])
    out(home.kind === 'none' ? `test home: none yet: ${home.reason}` : `test home: ${home.file} (${home.kind === 'unit-file' ? 'tests this file' : "the project's central tests"}): ${home.reason}`)
    out(`TEST_HOME_JSON:${JSON.stringify(home)}`)
    return 0
  }
  if (cmd === 'config' && a._[0] === 'e2e-folder') {
    const r = e2eFolder(root, config)
    if (!r.ok) { err(r.error); return 2 }
    out(e2eFolderLine(r))
    out(`E2E_FOLDER_JSON:${JSON.stringify(r)}`)
    return 0
  }
  if (cmd === 'approach') {
    // How the team tests a frontend feature: e2e (Playwright), unit (the JavaScript unit runner) or both, and the
    // team's own file about it. `approach <feature label>`; a label the config does not list gets the default, e2e.
    const [label] = a._
    if (!label || a._.length > 1) { err('usage: ticket.mjs approach <feature label>'); return 2 }
    const feature = (config.features ?? []).find(f => f.label.toLowerCase() === label.toLowerCase()) ?? null
    const approach = approachOf(config, label)
    const guide = feature?.guide ?? null
    const guideFound = guide ? existsSync(resolve(root, guide)) : false
    const r = { feature: feature?.label ?? null, approach, unitRunner: unitRunnerOf(config), guide, guideFound, set: feature?.approach ?? null }
    out(`${label}: ${approach === 'e2e' ? 'end-to-end tests (Playwright)' : approach === 'unit' ? 'unit tests' : 'unit tests and end-to-end tests'}${feature?.approach ? '' : ' (the default: no approach set for it)'}${guide ? `; team guide ${guide}${guideFound ? '' : ' (not found)'}` : ''}`)
    out(`APPROACH_JSON:${JSON.stringify(r)}`)
    return 0
  }
  if (cmd === 'field') {
    const [sub, project, value] = a._
    if (sub === 'get' && project) {
      const r = resolveField(root, config, project, env)
      out(`FIELD_JSON:${JSON.stringify({ project, field: r.field ?? null, source: r.source })}`)
      return 0
    }
    if (sub === 'set' && project && value) {
      const r = storeField(root, project, value, env)
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
    if (!a.in) { err('usage: ticket.mjs tickets-eval --in @<tickets.json> [--json | --report] [--save]'); return 2 }
    if (a.flags.has('--report') && a.flags.has('--json')) { err('--json and --report do not go together'); return 2 }
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
    if (a.flags.has('--report')) {
      // One self-contained HTML file in <ticketsDir>/reports/; the card above stays the text version.
      const now = new Date()
      const built = ticketsEvalReport(r, { config, project: r.rows[0]?.key?.replace(/-\d+$/, '') ?? null, now })
      try { out(reportLines(saveReport(join(ticketsRoot, 'reports'), 'tickets-eval', now.toISOString().slice(0, 10), built.html), 'Tickets readiness', built.headline).join('\n')) } catch (e) { err(`tickets-eval: cannot save the report (${e.code ?? e.message})`); return 2 }
    }
    return 0
  }
  if (!a.in) {
    err("usage: ticket.mjs <score|negative-check|story-check|story-save|refuse-comment|risk-comment|fill-menu|pick|add|attachments|attach|jira-update|sanitize|side|tickets-eval> --in '<json>'|@file [--ci] [--json]")
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
      if (isContainerType(ticket.issuetype)) { err(containerRefusal(ticket.key, ticket.issuetype)); return 2 }
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
    case 'negative-check': {
      // Does the ticket name invalid input, errors or permission denied? A suggestion only: it never changes the score or the gate.
      const c = checkNegative(ticket)
      if (a.flags.has('--json')) out(JSON.stringify(c))
      else { out(formatNegativeCheck(c)); out(`NEGATIVE_JSON:${JSON.stringify(c)}`) }
      return 0
    }
    case 'story-check': {
      // After the score: is the story too long, unstructured or too thin? Without --draft it decides whether to offer a
      // rewrite. With --draft @<file> it checks the draft, re-scores it as the ticket's story and prints old and new score.
      if (!a.draft) {
        const check = checkStory(ticket)
        if (a.flags.has('--json')) out(JSON.stringify(check))
        else { out(formatStoryCheck(check)); out(`STORY_JSON:${JSON.stringify(check)}`) }
        return 0
      }
      let draft
      try { draft = readFileSync(resolve(root, a.draft.replace(/^@/, '')), 'utf8') } catch (e) { err(`story-check: cannot read the draft (${e.code ?? e.message})`); return 2 }
      draft = redact(config, draft, uuidsOf(ticket))
      const drafted = draftTicket(ticket, draft)
      const before = buildBrief(config, ticket)
      const after = buildBrief(config, drafted)
      const shape = storyShape(draft)
      const r = { key: ticket.key ?? null, before: { score: before.score, gate: before.gate }, after: { score: after.score, gate: after.gate, missing: after.missing.map(m => m.label) }, threshold: after.threshold, shape, check: checkStory(drafted) }
      if (a.flags.has('--json')) { out(JSON.stringify(r)); return 0 }
      out(`Score: ${before.score} before, ${after.score} with the new story (needs ${after.threshold}).`)
      if (shape.missing.length) out(`Missing sections: ${shape.missing.join(', ')}.`)
      if (after.missing.length) out(`Still missing: ${after.missing.map(m => m.label).join('; ')}.`)
      out(`STORY_SCORE_JSON:${JSON.stringify(r)}`)
      return 0
    }
    case 'story-save': {
      // Saves the confirmed draft (<ticketsDir>/<KEY>/story-draft.md) as <ticketsDir>/<KEY>/story.md. Local only.
      const from = draftPath(ticketsRoot, ticket.key), to = storyPath(ticketsRoot, ticket.key)
      if (!from) { err('story-save needs a ticket with a valid key'); return 2 }
      if (!existsSync(from)) { err(`story-save: no draft at ${from}`); return 2 }
      try { mkdirSync(dirname(to), { recursive: true }); writeFileSync(from, redact(config, readFileSync(from, 'utf8'), uuidsOf(ticket))); renameSync(from, to) } catch (e) { err(`story-save: cannot write (${e.code ?? e.message})`); return 2 }
      out(`Saved the story at ${to}.`)
      return 0
    }
    case 'refuse-comment': {
      const b = buildBrief(config, ticket)
      out(formatRefuseComment(config, b))
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'risk-comment': {
      // The risk note marks tests written past the gate ("continue anyway"): a ticket that passes has none.
      const b = buildBrief(config, ticket)
      if (b.gate === 'pass') { err(`risk-comment is for a ticket that does not pass: ${b.key} has ${b.score} points and needs ${b.threshold}, so there is no risk note to post`); return 2 }
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
      if (drafted && !a.flags.has('--confirmed')) {
        err('add --drafted needs --confirmed: a drafted answer is applied only after the person picked "Use it" (or typed an edit) on the Use it / Edit / Skip card. Show that card first.')
        return 2
      }
      const r = applyAnswer(config, ticket, key, answer, { drafted })
      if (r.ok) {
        try { writeFileSync(inPath, JSON.stringify(r.input)) } catch (e) { err(`add: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
        // One line per accepted answer: the key, the item and whether it began as a draft. Never the text.
        log('fill', { key: r.input.key, item: key, drafted })
        const b = r.brief
        out(`Accepted. The ticket now has ${b.score} points (needs ${b.threshold})${b.gate === 'pass' ? ': enough to continue.' : `: ${b.threshold - b.score} points short.`}`)
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
      out(`The ticket has ${n} attachment${n === 1 ? '' : 's'}: ${b.score} points (needs ${b.threshold})${b.gate === 'pass' ? ': enough to continue.' : `: ${b.threshold - b.score} points short.`}`)
      out(`FILL_JSON:${JSON.stringify({ attachments: n, score: b.score, gate: b.gate })}`)
      return 0
    }
    case 'attach': {
      // A refused ticket's screenshot or linked page, read after the first score: the words a screenshot
      // shows, or the page's text. The text comes in a file in the ticket's folder (deleted once read),
      // is redacted and added to the description, so the script scores it like the description.
      const [kind, from] = a._
      const heading = ATTACHED[kind]
      if (!inPath || !heading || !from?.startsWith('@') || a._.length > 2) { err('usage: ticket.mjs attach --in @<ticket.json> screenshot|page @<ticketsDir>/<KEY>/attached.txt'); return 2 }
      const textPath = resolve(root, from.slice(1))
      if (!savedPath(ticket.key) || dirname(textPath) !== join(ticketsRoot, ticket.key)) { err(`attach reads only a file in ${join(normaliseTicketsDir(config.ticketsDir), String(ticket.key ?? '<KEY>'))}/, and deletes it`); return 2 }
      let raw
      try { raw = readFileSync(textPath, 'utf8'); unlinkSync(textPath) } catch (e) { err(`attach: cannot read ${from.slice(1)} (${e.code ?? e.message})`); return 2 }
      const text = redact(config, raw.trim(), uuidsOf(ticket)).slice(0, DOCX_MAX_CHARS)
      const description = ticket.text?.description ?? ''
      const n = (description.match(new RegExp(`^## ${heading} \\d+$`, 'gm')) ?? []).length + 1
      const next = {
        ...ticket,
        text: { ...ticket.text, description: text ? `${description}\n\n## ${heading} ${n}\n${text}` : description },
        ...(kind === 'page' ? {} : {
          attachmentsRead: (Number(ticket.attachmentsRead) || 0) + 1,
          attachmentsWithText: (Number(ticket.attachmentsWithText) || 0) + (text ? 1 : 0),
        }),
      }
      try { writeFileSync(inPath, JSON.stringify(next)) } catch (e) { err(`attach: cannot write ${a.in.slice(1)} (${e.code ?? e.message})`); return 2 }
      const b = buildBrief(config, next)
      out(`${text ? `Added ${heading.toLowerCase()} ${n}` : `Nothing to add from this ${kind === 'page' ? 'page' : 'file'}`}: ${b.score} points (needs ${b.threshold})${b.gate === 'pass' ? ': enough to continue.' : `: ${b.threshold - b.score} points short.`}`)
      out(`ATTACH_JSON:${JSON.stringify({ kind, added: Boolean(text), score: b.score, gate: b.gate })}`)
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

if (isMain(import.meta.url)) process.exitCode = main()
