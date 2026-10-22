import { countDerivableFromText, hasHeading } from '../criteria.mjs'
import { acSignals, attachmentsSignal, linksSignal, envSignal, escapeRegExp, featureOf, hasFeatureLabel, hasListChecks, omittedKeys, stepsSignal } from './shared.mjs'

// Weighted rubric for the Vitest stack, sums to 100. No route or QA-plan signals.
const weights = {
  ac_present: [25, 'acceptance criteria (Given / When / Then, or a list under an Acceptance criteria heading), in the criteria field or the description'],
  ac_testable: [15, 'testable AC: each Then or AC item an observable assertion, not "works correctly"'],
  steps: [10, 'steps to reproduce (Bug) or a user story (Story)'],
  expected_defined: [15, 'clear expected behaviour (Expected vs Actual, or AC present)'],
  attachments: [10, 'an attachment (a screenshot, a video or a file on the ticket)'],
  links: [5, 'a link (a linked issue, or a web link such as Figma or Confluence)'],
  context: [5, 'a Context / Summary section'],
  title_prefix: [5, 'title prefix (a configured one)'],
  feature_label: [5, 'a feature label from the configured features'],
  environment: [5, 'environment / workspace context'],
}

function deriveSignals(v, config, ticket) {
  const description = ticket.text?.description || ''
  const acField = ticket.text?.acField || ''
  const summary = ticket.summary || ''
  const { ac_present, ac_testable } = acSignals(v, description, acField)
  const steps = stepsSignal(v, hasHeading, description)
  // Field bugs use question form ("What happens?"), which a heading match misses.
  const hasExpected = hasHeading(v, description, v.expectedHeading) || v.expectedPhrase.test(description)
  const hasActual = hasHeading(v, description, v.actualHeading) || v.actualPhrase.test(description)
  const expected_defined = ac_present || (hasExpected && hasActual)
  const context = hasHeading(v, description, v.contextHeadingBE) || v.contextPhrase.test(description)
  const prefixes = config.titlePrefixes ?? []
  // An empty list never matches (an empty alternation would accept a bare "[]").
  const title_prefix = prefixes.length > 0 &&
    new RegExp('^\\s*\\[(?:' + prefixes.map(escapeRegExp).join('|') + ')\\]', 'i').test(summary)
  const feature_label = hasFeatureLabel(config, ticket.labels)
  const environment = envSignal(v, hasHeading, description)
  const anyStructure =
    ac_present || steps || hasExpected || hasActual || environment || context || title_prefix ||
    hasListChecks(v, description)
  return {
    ac_present, ac_testable, steps, expected_defined, context, title_prefix, feature_label,
    environment, attachments: attachmentsSignal(ticket), links: linksSignal(ticket), legacy: !anyStructure,
  }
}

function formatReport(brief) {
  const { key, score, threshold, gate, legacy, feature, scenarios = [], derivable = 0, missing = [], flags = [], omitted = new Set() } = brief
  const band = legacy ? 'legacy / unstructured' : gate === 'pass' ? 'ready' : 'too thin'
  const gateLine =
    gate === 'pass'
      ? 'pass, ok to generate.'
      : `refuse, below ${threshold}%. Do not generate. Add the missing items on the ticket, then re-run.${legacy ? ' Legacy ticket, no template structure.' : ''}`
  return [
    `${key}: test-readiness ${score}% · ${band} (threshold ${threshold}%)`,
    ...(omitted.has('feature_label') ? [] : [feature ? `Feature label: ${feature}` : 'Feature label: none']),
    `Expected chunks in ticket text: ${derivable} assertable · model harvested ${scenarios.length} scenario(s) (not scored)`,
    missing.length
      ? `Missing (each lowers the score):\n${missing.map(m => `  - ${m.label} (${m.weight})`).join('\n')}`
      : 'Missing: nothing, full marks.',
    flags.length ? `Flags:\n${flags.map(f => `  - ${f}`).join('\n')}` : 'Flags: none',
    `Gate: ${gateLine}`,
  ].join('\n')
}

export default {
  id: 'vitest',
  weights,
  deriveSignals,
  derivable: (v, ticket) =>
    countDerivableFromText(v, [ticket.summary, ticket.text?.description, ticket.text?.acField].filter(Boolean).join('\n')),
  feature: (config, ticket) => featureOf(config, ticket.labels),
  briefExtras: () => ({}),
  omitted: config => {
    const keys = omittedKeys(config)
    if (!(config.titlePrefixes ?? []).length) keys.add('title_prefix')
    return keys
  },
  labels: config => ({ title_prefix: `title prefix (a configured one, e.g. [${(config.titlePrefixes ?? []).join('|')}])` }),
  legacyFlag: threshold => `legacy / unstructured: no template structure. Refused until the ticket meets the ${threshold}% bar.`,
  formatReport,
}
