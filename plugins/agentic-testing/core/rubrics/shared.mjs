import { extractNaturalAC, hasGherkin, hasNaturalAC, hasThen, hasVaguePhrase } from '../criteria.mjs'
import { stripComments } from '../text.mjs'

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
  const thenLines = (stripComments(acText).match(v.thenAndLines) || []).join('\n')
  const ac_testable =
    ac_present &&
    (hasThen(v, acText) || natural) &&
    !hasVaguePhrase(v, thenLines) &&
    !naturalItems.some(i => hasVaguePhrase(v, i))
  return { ac_present, ac_testable }
}

/** A regular-expression source that matches `text` literally. */
export const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The keys this config can never credit: no features means no feature label to add. They score 0
 * and are left out of the missing list, so nobody is asked for them.
 */
export const omittedKeys = config => new Set((config.features ?? []).length ? [] : ['feature_label'])

export const hasFeatureLabel = (config, labels) =>
  (labels || []).some(l => config.features.some(f => f.label === l))

export const stepsSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.stepsHeading) ||
  hasHeading(v, description, v.userStoryHeading) ||
  v.userStoryLine.some(r => r.test(description))

export const envSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.environmentHeading) && /\benv\b\s*[:=]/i.test(description)
