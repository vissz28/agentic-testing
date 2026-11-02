// The Central Context rules the checks are bound by. The plugin cites rule ids, never rule text: the
// text is read from the hub (cc-hub serve) when a run starts, and every run records which rules, in
// which status and from which release. When the hub is not configured or not reachable, the pinned
// snapshot next to this file stands in, and the record says so. A missing rule never passes a check.
//
// The hub: `centralContext.hub` in .claude/quality-code.json (the base URL; "off" turns the hub off),
// or the CC_HUB_URL environment variable, which wins. Nothing here grades: provenance only.
import { readFileSync } from 'node:fs'

export const SNAPSHOT_URL = new URL('./rules.snapshot.json', import.meta.url)
export const HUB_TIMEOUT_MS = 3000

/** Gate -> rule id. A new gate is a change to the plugin; a new rule is a change in Central Context. */
export const GATE_RULES = Object.freeze({
  readiness: 'quality.ready-requirement-before-test-generation',
  fail_evidence: 'quality.generated-test-fail-evidence',
  assertion: 'quality.test-asserts-observable-outcome',
  weakening: 'quality.test-weakening-justified',
})
export const RULE_IDS = Object.freeze(Object.values(GATE_RULES))

/** Which gate each pipeline check answers to; a check with no rule (boundary, types, flaky) is the plugin's own. */
export const CHECK_GATES = Object.freeze({
  honesty: 'weakening',
  'suite-honesty': 'assertion',
  expected: 'readiness',
  tests: 'fail_evidence',
  mutation: 'fail_evidence',
  stryker: 'fail_evidence',
})
export const ruleOfCheck = check => (CHECK_GATES[check] ? GATE_RULES[CHECK_GATES[check]] : null)

const pick = d => ({ id: d.id, title: d.title ?? d.id, summary: d.summary ?? '', status: d.status ?? 'unknown', severity: d.severity ?? null, owner: d.owner ?? null })
const missingOf = rules => RULE_IDS.filter(id => !rules.some(r => r.id === id))

/** The hub base URL for this project: the environment first, then the config; null when neither names one. */
export function hubOf(config, env = process.env) {
  const v = env.CC_HUB_URL ?? config?.centralContext?.hub ?? null
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : null
}

export function loadSnapshot(url = SNAPSHOT_URL) {
  const snap = JSON.parse(readFileSync(url, 'utf8'))
  const rules = (snap.rules ?? []).map(pick)
  return { source: 'snapshot', hub: null, release: snap.release_id ?? null, pinnedAt: snap.pinned_at ?? null, rules, missing: missingOf(rules), error: null }
}

/** Read every rule by id from the hub's REST surface. Throws on a transport error; a 404 is a missing rule, not an error. */
export async function fetchFromHub(hub, { fetchImpl = globalThis.fetch, timeoutMs = HUB_TIMEOUT_MS } = {}) {
  const get = async path => {
    const res = await fetchImpl(`${hub}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    return res.json()
  }
  const manifest = await get('/v1/manifest')
  const docs = await Promise.all(RULE_IDS.map(id => get(`/v1/documents/${encodeURIComponent(id)}`)))
  const rules = docs.filter(Boolean).map(pick)
  return { source: 'hub', hub, release: manifest?.release?.id ?? docs.find(Boolean)?.release_id ?? null, pinnedAt: null, rules, missing: missingOf(rules), error: null }
}

/**
 * The provenance of this run's rules: the hub when it is configured and answers, else the snapshot
 * with the reason. Never throws: a run without any rule source still records that it had none.
 */
export async function resolveRules({ hub = null, fetchImpl, timeoutMs, snapshotUrl } = {}) {
  const snapshot = reason => {
    try { return { ...loadSnapshot(snapshotUrl), hub, error: reason } } catch (e) {
      return { source: 'none', hub, release: null, pinnedAt: null, rules: [], missing: [...RULE_IDS], error: `${reason}; no snapshot (${e.message})` }
    }
  }
  if (hub === null) return snapshot('Central Context not configured (centralContext.hub)')
  if (hub === 'off') return snapshot('Central Context off (centralContext.hub: "off")')
  try { return await fetchFromHub(hub, { fetchImpl, timeoutMs }) } catch (e) {
    return snapshot(`Central Context not reachable at ${hub} (${String(e?.message ?? e).split('\n')[0]})`)
  }
}

/** One line for the card. */
export function rulesCardLine(prov) {
  if (!prov) return null
  if (prov.source === 'hub') return `Rules: Central Context release ${prov.release}, ${prov.rules.length} rule${prov.rules.length === 1 ? '' : 's'} read live${prov.missing.length ? `, ${prov.missing.length} missing` : ''}.`
  if (prov.source === 'snapshot') return `Rules: pinned Central Context snapshot ${prov.release} (${prov.error}).`
  return `Rules: no Central Context source (${prov.error}).`
}

/** The run log's section: where the rules came from, one row per gate, the text of each rule's summary. */
export function rulesLogLines(prov) {
  if (!prov) return []
  const out = ['', '## Rules (Central Context)', '']
  if (prov.source === 'hub') out.push(`Read live from \`${prov.hub}\`, release \`${prov.release}\`. The plugin cites ids; the text is the hub's.`)
  else if (prov.source === 'snapshot') out.push(`**Hub not used:** ${prov.error}. Pinned snapshot \`${prov.release}\`${prov.pinnedAt ? ` from ${prov.pinnedAt}` : ''}.`)
  else out.push(`**No rule source:** ${prov.error}. The checks ran; which rule each one answers to is unverified.`)
  out.push('', '| Gate | Rule | Status | Severity | Owner |', '|---|---|---|---|---|')
  for (const [gate, id] of Object.entries(GATE_RULES)) {
    const r = prov.rules.find(x => x.id === id)
    out.push(r ? `| ${gate} | \`${id}\` ${r.title} | ${r.status} | ${r.severity ?? ''} | ${r.owner ?? ''} |` : `| ${gate} | \`${id}\` | **missing** | | |`)
  }
  const said = prov.rules.filter(r => r.summary)
  if (said.length) out.push('', ...said.map(r => `- \`${r.id}\`: ${r.summary}`))
  if (prov.missing.length) out.push('', `Missing from the source: ${prov.missing.map(m => `\`${m}\``).join(', ')}. A missing rule is not a passed rule.`)
  out.push('', 'Checks and gates: honesty and assertions answer to the honesty rule; expected to the readiness rule; tests, mutation and stryker to the fail-evidence rule.')
  return out
}

/** The compact record for the audit log: source, release and ids with status, never text. */
export function auditRules(prov) {
  if (!prov) return null
  return { source: prov.source, release: prov.release, ids: prov.rules.map(r => `${r.id}@${r.status}`), missing: [...prov.missing] }
}
