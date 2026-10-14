// The local audit log: one JSON line per event in .claude/quality-code/audit/<kind>.jsonl, git-ignored.
// Keys, numbers and fixed words only: never ticket text, never a path, never a finding.
// A failed append returns false and never throws, so it never changes a result or an exit code.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const AUDIT_DIR = '.claude/quality-code/audit'
export const KINDS = ['gate', 'pipeline', 'jira', 'override']

const KEY = /^[A-Z][A-Z0-9]*-\d+$/
// Verdicts, gates, step names, rubric and adapter ids, criterion keys.
const WORD = /^[a-z][a-z0-9_-]{0,39}$/
// A Jira issue type name, in any language ("Bug", "Story", "Sotto-task").
const LABEL = /^\p{L}[\p{L}\p{N} -]{0,39}$/u

const key = v => (typeof v === 'string' && KEY.test(v) ? v : null)
const word = v => (typeof v === 'string' && WORD.test(v) ? v : null)
const oneOf = list => v => (list.includes(v) ? v : null)
const num = v => (Number.isInteger(v) && v >= 0 ? v : null)
const count = v => num(v) ?? 0
const words = a => (Array.isArray(a) ? a.map(word).filter(Boolean) : [])
const score = v => (num(v) !== null && v <= 100 ? v : null)
const scored = o => (o && typeof o === 'object' ? { score: score(o.score), bar: score(o.bar) } : null)

const SHAPE = {
  gate: e => ({
    key: key(e.key), issuetype: typeof e.issuetype === 'string' && LABEL.test(e.issuetype) ? e.issuetype : null,
    score: score(e.score), gate: oneOf(['pass', 'refuse'])(e.gate), rubric: word(e.rubric), legacy: e.legacy === true,
    missing: words(e.missing), filled: count(e.filled),
  }),
  pipeline: e => ({
    key: key(e.key), verdict: word(e.verdict), decidedBy: word(e.decidedBy), adapter: word(e.adapter),
    steps: Array.isArray(e.steps) ? e.steps.map(s => ({ check: word(s?.check), status: word(s?.status) })) : [],
    counts: { specs: num(e.counts?.specs), passed: num(e.counts?.passed), failed: num(e.counts?.failed), skipped: num(e.counts?.skipped) },
    incompleteTicket: scored(e.incompleteTicket),
  }),
  jira: e => ({ key: key(e.key), action: oneOf(['comment', 'update'])(e.action) }),
  override: e => ({ key: key(e.key), score: score(e.score), bar: score(e.bar) }),
}

/** On unless QC_NO_AUDIT=1 or the caller's --no-audit. */
export const auditOff = (env = process.env, flag = false) => flag === true || env.QC_NO_AUDIT === '1'

/** Append one event. True when written; false when off, unknown or the write failed. */
export function audit(root, kind, entry, { env = process.env, off = false, now = new Date() } = {}) {
  if (auditOff(env, off) || !Object.hasOwn(SHAPE, kind)) return false
  try {
    const dir = join(root, AUDIT_DIR)
    mkdirSync(dir, { recursive: true })
    // The folder ignores itself, so the log stays out of git even before setup adds its line.
    try { writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' }) } catch {}
    appendFileSync(join(dir, `${kind}.jsonl`), `${JSON.stringify({ ...SHAPE[kind](entry ?? {}), date: now.toISOString() })}\n`)
    return true
  } catch {
    return false
  }
}

/** Every readable object line of a JSONL file, in order; a missing file is empty. */
export function readJsonl(path) {
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  return text.split('\n').flatMap(l => {
    if (!l.trim()) return []
    try {
      const o = JSON.parse(l)
      return o && typeof o === 'object' && !Array.isArray(o) ? [o] : []
    } catch { return [] }
  })
}

export const readAudit = (root, kind) => (Object.hasOwn(SHAPE, kind) ? readJsonl(join(root, AUDIT_DIR, `${kind}.jsonl`)) : [])
