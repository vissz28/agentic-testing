#!/usr/bin/env node
// The scripts behind /quality-code:transcript-goal. Local only: nothing here is sent anywhere.
//   transcript.mjs parse (--file <path> | --text '<pasted text>') [--mask-speakers]
//       reads a .vtt, .txt, .md or .docx transcript (or pasted text), redacts it, prints the speaker turns
//   transcript.mjs validate --in '<json>'|@file
//       checks the shape of the extracted result: goal, decisions, tasks[title, owner?, estimate?, ticket?], risks, openQuestions
//   transcript.mjs save --in '<json>'|@file [--date YYYY-MM-DD]
//       validates, redacts and writes <ticketsDir>/sprint/<date>-goal.md
// Exit 0 ok, 2 bad input or config.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { loadConfig, normaliseTicketsDir, projectRoot } from '../lib/base/config.mjs'
import { docxText, MAX_BYTES } from '../lib/ticket/docx.mjs'
import { KINDS, parseTranscript, speakersOf } from '../lib/transcript/parse.mjs'
import { redactText, redactTurns } from '../lib/transcript/redact.mjs'
import { validateResult } from '../lib/transcript/shape.mjs'
import { goalPath, isDate, renderGoal, saveGoal } from '../lib/transcript/save.mjs'
import { isMain, tag, printLine, printError } from '../lib/core/script-io.mjs'

/** Characters of transcript printed for the model to read; more is cut and said so. */
export const MAX_CHARS = 60000
const USAGE = 'usage: transcript.mjs parse (--file <path> | --text <text>) [--mask-speakers] | validate --in <json>|@file | save --in <json>|@file [--date YYYY-MM-DD]'

function parseArgs(argv) {
  const a = { _: [], mask: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--mask-speakers') a.mask = true
    else if (['--file', '--text', '--in', '--date'].includes(t)) {
      if (argv[i + 1] === undefined) throw new Error(`${t} needs a value`)
      a[t.slice(2)] = argv[++i]
    } else if (t.startsWith('--')) throw new Error(`unknown arg: ${t}`)
    else a._.push(t)
  }
  return a
}

const today = () => new Date().toISOString().slice(0, 10)

function readJson(a, root) {
  if (!a.in) throw new Error(USAGE)
  const src = a.in.startsWith('@') ? readFileSync(resolve(root, a.in.slice(1)), 'utf8') : a.in
  try { return JSON.parse(src) } catch (e) { throw new Error(`--in is not readable JSON: ${e.message}`) }
}

/** The text of a transcript file by its kind. Throws a plain message on what it cannot read. */
export function readTranscriptFile(path) {
  const kind = extname(path).toLowerCase()
  if (!KINDS.includes(kind)) throw new Error(`cannot read a ${kind || 'file with no extension'}: use ${KINDS.join(', ')}, or paste the text`)
  if (!existsSync(path)) throw new Error(`no file at ${path}`)
  const st = statSync(path)
  if (!st.isFile()) throw new Error(`${path} is not a file`)
  if (st.size > MAX_BYTES) throw new Error(`${path} is over ${MAX_BYTES / 1024 / 1024} MB`)
  const buf = readFileSync(path)
  return kind === '.docx' ? docxText(buf, { maxChars: 1_000_000 }).text : buf.toString('utf8')
}

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  try { return run(argv, env, cwd) } catch (e) { printError(`transcript.mjs: ${e.message}`); return 2 }
}

function run(argv, env, cwd) {
  const [cmd, ...rest] = argv
  const a = parseArgs(rest)
  if (!['parse', 'validate', 'save'].includes(cmd)) { printError(USAGE); return 2 }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root, env)
  if (!cfg.ok) { cfg.errors.forEach(e => printError(e)); return 2 }
  const config = cfg.config

  if (cmd === 'parse') {
    if (a.file == null && a.text == null) { printError(USAGE); return 2 }
    const text = a.file != null ? readTranscriptFile(resolve(cwd, a.file)) : a.text
    const turns = redactTurns(config, parseTranscript(text), { maskSpeakers: a.mask })
    if (!turns.length) { printError('no words found in the transcript'); return 2 }
    let shown = 0
    let truncated = false
    const lines = []
    for (const t of turns) {
      const line = `${t.speaker ?? 'Unknown'}${t.time ? ` [${t.time}]` : ''}: ${t.text}`
      if (shown + line.length > MAX_CHARS) { truncated = true; break }
      lines.push(line)
      shown += line.length + 1
    }
    printLine(lines.join('\n'))
    const speakers = speakersOf(turns)
    printLine(tag('TRANSCRIPT', { turns: turns.length, shown: lines.length, truncated, speakers, source: a.file != null ? extname(a.file).toLowerCase() : 'pasted' }))
    return 0
  }

  const input = readJson(a, root)
  const checked = validateResult(input)
  if (cmd === 'validate') {
    if (!checked.ok) { checked.errors.forEach(e => printLine(`error: ${e}`)); printLine(tag('TRANSCRIPT_RESULT', { ok: false, errors: checked.errors })); return 2 }
    printLine(`ok: goal, ${checked.result.decisions.length} decisions, ${checked.result.tasks.length} tasks, ${checked.result.risks.length} risks, ${checked.result.openQuestions.length} open questions`)
    printLine(tag('TRANSCRIPT_RESULT', { ok: true, result: checked.result }))
    return 0
  }

  // save
  if (!checked.ok) { checked.errors.forEach(e => printError(`error: ${e}`)); return 2 }
  const date = a.date ?? today()
  if (!isDate(date)) { printError(`--date "${date}" is not a date like 2026-11-04`); return 2 }
  const ticketsRoot = resolve(root, normaliseTicketsDir(config.ticketsDir))
  if (!goalPath(ticketsRoot, date)) { printError('cannot build a safe path for the goal file'); return 2 }
  // Redact every text of the result: what is saved never holds a customer id, an e-mail or an id.
  const r = checked.result
  const clean = s => redactText(config, s)
  const result = {
    goal: clean(r.goal), decisions: r.decisions.map(clean), risks: r.risks.map(clean), openQuestions: r.openQuestions.map(clean),
    tasks: r.tasks.map(t => ({ ...t, title: clean(t.title), ...(t.owner ? { owner: clean(t.owner) } : {}), ...(t.estimate != null ? { estimate: clean(String(t.estimate)) } : {}) })),
  }
  const path = saveGoal(ticketsRoot, date, renderGoal(result, date))
  printLine(`Saved the sprint goal at ${path}.`)
  printLine(tag('SAVED', { path, date }))
  return 0
}

if (isMain(import.meta.url)) process.exitCode = main()
