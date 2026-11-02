// The Central Context testing rules for a ticket's side. The knowledge lives in the company's Central Context
// hub (its knowledge repository, served by cc-hub): /quality-code:spec reads the active rules of the quality
// domain that are about testing and apply to the side's stack, and follows them while it writes the tests.
// The rules inform how tests are written; they never add an expected value, change a score or skip a check.
//
// The hub: `centralContext.hub` in .claude/quality-code.json (the base URL; "off" reads nothing), or the
// CC_HUB_URL environment variable, which wins. One read of GET /v1/manifest, which carries every rule's
// summary, tags and applies_to.
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

/** The active testing rules of the quality domain whose applies_to meets the stacks, most severe first. */
export function testingRules(documents, stacks) {
  const want = new Set(stacks)
  return (documents ?? [])
    .filter(d => d.domain === DOMAIN && d.status === 'active')
    .filter(d => (d.tags ?? []).some(t => TESTING_TAGS.has(String(t).toLowerCase())))
    .filter(d => (d.applies_to ?? []).some(a => want.has(a)))
    .map(d => ({ id: d.id, title: d.title ?? d.id, summary: d.summary ?? '', severity: d.severity ?? null, applies_to: d.applies_to ?? [] }))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id))
}

/** The rules for a side, read from the hub. Never throws: without a hub, or when it fails, there are no rules and the reason says why. */
export async function readRules({ side, config = null, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = HUB_TIMEOUT_MS } = {}) {
  const hub = hubOf(config, env)
  const stacks = stacksFor(side, config)
  const none = error => ({ source: 'none', hub, release: null, side, stacks, rules: [], error })
  if (hub === null) return none('not configured (centralContext.hub)')
  if (hub === 'off') return none('off (centralContext.hub: "off")')
  try {
    const res = await fetchImpl(`${hub}/v1/manifest`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const manifest = await res.json()
    return { source: 'hub', hub, release: manifest?.release?.release_id ?? null, side, stacks, rules: testingRules(manifest?.documents, stacks), error: null }
  } catch (e) {
    return none(`not reachable at ${hub} (${String(e?.message ?? e).split('\n')[0]})`)
  }
}

/** The block spec shows before the plan: where the rules come from, then one rule per entry. */
export function formatRules(r) {
  if (r.source !== 'hub') return `From Central Context: ${r.error}, so no rule is applied.`
  const head = `From Central Context (release ${r.release}): testing rules for the ${r.side} side (${r.stacks.join(', ')})`
  if (!r.rules.length) return `${head}: none applies.`
  return [`${head}`, ...r.rules.flatMap(x => [`  ${x.id} · ${x.severity ?? 'no severity'}`, `    ${x.summary}`])].join('\n')
}
