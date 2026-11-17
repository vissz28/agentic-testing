import { buildVocabulary } from './languages/index.mjs'
import { labelOverride, templateFor } from './messages.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'
import { adaptersForSide, isFullstack, sideOfAdapter, ticketSide } from '../stacks/stack.mjs'
import { backendOf, isBackend, runnerLabel } from '../stacks/backends.mjs'

// Deliberately not configurable.
export const THRESHOLD = 70

const RUBRICS = { playwright, vitest }

// Every backend runner uses the backend rubric (id "vitest").
export const rubricOfAdapter = adapter => (adapter === 'playwright' ? playwright : isBackend(adapter) ? vitest : undefined)

// Bug-only items, never asked of a Story.
const NOT_ON_STORY = ['environment', 'expected_defined']

/** Keys that can't cost points: rubric omissions for this config, plus Bug keys on a Story. */
export function omittedFor(rubric, config, ticket) {
  const keys = new Set(rubric.omitted?.(config, ticket) ?? [])
  if (templateFor(ticket?.issuetype, config) === 'story') for (const k of NOT_ON_STORY) keys.add(k)
  return keys
}

/** On fullstack the rubric depends on the ticket's side; see buildBrief. */
export function rubricFor(config, ticket = null) {
  if (isFullstack(config)) return RUBRICS[buildBrief(config, ticket ?? {}).rubric]
  const r = rubricOfAdapter(config.adapter)
  if (!r) throw new Error(`adapter "${config.adapter}" has no rubric`)
  return r
}

/** `ticket.mjs side` overrides the side inferred from the ticket. */
export const sideFor = (config, ticket) => ticket?.side ?? ticketSide(config, ticket)

/**
 * Score 0..100. ac_testable counts only with ac_present.
 * An omitted key leaves the denominator unless earned, so unreachable points never lower the score.
 */
export function scoreTicket(rubric, signals = {}, omitted = new Set()) {
  let score = 0
  let total = 0
  const missing = []
  for (const [key, [weight, label]] of Object.entries(rubric.weights)) {
    const credited =
      key === 'ac_testable' ? !!signals.ac_testable && !!signals.ac_present : !!signals[key]
    if (omitted.has(key) && !credited) continue
    total += weight
    if (credited) score += weight
    else missing.push({ key, weight, label })
  }
  missing.sort((a, b) => b.weight - a.weight)
  const scaled = n => (total ? Math.max(0, Math.min(100, Math.round((n * 100) / total))) : 0)
  // Points each missing item adds, after rescaling.
  const gains = Object.fromEntries(missing.map(m => [m.key, scaled(score + m.weight) - scaled(score)]))
  return { score: scaled(score), missing, gains }
}

export function decideGate(score) {
  return score >= THRESHOLD ? 'pass' : 'refuse'
}

// Fullstack: a ticket on both sides (or unmarked) is scored with both rubrics and the lower wins.
export function buildBrief(config, ticket) {
  if (!isFullstack(config)) return briefFor(config, rubricOfAdapter(config.adapter) ?? rubricFor(config), ticket)
  const side = sideFor(config, ticket)
  const briefs = adaptersForSide(side, config).map(a => briefFor({ ...config, adapter: a }, rubricOfAdapter(a), ticket))
  const brief = briefs.reduce((low, b) => (b.score < low.score ? b : low))
  brief.side = side
  // Non-enumerable so it stays out of the JSON brief.
  Object.defineProperty(brief, 'backendLabel', { value: runnerLabel(backendOf(config)), enumerable: false })
  if (briefs.length > 1) brief.sides = Object.fromEntries(briefs.map(b => [sideOfAdapter(b.rubric), { score: b.score, gate: b.gate }]))
  return brief
}

function briefFor(config, rubric, ticket) {
  const v = buildVocabulary(config.languages)
  const { legacy, ...signals } = rubric.deriveSignals(v, config, ticket)
  const omitted = omittedFor(rubric, config, ticket)
  const { score, missing, gains } = scoreTicket(rubric, signals, omitted)
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
    missing: missing.map(m => ({ key: m.key, label: labelOverride(config, ticket.issuetype, m.key) ?? labels[m.key] ?? m.label, weight: m.weight })),
    flags,
    signals,
  }
  // Non-enumerable so the JSON brief's fields don't change.
  Object.defineProperty(brief, 'rubric', { value: rubric.id, enumerable: false })
  Object.defineProperty(brief, 'omitted', { value: omitted, enumerable: false })
  Object.defineProperty(brief, 'gains', { value: gains, enumerable: false })
  return brief
}

export function formatReport(brief) {
  const rubric = RUBRICS[brief.rubric]
  if (!rubric) throw new Error('brief has no rubric')
  const report = rubric.formatReport(brief)
  if (!('side' in brief)) return report
  const [first, ...rest] = report.split('\n')
  return [first, sideLine(brief), ...rest].join('\n')
}

const SIDE_TEXT = {
  frontend: () => 'frontend: Playwright tests of a screen',
  backend: b => `backend: ${b} tests of the code`,
  fullstack: b => `fullstack: ${b} and Playwright tests; the lower of the two scores decides`,
}

function sideLine(brief) {
  const b = brief.backendLabel ?? 'Vitest'
  return `Side: ${SIDE_TEXT[brief.side]?.(b) ?? `not marked on the ticket, so scored for both ${b} and Playwright; the lower score decides`}`
}
