// The Central Context testing rules for a ticket's side. The knowledge lives in the company's Central Context
// hub (its knowledge repository, served by cc-hub): /quality-code:spec reads the active rules of the quality
// domain that are about testing and apply to the side's stack, and follows them while it writes the tests.
// The rules inform how tests are written; they never add an expected value, change a score or skip a check.
//
// The hub: `centralContext.hub` in .claude/quality-code.json (the base URL; "off" reads nothing), or the
// CC_HUB_URL environment variable, which wins. One read of GET /v1/manifest, which carries every rule's
// summary, tags and applies_to.
//
// The team's own rules: `centralContext.local`, a folder of rule files in the knowledge repository's format,
// read next to the hub's on every run. Both lists are candidates: spec applies only the rules that fit the
// tests it writes for the ticket, and says how many it applied from each.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backendOf } from './backends.mjs'

export const HUB_TIMEOUT_MS = 3000
export const DOMAIN = 'quality'

/** A quality rule is a testing rule when one of its tags is one of these (CI and infrastructure rules are not). */
export const TESTING_TAGS = Object.freeze(new Set(['test', 'tests', 'testing', 'testability', 'unit-test', 'unit-tests', 'integration-test', 'integration-tests', 'e2e', 'e2e-test', 'e2e-tests', 'test-case', 'test-cases', 'test-strategy']))

// The knowledge repository's applies_to values each side's code is written in; "all" applies everywhere.
const FRONTEND = ['web', 'typescript', 'javascript']
const BACKEND = { vitest: ['node', 'typescript', 'javascript', 'rest'], pytest: ['python', 'rest'], junit: ['java', 'rest'], dotnet: ['dotnet', 'rest'], go: ['rest'] }

/** The applies_to values a ticket's side matches, "all" first. */
export function stacksFor(side, config = null) {
  const backend = BACKEND[backendOf(config) ?? 'vitest'] ?? []
  const of = { frontend: FRONTEND, backend, fullstack: [...backend, ...FRONTEND] }
  return [...new Set(['all', ...(of[side] ?? of.fullstack)])]
}

/** The hub base URL for this project: the environment first, then the config; null when neither names one. */
export function hubOf(config, env = process.env) {
  const v = env.CC_HUB_URL ?? config?.centralContext?.hub ?? null
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : null
}

const SEVERITY = ['critical', 'high', 'medium', 'low']
const rank = s => (SEVERITY.includes(s) ? SEVERITY.indexOf(s) : SEVERITY.length)

const pick = d => ({ id: d.id, title: d.title ?? d.id, summary: d.summary ?? '', severity: d.severity ?? null, applies_to: d.applies_to ?? [] })
const bySeverity = (a, b) => rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id)

/** The active testing rules of the quality domain whose applies_to meets the stacks, most severe first. */
export function testingRules(documents, stacks) {
  const want = new Set(stacks)
  return (documents ?? [])
    .filter(d => d.domain === DOMAIN && d.status === 'active')
    .filter(d => (d.tags ?? []).some(t => TESTING_TAGS.has(String(t).toLowerCase())))
    .filter(d => (d.applies_to ?? []).some(a => want.has(a)))
    .map(pick)
    .sort(bySeverity)
}

const unquote = v => (/^".*"$/.test(v) ? JSON.parse(v) : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v)
const scalar = v => (v === '' || v === 'null' ? null : v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map(x => unquote(x.trim())).filter(Boolean) : unquote(v))

/**
 * The frontmatter of a rule file, in the knowledge repository's shape: one `key: value` per line, a value a plain
 * or quoted string, `null` or a `[a, b]` list. null without frontmatter.
 * ponytail: one-line values only, as the repository writes them; a multi-line YAML value is not read.
 */
export function parseRule(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text))
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = scalar(kv[2].trim())
  }
  return out
}

/**
 * The team's own rules from a folder of rule files: every one that is active (the default) and whose applies_to
 * (default all) meets the stacks. Every rule in the folder is the team's testing rule, whatever its domain or tags.
 */
const LOCAL_STATUSES = new Set(['active', 'draft'])

export function localRules(root, dir, stacks) {
  let files
  try { files = readdirSync(join(root, dir)).filter(f => f.endsWith('.md') && !/^(README|CHANGELOG)\.md$/i.test(f)).sort() } catch { return { dir, rules: [], error: `folder not found: ${dir}` } }
  const want = new Set(stacks)
  const docs = files.map(f => parseRule(readFileSync(join(root, dir, f), 'utf8'))).filter(d => d?.id && d.summary)
  // The team's own drafts count: the folder is the team's choice. Deprecated and retired rules do not.
  const rules = docs.filter(d => LOCAL_STATUSES.has(d.status ?? 'active') && (d.applies_to ?? ['all']).some(a => want.has(a)))
    .map(d => ({ ...pick(d), status: d.status ?? 'active' })).sort(bySeverity)
  return { dir, rules, error: null }
}

// The rules the plugin ships (rules/ next to lib/): drafts that hold until Central Context publishes them.
export const BUILTIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const BUILTIN_DIR = 'rules/'

/**
 * The rules for a side, from three sources: the project's own (`centralContext.local`), Central Context's and the
 * plugin's built-in ones. One id is one rule: the project's wins, then Central Context's (a published rule replaces
 * the plugin's draft of it), then the built-in one. Never throws: a source that fails has no rules and says why.
 */
export async function readRules({ side, config = null, root = null, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = HUB_TIMEOUT_MS, builtinRoot = BUILTIN_ROOT } = {}) {
  const hub = hubOf(config, env)
  const stacks = stacksFor(side, config)
  const dir = config?.centralContext?.local
  const local = dir && root ? localRules(root, dir, stacks) : null
  const shipped = localRules(builtinRoot, BUILTIN_DIR, stacks)
  const taken = new Set(local?.rules.map(x => x.id))
  const done = r => {
    for (const x of r.rules) taken.add(x.id)
    return { ...r, local, builtin: { ...shipped, rules: shipped.rules.filter(x => !taken.has(x.id)) } }
  }
  const none = error => done({ source: 'none', hub, release: null, side, stacks, rules: [], error })
  if (hub === null) return none('not configured (centralContext.hub)')
  if (hub === 'off') return none('off (centralContext.hub: "off")')
  try {
    const res = await fetchImpl(`${hub}/v1/manifest`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const manifest = await res.json()
    return done({ source: 'hub', hub, release: manifest?.release?.release_id ?? null, side, stacks, rules: testingRules(manifest?.documents, stacks).filter(x => !taken.has(x.id)), error: null })
  } catch (e) {
    return none(`not reachable at ${hub} (${String(e?.message ?? e).split('\n')[0]})`)
  }
}

const count = n => `${n || 'no'} testing rule${n === 1 ? '' : 's'}`
const draftNote = rules => {
  const d = rules.filter(x => x.status === 'draft').length
  return !d ? '' : `, ${d === rules.length ? (d === 1 ? 'a draft' : 'all drafts') : `${d} draft${d === 1 ? '' : 's'}`}`
}

/** One line per source spec shows as a completed step: what was read, what for, and from where. The rules themselves travel in RULES_JSON. */
export function formatRules(r) {
  const others = (r.local?.rules.length ?? 0) + (r.builtin?.rules.length ?? 0)
  const lines = [r.source !== 'hub'
    ? `⚠️ Central Context not read: ${r.error}.${others ? '' : ' No rule applied.'}`
    : `✅ Read from Central Context: ${count(r.rules.length)} for the ${r.side} side (release ${r.release}, ${r.hub})`]
  if (r.builtin && !r.builtin.error && r.builtin.rules.length) lines.push(`✅ Read the plugin's built-in rules: ${count(r.builtin.rules.length)} for the ${r.side} side${draftNote(r.builtin.rules)}`)
  if (r.local) lines.push(r.local.error ? `⚠️ Local rules not read: ${r.local.error}.` : `✅ Read from local rules: ${count(r.local.rules.length)} for the ${r.side} side (${r.local.dir})${draftNote(r.local.rules)}`)
  return lines.join('\n')
}
