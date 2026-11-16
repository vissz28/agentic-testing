// Splits a project's local Claude Code transcript usage into quality-code runs and the rest. Read-only, offline.
// Only counts, models, command names, ticket keys and times leave this module, never prompt or reply text.
import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { tryReadJson } from '../core/files.mjs'

const PLUGIN = 'quality-code'
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

const timeOf = (line, fallback) => {
  const t = Date.parse(line?.timestamp)
  return Number.isNaN(t) ? fallback : t
}

/** keySource: regex source for a ticket key. Each event's run is null when outside a quality-code run. */
export function attribute(sessions, { keySource = GENERIC_KEY } = {}) {
  const keyRe = new RegExp(`(?<![A-Za-z0-9])(${keySource})(?![0-9])`)
  const seen = new Set()
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
    const toolUses = (line, run) => {
      const c = line.message?.content
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use' && b.id) toolRun.set(b.id, run)
    }

    const open = (command, args, line) => {
      const name = command.startsWith(`${PLUGIN}:`) ? command.slice(PLUGIN.length + 1) : null
      current = name && /^[a-z][a-z0-9-]*$/.test(name)
        ? { command: name, key: args.match(keyRe)?.[1] ?? null, start: t, sessionId: line.sessionId || s.id }
        : null
      if (current) runs.push(current)
      segments.push({ t, run: current })
    }

    for (const line of s.lines) {
      t = timeOf(line, t)
      if (line.type === 'user') {
        const c = classifyUser(line)
        if (c.kind === 'command') { open(c.name, c.args, line); said = '' }
        else if (c.kind === 'prompt' && current && isCard(said) && isShortReply(textOf(line.message?.content))) said = ''
        else if (c.kind === 'prompt') {
          current = null
          segments.push({ t, run: null })
        }
      } else if (line.type === 'assistant') {
        // A Skill tool call opens a run like a typed command.
        const skill = Array.isArray(line.message?.content) && line.message.content.find(b => b?.type === 'tool_use' && b.name === 'Skill' && String(b.input?.skill ?? '').startsWith(`${PLUGIN}:`))
        if (skill) open(skill.input.skill, String(skill.input.args ?? ''), line)
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
