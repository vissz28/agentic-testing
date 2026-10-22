import { countDerivable, hasHeading } from '../criteria.mjs'
import { acSignals, attachmentsSignal, linksSignal, envSignal, featureOf, hasFeatureLabel, omittedKeys, stepsSignal } from './shared.mjs'

// Weighted rubric for the Playwright stack, sums to 100. Routes a test to a screen, so a feature
// label and a QA plan carry weight.
const weights = {
  ac_present: [25, 'acceptance criteria (Given / When / Then, or a list under an Acceptance criteria heading) — in the field or description'],
  ac_testable: [15, 'testable AC — each Then or AC item an observable assertion, not "works correctly"'],
  steps: [10, 'steps to reproduce (Bug) or a user story (Story)'],
  expected_defined: [10, 'clear expected behavior (or Expected vs Actual for a bug)'],
  attachments: [10, 'an attachment (a screenshot, a video or a file on the ticket)'],
  links: [5, 'a link (a linked issue, or a web link such as Figma or Confluence)'],
  feature_label: [10, 'feature label (one of the configured features — routes the test to a screen)'],
  qa_plan_found: [10, 'a Confluence QA plan for the feature'],
  environment: [5, 'environment / workspace context'],
}

// No `issuetype`: the Bug/Story split only hints at WHICH section to expect, and both are
// accepted either way.
function deriveSignals(v, config, ticket) {
  const description = ticket.text?.description || ''
  const acField = ticket.text?.acField || ''
  const { ac_present, ac_testable } = acSignals(v, description, acField)
  const feature_label = hasFeatureLabel(config, ticket.labels)
  const steps = stepsSignal(v, hasHeading, description)
  const hasExpected = hasHeading(v, description, v.expectedHeading)
  const hasActual = hasHeading(v, description, v.actualHeading)
  const expected_defined = ac_present || (hasExpected && hasActual)
  const environment = envSignal(v, hasHeading, description)
  const anyStructure =
    ac_present || steps || hasExpected || hasActual || environment ||
    hasHeading(v, description, v.contextHeadingFE)
  return {
    ac_present, ac_testable, feature_label, steps, expected_defined, environment,
    qa_plan_found: !!ticket.qaPlan?.url,
    attachments: attachmentsSignal(ticket),
    links: linksSignal(ticket),
    legacy: !anyStructure,
  }
}

function briefExtras(config, ticket, feature) {
  return {
    route: ticket.route ?? config.features.find(f => f.label === feature)?.route ?? null,
    qaPlan: ticket.qaPlan ?? null,
    figma: ticket.figma ?? null,
    mr: ticket.mr ?? null,
  }
}

function formatReport(brief) {
  const { key, score, threshold, gate, legacy, feature, route, scenarios = [], derivable = 0, qaPlan, figma, mr, missing = [], flags = [] } = brief
  const band = legacy ? 'legacy / unstructured' : gate === 'pass' ? 'ready' : 'too thin'
  const gateLine =
    gate === 'pass'
      ? 'pass — ok to generate.'
      : `refuse — below ${threshold}%. Do not generate. Add the missing items on the ticket, then re-run.${legacy ? ' Legacy ticket, no template structure.' : ''}`
  return [
    `${key} — test-readiness ${score}% · ${band} (threshold ${threshold}%)`,
    `Feature: ${feature || 'none'}${route ? ` → ${route}` : ''}`,
    `QA plan: ${qaPlan?.url ? `found — ${qaPlan.title || qaPlan.url} · ${(qaPlan.scenarios || []).length} scenarios` : 'not found'}`,
    `Scenarios: ${scenarios.length} read from the ticket · ${derivable} with an expected result clear enough to assert on`,
    `Figma: ${figma || 'none'}   ·   MR: ${mr || 'none'}`,
    missing.length
      ? `Missing (each lowers the score):\n${missing.map(m => `  - ${m.label} (${m.weight})`).join('\n')}`
      : 'Missing: nothing — full marks.',
    flags.length ? `Flags:\n${flags.map(f => `  - ${f}`).join('\n')}` : 'Flags: none',
    `Gate: ${gateLine}`,
  ].join('\n')
}

export default {
  id: 'playwright',
  weights,
  deriveSignals,
  derivable: (v, ticket) => countDerivable(v, [...(ticket.scenarios || []), ...(ticket.qaPlan?.scenarios || [])]),
  feature: (config, ticket) => ticket.feature ?? featureOf(config, ticket.labels),
  briefExtras,
  // A team without Confluence ("confluence": false) never has a QA plan to find: it is left out of
  // the score rather than costing every ticket 15 points it can never earn.
  omitted: config => {
    const keys = omittedKeys(config)
    if (config.confluence === false) keys.add('qa_plan_found')
    return keys
  },
  legacyFlag: threshold => `legacy / unstructured — no template structure. Refused until the ticket meets the ${threshold}% bar.`,
  formatReport,
}
