// Splits a project's local Claude Code transcript usage into quality-code runs and the rest. Read-only, offline.
// Only counts, models, command names, ticket keys and times leave this module, never prompt or reply text.
import { readdirSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tryReadJson } from '../core/files.mjs'
import { isTicketKey } from '../core/is.mjs'

const PLUGIN = 'quality-code'
// `direct` only routes: its run is named after the command it routes to, as the server's direct.py reads the request.
const COMMANDS = new Set((() => { try { return readdirSync(fileURLToPath(new URL('../../commands/', import.meta.url))) } catch { return [] } })().filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)))
const DIRECT_PREFIX = /^\s*(?:using\s+quality[\s-]*code(?:\s+direct)?|quality[\s-]*code(?:\s+direct)?)\b[\s:,.\-–—]*/i
const DIRECT_TOOL = /(?:^|__)quality_code_direct$/
const UNDERSTOOD = /understood as (?:\/quality-code:|Quality Code )([a-z][a-z0-9-]*)/
const SYSTEM_TEXT = /^\s*(<(task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|user-prompt-submit-hook|bash-stdout|bash-stderr)\b|\[Request interrupted by user)/
// Replies that keep a run going: numbers, a ticket key, or yes/no-style words.
const CARD_ANSWER = /^\s*(\d{1,2}([\s,]+\d{1,2})*|[A-Z][A-Z0-9_]+-\d+|yes|y|no|n|none|ok|sì|si|va bene|stop|basta)\s*[.!]?\s*$/i
const GENERIC_KEY = '[A-Z][A-Z0-9_]+-\\d+'
// After a numbered card, any short one-line reply keeps the run going (that's how headless sessions answer).
const isCard = text => /^\s*1[.)]\s+\S/m.test(text) && /^\s*2[.)]\s+\S/m.test(text)
const isShortReply = text => { const t = text.trim(); return t.length <= 200 && !t.includes('\n') }

export const configDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

// Matches Claude Code's project folder naming.
export const slugFor = path => String(path).replace(/[^a-zA-Z0-9]/g, '-')

const isDir = p => { try { return statSync(p).isDirectory() } catch { return false } }
const jsonlIn = dir => { try { return readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort() } catch { return [] } }

function head(file, bytes = 65536) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    return buf.subarray(0, readSync(fd, buf, 0, bytes, 0)).toString('utf8')
  } finally { closeSync(fd) }
}

function cwdOf(file) {
  for (const raw of head(file).split('\n')) {
    try {
      const l = JSON.parse(raw)
      if (typeof l?.cwd === 'string') return l.cwd
    } catch { /* a cut last line or junk */ }
  }
  return null
}

// Slugs collide (/a/b-c vs /a/b/c), so check cwd is root or below. No cwd line: count only in the project's own folder.
function ranIn(file, root, own) {
  const c = cwdOf(file)
  return c === null ? own : c === root || c.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Tries the slug folders first, then scans every folder by cwd. */
export function findProjectDirs(root, dir = configDir()) {
  const base = join(dir, 'projects')
  const slug = slugFor(root)
  const looked = [join(base, slug)]
  let names = []
  try { names = readdirSync(base).sort() } catch { return { dirs: [], looked } }
  const pick = list => list.map(n => ({ dir: join(base, n), files: jsonlIn(join(base, n)).filter(f => ranIn(join(base, n, f), root, n === slug)) })).filter(d => d.files.length)
  let found = pick(names.filter(n => n === slug || n.startsWith(`${slug}-`)))
  if (!found.length) {
    looked.push(`${base} (sessions whose cwd is ${root})`)
    found = pick(names.filter(n => isDir(join(base, n))))
  }
  return { dirs: found.map(d => d.dir), sessions: Object.fromEntries(found.map(d => [d.dir, d.files])), looked }
}

function readLines(file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try { out.push(JSON.parse(raw)) } catch { /* skip a broken line */ }
  }
  return out
}

export function loadSessions(dir, files = jsonlIn(dir)) {
  return files.map(f => {
    const id = f.slice(0, -'.jsonl'.length)
    const subDir = join(dir, id, 'subagents')
    const subagents = jsonlIn(subDir).map(s => ({
      lines: readLines(join(subDir, s)),
      meta: tryReadJson(join(subDir, s.replace(/\.jsonl$/, '.meta.json')), null),
    }))
    return { id, lines: readLines(join(dir, f)), subagents }
  })
}

const textOf = content => typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n') : ''

export function classifyUser(line) {
  if (line.isSidechain) return { kind: 'other' }
  const content = line.message?.content
  if (Array.isArray(content) && content.length && content.every(b => b?.type === 'tool_result')) return { kind: 'tool' }
  const text = textOf(content)
  const name = text.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/)
  if (name) return { kind: 'command', name: name[1], args: text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '' }
  // Includes the auto-compaction summary.
  if (line.isMeta || line.isCompactSummary || line.isVisibleInTranscriptOnly) return { kind: 'meta' }
  if (line.origin?.kind && line.origin.kind !== 'human') return { kind: 'meta' }
  if (SYSTEM_TEXT.test(text) || /^\s*<command-message>/.test(text)) return { kind: 'meta' }
  if (CARD_ANSWER.test(text)) return { kind: 'answer' }
  return { kind: 'prompt' }
}

function tokensOf(u) {
  const write = u.cache_creation_input_tokens || 0
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens || 0
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite5m: Math.max(0, write - w1h),
    cacheWrite1h: Math.min(w1h, write || w1h),
    cacheRead: u.cache_read_input_tokens || 0,
  }
}

/** The command a `direct` request names and its arguments; null when it takes a sentence to tell (the next step names it). */
export function routeDirect(text) {
  const words = String(text).replace(DIRECT_PREFIX, '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { name: 'help', args: '' }
  const first = words[0].replace(/^\/?(?:quality-code:)?/i, '').replace(/[:,.]+$/, '').toLowerCase()
  const two = `${first}-${String(words[1] ?? '').toLowerCase()}`
  if (words.length > 1 && COMMANDS.has(two)) return { name: two, args: words.slice(2).join(' ') }
  if (COMMANDS.has(first)) return { name: first, args: words.slice(1).join(' ') }
  if (words.length === 1 && isTicketKey(words[0].replace(/[:,.]+$/, '').toUpperCase())) return { name: 'ticket', args: words[0] }
  return null
}

const timeOf = (line, fallback) => {
  const t = Date.parse(line?.timestamp)
  return Number.isNaN(t) ? fallback : t
}

/** keySource: regex source for a ticket key. Each event's run is null when outside a quality-code run. */
export function attribute(sessions, { keySource = GENERIC_KEY } = {}) {
  const keyRe = new RegExp(`(?<![A-Za-z0-9])(${keySource})(?![0-9])`)
  const seen = new Set()
  const opened = new Map()
  // Runs opened through `direct`, until the command it routes to starts.
  const routing = new Set()
  // quality_code_direct tool calls: their result names the command.
  const directCalls = new Map()
  const runs = []
  const events = []

  for (const s of sessions) {
    const toolRun = new Map()
    const segments = []
    let current = null
    let t = 0
    // Last reply text, to tell whether it ended on a card.
    let said = ''
    const record = (line, run, at, sessionId) => {
      const usage = line.message?.usage
      const model = line.message?.model
      if (!usage || !model || model === '<synthetic>') return
      const id = line.requestId || line.message?.id || line.uuid
      if (id) {
        if (seen.has(id)) return
        seen.add(id)
      }
      events.push({ t: at, model, fast: usage.speed === 'fast', tokens: tokensOf(usage), run, sessionId })
    }
    // quality_code_direct answers "understood as /quality-code:<command>": that names the run.
    const named = blocks => {
      for (const b of blocks) {
        const run = directCalls.get(b.tool_use_id)
        const m = run && textOf(typeof b.content === 'string' ? b.content : b.content ?? '').match(UNDERSTOOD)
        if (m) { run.command = m[1]; routing.delete(run) }
      }
    }
    const toolUses = (line, run) => {
      const c = line.message?.content
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use' && b.id) toolRun.set(b.id, run)
    }

    // id: what opened it (a typed command's line, a tool call). A resumed session repeats the earlier lines with the same ids: back to that run.
    const open = (command, args, line, id, typed = false) => {
      if (id && opened.has(id)) {
        current = opened.get(id)
        segments.push({ t, run: current })
        return
      }
      let name = command.startsWith(`${PLUGIN}:`) ? command.slice(PLUGIN.length + 1) : null
      const viaDirect = name === 'direct'
      if (viaDirect) ({ name, args } = routeDirect(args) ?? { name, args })
      // The command a `direct` run routed to is started next by the model: it names that run, never a second one.
      if (!typed && name && current && routing.has(current)) {
        if (name !== 'direct') {
          routing.delete(current)
          current.command = name
          current.key ??= args.match(keyRe)?.[1] ?? null
        }
        if (id) opened.set(id, current)
        return
      }
      current = name && /^[a-z][a-z0-9-]*$/.test(name)
        ? { command: name, key: args.match(keyRe)?.[1] ?? null, start: t, sessionId: line.sessionId || s.id }
        : null
      if (current) runs.push(current)
      if (current && viaDirect) routing.add(current)
      if (id) opened.set(id, current)
      segments.push({ t, run: current })
    }

    for (const line of s.lines) {
      t = timeOf(line, t)
      if (line.type === 'user') {
        const c = classifyUser(line)
        if (c.kind === 'tool') named(line.message.content)
        if (c.kind === 'command') { open(c.name, c.args, line, line.uuid, true); said = '' }
        else if (c.kind === 'prompt' && current && isCard(said) && isShortReply(textOf(line.message?.content))) said = ''
        else if (c.kind === 'prompt') {
          current = null
          segments.push({ t, run: null })
        }
      } else if (line.type === 'assistant') {
        // A Skill tool call, or the server's quality_code_direct, opens a run like a typed command.
        const uses = Array.isArray(line.message?.content) ? line.message.content.filter(b => b?.type === 'tool_use') : []
        const skill = uses.find(b => b.name === 'Skill' && String(b.input?.skill ?? '').startsWith(`${PLUGIN}:`))
        const direct = uses.find(b => DIRECT_TOOL.test(String(b.name ?? '')))
        if (skill) open(skill.input.skill, String(skill.input.args ?? ''), line, skill.id)
        else if (direct) {
          open(`${PLUGIN}:direct`, String(direct.input?.request ?? ''), line, direct.id)
          if (current && direct.id) directCalls.set(direct.id, current)
        }
        record(line, current, t, line.sessionId || s.id)
        toolUses(line, current)
        const text = textOf(line.message?.content)
        if (text) said = text
      }
    }

    // Subagents go to the run that spawned them: by tool call id, else by start time.
    const activeAt = at => {
      let run = null
      for (const g of segments) { if (g.t <= at) run = g.run; else break }
      return run
    }
    let pending = s.subagents
    while (pending.length) {
      const ready = pending.filter(a => toolRun.has(a.meta?.toolUseId))
      const batch = ready.length ? ready : pending
      pending = ready.length ? pending.filter(a => !ready.includes(a)) : []
      for (const a of batch) {
        const first = timeOf(a.lines.find(l => l.timestamp), 0)
        const run = toolRun.has(a.meta?.toolUseId) ? toolRun.get(a.meta.toolUseId) : activeAt(first)
        let at = first
        for (const line of a.lines) {
          at = timeOf(line, at)
          if (line.type === 'assistant') {
            record(line, run, at, line.sessionId || s.id)
            toolUses(line, run)
          }
        }
      }
    }
  }
  return { runs, events }
}
