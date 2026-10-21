import { extractNaturalAC, hasGherkin, hasNaturalAC, hasThen, hasVaguePhrase, stepText } from '../criteria.mjs'
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
  const thenLines = (stepText(v, stripComments(acText)).match(v.thenAndLines) || []).join('\n')
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
 * The keys this config can never credit: no features means no feature label to add. They are left
 * out of the score (it is scaled over the rest) and of the missing list, so nobody is asked for them.
 */
export const omittedKeys = config => new Set((config.features ?? []).length ? [] : ['feature_label'])

/** The configured feature label the ticket carries, whatever its case in Jira, or null. */
export function featureOf(config, labels) {
  for (const l of labels || []) {
    const f = (config.features ?? []).find(x => x.label.toLowerCase() === String(l).toLowerCase())
    if (f) return f.label
  }
  return null
}

export const hasFeatureLabel = (config, labels) => featureOf(config, labels) !== null

export const stepsSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.stepsHeading) ||
  hasHeading(v, description, v.userStoryHeading) ||
  v.userStoryLine.some(r => r.test(description))

/** An Environment heading with something under it (or on its label line), or an env: line. */
export const envSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.environmentHeading) && (
    /\benv\b\s*[:=]/i.test(description) ||
    new RegExp(`^[^\\S\\n]*(?:#{1,6}|h[1-6]\\.|\\*\\*)?[^\\S\\n]*(?:${v.environmentHeading})\\b[^\\n]*\\n(?:[^\\S\\n]*\\n)*[^\\S\\n]*[^#\\s]`, 'im').test(description) ||
    new RegExp(`^[^\\S\\n]*(?:${v.environmentHeading})[^\\S\\n]*\\**[^\\S\\n]*:[^\\S\\n]*\\S`, 'im').test(description))
