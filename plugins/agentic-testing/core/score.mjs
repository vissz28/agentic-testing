import { buildVocabulary } from './languages/index.mjs'
import { labelOverride } from './messages.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'

/** Pass bar. A constant: never read from config or flags. */
export const THRESHOLD = 70

const RUBRICS = { playwright, vitest }

export function rubricFor(config) {
  const r = RUBRICS[config.adapter]
  if (!r) throw new Error(`adapter "${config.adapter}" has no rubric`)
  return r
}

/** Score in 0..100 plus what is missing. ac_testable only counts if ac_present is also true. */
export function scoreTicket(rubric, signals = {}) {
  let score = 0
  const missing = []
  for (const [key, [weight, label]] of Object.entries(rubric.weights)) {
    const credited =
      key === 'ac_testable' ? !!signals.ac_testable && !!signals.ac_present : !!signals[key]
    if (credited) score += weight
    else missing.push({ key, weight, label })
  }
  missing.sort((a, b) => b.weight - a.weight)
  return { score: Math.max(0, Math.min(100, score)), missing }
}

/** Below the threshold is refuse: a readable Then does not save a thin ticket. */
export function decideGate(score) {
  return score >= THRESHOLD ? 'pass' : 'refuse'
}

export function buildBrief(config, ticket) {
  const rubric = rubricFor(config)
  const v = buildVocabulary(config.languages)
  const { legacy, ...signals } = rubric.deriveSignals(v, config, ticket)
  const { score, missing } = scoreTicket(rubric, signals)
  const derivable = rubric.derivable(v, ticket)
  const gate = decideGate(score)
  const feature = rubric.feature(config, ticket)
  const flags = [...(ticket.flags || [])]
  if (legacy) flags.unshift(rubric.legacyFlag(THRESHOLD))
  const brief = {
    key: ticket.key ?? null,
    browse: ticket.browse ?? null,
    issuetype: ticket.issuetype ?? null,
    status: ticket.status ?? null,
    score,
    threshold: THRESHOLD,
    gate,
    legacy,
    feature,
    ...rubric.briefExtras(config, ticket, feature),
    scenarios: ticket.scenarios ?? [],
    derivable,
    missing: missing.map(m => ({ key: m.key, label: labelOverride(config, ticket.issuetype, m.key) ?? m.label, weight: m.weight })),
    flags,
    signals,
  }
  // Non-enumerable: the JSON brief keeps exactly today's field set.
  Object.defineProperty(brief, 'rubric', { value: rubric.id, enumerable: false })
  return brief
}

/** The human-readable report, in the wording of the brief's own rubric. */
export function formatReport(brief) {
  const rubric = RUBRICS[brief.rubric]
  if (!rubric) throw new Error('brief has no rubric')
  return rubric.formatReport(brief)
}
