// Central Context testing rules for a ticket's side. They shape how tests are written; never expected values, scores or checks.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backendOf } from '../stacks/backends.mjs'
import { lines, plural } from '../core/text.mjs'
import { noTrailingSlash } from '../core/paths.mjs'

export const HUB_TIMEOUT_MS = 3000
export const DOMAIN = 'quality'

// Tags that make a quality rule a testing rule (CI/infra rules don't count).
export const TESTING_TAGS = Object.freeze(new Set(['test', 'tests', 'testing', 'testability', 'unit-test', 'unit-tests', 'integration-test', 'integration-tests', 'e2e', 'e2e-test', 'e2e-tests', 'test-case', 'test-cases', 'test-strategy']))

// applies_to values per side; "all" matches everywhere.
const FRONTEND = ['web', 'typescript', 'javascript']
const BACKEND = { vitest: ['node', 'typescript', 'javascript', 'rest'], pytest: ['python', 'rest'], junit: ['java', 'rest'], dotnet: ['dotnet', 'rest'], go: ['rest'] }

export function stacksFor(side, config = null) {
  const backend = BACKEND[backendOf(config) ?? 'vitest'] ?? []
  const of = { frontend: FRONTEND, backend, fullstack: [...backend, ...FRONTEND] }
  return [...new Set(['all', ...(of[side] ?? of.fullstack)])]
}

// Duplicated in plugin.json, tests, docs and guides: grep -rn "centralcontext-dev.teamsystem.cloud" before changing it.
export const DEFAULT_HUB = 'https://centralcontext-dev.teamsystem.cloud'

/** CC_HUB_URL, then centralContext.hub, then DEFAULT_HUB. */
export function hubOf(config, env = process.env) {
  const v = env.CC_HUB_URL ?? config?.centralContext?.hub
  return typeof v === 'string' && v.trim() ? noTrailingSlash(v.trim()) : DEFAULT_HUB
}

const SEVERITY = ['critical', 'high', 'medium', 'low']
const rank = s => (SEVERITY.includes(s) ? SEVERITY.indexOf(s) : SEVERITY.length)

// A one-value field (applies_to: all) is a string, not a list.
const asList = v => (v == null ? null : Array.isArray(v) ? v : [v])
const pick = d => ({ id: d.id, title: d.title ?? d.id, summary: d.summary ?? '', severity: d.severity ?? null, applies_to: asList(d.applies_to) ?? [] })
const bySeverity = (a, b) => rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id)

/** Most severe first. */
export function testingRules(documents, stacks) {
  const want = new Set(stacks)
  return (documents ?? [])
    .filter(d => d.domain === DOMAIN && d.status === 'active')
    .filter(d => (asList(d.tags) ?? []).some(t => TESTING_TAGS.has(String(t).toLowerCase())))
    .filter(d => (asList(d.applies_to) ?? []).some(a => want.has(a)))
    .map(pick)
    .sort(bySeverity)
}

// A YAML escape JSON rejects ("C:\Users") falls back to the raw text.
const unquote = v => (/^".*"$/.test(v) ? (() => { try { return JSON.parse(v) } catch { return v.slice(1, -1) } })() : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v)
const scalar = v => (v === '' || v === 'null' ? null : v.startsWith('[') && v.endsWith(']') ? (v.slice(1, -1).match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g) ?? []).map(x => unquote(x.trim())).filter(Boolean) : unquote(v))

/**
 * Frontmatter as the knowledge repo writes it: `key: value` lines with strings, null or [a, b] lists.
 * ponytail: one-line values only, as the repository writes them; a multi-line YAML value is not read.
 */
export function parseRule(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text))
  if (!m) return null
  const out = {}
  for (const line of lines(m[1])) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = scalar(kv[2].trim())
  }
  return out
}

/** Every rule in the team's folder counts as a testing rule, whatever its domain or tags. */
const LOCAL_STATUSES = new Set(['active', 'draft'])

export function localRules(root, dir, stacks) {
  let files
  try { files = readdirSync(join(root, dir)).filter(f => f.endsWith('.md') && !/^(README|CHANGELOG)\.md$/i.test(f)).sort() } catch { return { dir, rules: [], error: `folder not found: ${dir}` } }
  const want = new Set(stacks)
  // Skip unreadable files: readRules never throws.
  const docs = files.map(f => { try { return parseRule(readFileSync(join(root, dir, f), 'utf8')) } catch { return null } }).filter(d => d?.id && d.summary)
  // Team drafts count; deprecated and retired rules don't.
  const rules = docs.filter(d => LOCAL_STATUSES.has(d.status ?? 'active') && (asList(d.applies_to) ?? ['all']).some(a => want.has(a)))
    .map(d => ({ ...pick(d), status: d.status ?? 'active' })).sort(bySeverity)
  return { dir, rules, error: null }
}

// Shipped drafts, used until Central Context publishes them.
export const BUILTIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const BUILTIN_DIR = 'rules/'

/** Same id wins in order: local, Central Context, built-in. Never throws; a failed source reports why. */
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
  if (hub === 'off') return none('is turned off in the config')
  try {
    const res = await fetchImpl(`${hub}/v1/manifest`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const manifest = await res.json()
    return done({ source: 'hub', hub, release: manifest?.release?.release_id ?? null, side, stacks, rules: testingRules(manifest?.documents, stacks).filter(x => !taken.has(x.id)), error: null })
  } catch (e) {
    return none(`could not be reached at ${hub} (${String(e?.message ?? e).split('\n')[0]})`)
  }
}

const count = (n, kind = 'testing') => (n ? plural(n, `${kind} rule`) : `no ${kind} rules`)
const draftNote = rules => {
  const d = rules.filter(x => x.status === 'draft').length
  return !d ? '' : `, ${d === rules.length ? (d === 1 ? 'a draft' : 'all drafts') : plural(d, 'draft')}`
}

// Saved beside the ticket (--key) for the result card.
export const rulesRecord = (r, date = new Date()) => ({
  source: r.source, hub: r.hub, release: r.release, error: r.error, side: r.side,
  hubRules: r.rules.length, builtinRules: r.builtin?.rules.length ?? 0, localRules: r.local && !r.local.error ? r.local.rules.length : 0,
  ids: [...(r.local?.rules ?? []), ...r.rules, ...(r.builtin?.rules ?? [])].map(x => x.id), date: date.toISOString(),
})

export function rulesLine(rec) {
  const others = [rec.localRules && `${rec.localRules} local`, rec.builtinRules && `${rec.builtinRules} built-in`].filter(Boolean).join(' and ')
  if (rec.source === 'hub') return `✅ Written with ${rec.hubRules ? plural(rec.hubRules, 'rule') : 'no rules'} from Central Context${rec.release ? ` (release ${rec.release})` : ''}${others ? ` and ${others} rules` : ''}`
  return `⚠️ Central Context ${rec.error}. ${others ? `Written with ${others} rules instead` : 'No rules applied'}`
}

// One line per source; the rules themselves go in RULES_JSON.
export function formatRules(r) {
  const others = (r.local?.rules.length ?? 0) + (r.builtin?.rules.length ?? 0)
  const lines = [r.source !== 'hub'
    ? `⚠️ Central Context ${r.error}.${others ? '' : ' No rules applied.'}`
    : `✅ Central Context: ${count(r.rules.length, `${r.side} testing`)} (release ${r.release})`]
  if (r.builtin && !r.builtin.error && r.builtin.rules.length) lines.push(`✅ Built-in rules: ${count(r.builtin.rules.length, `${r.side} testing`)}${draftNote(r.builtin.rules)}`)
  if (r.local) lines.push(r.local.error ? `⚠️ Local rules not read: ${r.local.error}.` : `✅ Local rules: ${count(r.local.rules.length, `${r.side} testing`)} (${r.local.dir})${draftNote(r.local.rules)}`)
  return lines.join('\n')
}
