// Reads Claude Code's local transcripts for one project and splits their API usage into
// quality-code command runs and everything else. Read-only and offline. Only counts, models,
// command names, ticket keys and times leave this module: never prompt or answer text.
import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLUGIN = 'quality-code'
const SYSTEM_TEXT = /^\s*(<(task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|user-prompt-submit-hook|bash-stdout|bash-stderr)\b|\[Request interrupted by user)/
// A reply to a numbered card keeps the run going: a number or several, a ticket key, yes, no, none.
const CARD_ANSWER = /^\s*(\d{1,2}([\s,]+\d{1,2})*|[A-Z][A-Z0-9]+-\d+|yes|no|none)\s*\.?\s*$/i
const GENERIC_KEY = '[A-Z][A-Z0-9]+-\\d+'

export const configDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

/** Claude Code's folder name for a project: every character that is not a letter or digit becomes "-". */
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

/** The cwd a transcript was recorded in, from its first lines. */
function cwdOf(file) {
  for (const raw of head(file).split('\n')) {
    try {
      const l = JSON.parse(raw)
      if (typeof l?.cwd === 'string') return l.cwd
    } catch { /* a cut last line or junk */ }
  }
  return null
}

/** Transcript folders of the project: by slug first; if that fails, every folder whose sessions ran in root. */
export function findProjectDirs(root, dir = configDir()) {
  const base = join(dir, 'projects')
  const bySlug = join(base, slugFor(root))
  const looked = [bySlug]
  if (jsonlIn(bySlug).length) return { dirs: [bySlug], looked }
  looked.push(`${base} (sessions whose cwd is ${root})`)
  let names = []
  try { names = readdirSync(base).sort() } catch { return { dirs: [], looked } }
  const dirs = names.map(n => join(base, n)).filter(d => isDir(d) && jsonlIn(d).some(f => cwdOf(join(d, f)) === root))
  return { dirs, looked }
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

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** Sessions of one transcript folder, each with its subagents. */
export function loadSessions(dir) {
  return jsonlIn(dir).map(f => {
    const id = f.slice(0, -'.jsonl'.length)
    const subDir = join(dir, id, 'subagents')
    const subagents = jsonlIn(subDir).map(s => ({
      lines: readLines(join(subDir, s)),
      meta: readJson(join(subDir, s.replace(/\.jsonl$/, '.meta.json'))),
    }))
    return { id, lines: readLines(join(dir, f)), subagents }
  })
}

const textOf = content => typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n') : ''

/** What a user line is: a slash command, a real prompt, or something that does not end a run. */
export function classifyUser(line) {
  if (line.isSidechain) return { kind: 'other' }
  const content = line.message?.content
  if (Array.isArray(content) && content.length && content.every(b => b?.type === 'tool_result')) return { kind: 'tool' }
  const text = textOf(content)
  const name = text.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/)
  if (name) return { kind: 'command', name: name[1], args: text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '' }
  if (line.isMeta) return { kind: 'meta' }
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

/**
 * Splits usage into runs and the rest. keySource is a regex source for one ticket key
 * (the project's keys when it is set up). Returns { runs, events } where each event has a run or null.
 */
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

    for (const line of s.lines) {
      t = timeOf(line, t)
      if (line.type === 'user') {
        const c = classifyUser(line)
        if (c.kind === 'command') {
          const name = c.name.startsWith(`${PLUGIN}:`) ? c.name.slice(PLUGIN.length + 1) : null
          current = name && /^[a-z][a-z0-9-]*$/.test(name)
            ? { command: name, key: c.args.match(keyRe)?.[1] ?? null, start: t, sessionId: line.sessionId || s.id }
            : null
          if (current) runs.push(current)
          segments.push({ t, run: current })
        } else if (c.kind === 'prompt') {
          current = null
          segments.push({ t, run: null })
        }
      } else if (line.type === 'assistant') {
        record(line, current, t, line.sessionId || s.id)
        toolUses(line, current)
      }
    }

    // Subagents belong to the run that spawned them: by the tool call, else by when they started.
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
