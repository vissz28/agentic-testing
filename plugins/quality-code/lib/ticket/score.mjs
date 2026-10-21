import { buildVocabulary } from './languages/index.mjs'
import { labelOverride } from './messages.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'
import { adaptersForSide, isFullstack, sideOfAdapter, ticketSide } from '../base/stack.mjs'

/** Pass bar. A constant: never read from config or flags. */
export const THRESHOLD = 70

const RUBRICS = { playwright, vitest }

/** The rubric a ticket is scored with. On a fullstack project it depends on the ticket's side: see buildBrief. */
export function rubricFor(config, ticket = null) {
  if (isFullstack(config)) return RUBRICS[buildBrief(config, ticket ?? {}).rubric]
  const r = RUBRICS[config.adapter]
  if (!r) throw new Error(`adapter "${config.adapter}" has no rubric`)
  return r
}

/** The side a ticket is scored for on a fullstack project: the one set with `ticket.mjs side`, else its marks. */
export const sideFor = (config, ticket) => ticket?.side ?? ticketSide(config, ticket)

/**
 * Score in 0..100 plus what is missing. ac_testable only counts if ac_present is also true. The
 * keys the config can never credit (`omitted`) are left out, and the rest is scaled to 100: a
 * project with no features is not capped below the bar.
 */
export function scoreTicket(rubric, signals = {}, omitted = new Set()) {
  let score = 0
  let total = 0
  const missing = []
  for (const [key, [weight, label]] of Object.entries(rubric.weights)) {
    const credited =
      key === 'ac_testable' ? !!signals.ac_testable && !!signals.ac_present : !!signals[key]
    if (omitted.has(key)) {
      if (!credited) missing.push({ key, weight, label })
      continue
    }
    total += weight
    if (credited) score += weight
    else missing.push({ key, weight, label })
  }
  missing.sort((a, b) => b.weight - a.weight)
  const scaled = total ? Math.round((score * 100) / total) : 0
  return { score: Math.max(0, Math.min(100, scaled)), missing }
}

/** Below the threshold is refuse: a readable Then does not save a thin ticket. */
export function decideGate(score) {
  return score >= THRESHOLD ? 'pass' : 'refuse'
}

/**
 * The readiness brief. On a fullstack project a frontend ticket is scored with the Playwright rubric,
 * a backend one with the Vitest rubric, and a fullstack or unmarked one with both: it gets tests on
 * both sides, so the lower score decides.
 */
export function buildBrief(config, ticket) {
  if (!isFullstack(config)) return briefFor(config, RUBRICS[config.adapter] ?? rubricFor(config), ticket)
  const side = sideFor(config, ticket)
  const briefs = adaptersForSide(side).map(a => briefFor({ ...config, adapter: a }, RUBRICS[a], ticket))
  const brief = briefs.reduce((low, b) => (b.score < low.score ? b : low))
  brief.side = side
  if (briefs.length > 1) brief.sides = Object.fromEntries(briefs.map(b => [sideOfAdapter(b.rubric), { score: b.score, gate: b.gate }]))
  return brief
}

function briefFor(config, rubric, ticket) {
  const v = buildVocabulary(config.languages)
  const { legacy, ...signals } = rubric.deriveSignals(v, config, ticket)
  const omitted = rubric.omitted?.(config) ?? new Set()
  const { score, missing } = scoreTicket(rubric, signals, omitted)
  const derivable = rubric.derivable(v, ticket)
  const gate = decideGate(score)
  const feature = rubric.feature(config, ticket)
  const labels = rubric.labels?.(config) ?? {}
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
    missing: missing
      .filter(m => !omitted.has(m.key))
      .map(m => ({ key: m.key, label: labelOverride(config, ticket.issuetype, m.key) ?? labels[m.key] ?? m.label, weight: m.weight })),
    flags,
    signals,
  }
  // Non-enumerable: the JSON brief keeps exactly today's field set.
  Object.defineProperty(brief, 'rubric', { value: rubric.id, enumerable: false })
  Object.defineProperty(brief, 'omitted', { value: omitted, enumerable: false })
  return brief
}

/** The human-readable report, in the wording of the brief's own rubric. */
export function formatReport(brief) {
  const rubric = RUBRICS[brief.rubric]
  if (!rubric) throw new Error('brief has no rubric')
  const report = rubric.formatReport(brief)
  if (!('side' in brief)) return report
  const [first, ...rest] = report.split('\n')
  return [first, sideLine(brief), ...rest].join('\n')
}

const SIDE_TEXT = {
  frontend: 'frontend: Playwright tests of a screen',
  backend: 'backend: Vitest tests of the code',
  fullstack: 'fullstack: Vitest and Playwright tests; the lower of the two scores decides',
}

function sideLine(brief) {
  return `Side: ${SIDE_TEXT[brief.side] ?? 'not marked on the ticket, so scored for both Vitest and Playwright; the lower score decides'}`
}
