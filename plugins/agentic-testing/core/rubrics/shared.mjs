import { extractNaturalAC, hasGherkin, hasNaturalAC, hasThen, hasVaguePhrase } from '../criteria.mjs'

/**
 * The acceptance-criteria signals, identical for both stacks. Vagueness is judged only on the
 * Then/And lines and the AC items: a vague word elsewhere does not make the criteria untestable.
 */
export function acSignals(v, description, acField) {
  const acText = [acField, description].filter(Boolean).join('\n')
  const gherkin = hasGherkin(v, acField) || hasGherkin(v, description)
  const naturalItems = [...extractNaturalAC(v, acField, { headingless: true }), ...extractNaturalAC(v, description)]
  const natural = hasNaturalAC(naturalItems)
  const ac_present = gherkin || natural
  const thenLines = (acText.match(v.thenAndLines) || []).join('\n')
  const ac_testable =
    ac_present &&
    (hasThen(v, acText) || natural) &&
    !hasVaguePhrase(v, thenLines) &&
    !naturalItems.some(i => hasVaguePhrase(v, i))
  return { ac_present, ac_testable }
}

export const hasFeatureLabel = (config, labels) =>
  (labels || []).some(l => config.features.some(f => f.label === l))

export const stepsSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.stepsHeading) ||
  hasHeading(v, description, v.userStoryHeading) ||
  v.userStoryLine.some(r => r.test(description))

export const envSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.environmentHeading) && /\benv\b\s*[:=]/i.test(description)
