import { extractListCriteria, extractNaturalAC, hasActionSteps, hasGherkin, hasNaturalAC, hasThen, hasVaguePhrase, stepText } from '../criteria.mjs'
import { stripComments } from '../text.mjs'

/**
 * The acceptance-criteria signals, identical for both stacks. Vagueness is judged only on the
 * Then/And lines and the AC items: a vague word elsewhere does not make the criteria untestable.
 */
export function acSignals(v, description, acField) {
  const acText = [acField, description].filter(Boolean).join('\n')
  const gherkin = hasGherkin(v, acField) || hasGherkin(v, description)
  const naturalItems = [...extractNaturalAC(v, acField, { headingless: true }), ...extractNaturalAC(v, description)]
  // No criteria field, heading or Gherkin: a list of checks without a heading is the criteria.
  if (!gherkin && !naturalItems.length) naturalItems.push(...extractListCriteria(v, description))
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
export const omittedKeys = config => new Set([...((config.features ?? []).length ? [] : ['feature_label']), ...(config.gate?.omit ?? [])])

/** A paragraph before the first heading or list: what the story is for, though it has no "Context" heading. */
export function introSignal(description) {
  const text = stripComments(String(description ?? '')).trim()
  const first = text.split(/\n[^\S\n]*(?=#{1,6}\s|h[1-6]\.\s|\*\*[^*]+\*\*[^\S\n]*:?[^\S\n]*(?:\n|$)|[-*•]\s|\d+[.)]\s)/)[0]
  return first.length >= 80 && first.split(/\s+/).length >= 12
}

/** The configured feature label the ticket carries, whatever its case in Jira, or null. */
export function featureOf(config, labels) {
  for (const l of labels || []) {
    const f = (config.features ?? []).find(x => x.label.toLowerCase() === String(l).toLowerCase())
    if (f) return f.label
  }
  return null
}

export const hasFeatureLabel = (config, labels) => featureOf(config, labels) !== null

/** A Steps or User story heading, a user-story line, or numbered action steps without a heading. */
export const stepsSignal = (v, hasHeading, description) =>
  hasHeading(v, description, v.stepsHeading) ||
  hasHeading(v, description, v.userStoryHeading) ||
  v.userStoryLine.some(r => r.test(description)) ||
  hasActionSteps(v, description)

/**
 * An Environment heading with something under it (or on its label line), an "Env:" line, or an
 * environment named in the text ("on staging", "in production", "Chrome 120").
 */
export const envSignal = (v, hasHeading, description) =>
  // The template's comment hints ("<!-- staging or production -->") name no environment.
  /^[^\S\n]*(?:[-*][^\S\n]+)?\**env\**[^\S\n]*[:=][^\S\n]*\S/im.test(stripComments(description)) ||
  v.environmentMention.test(stripComments(description)) ||
  (hasHeading(v, description, v.environmentHeading) && (
    /\benv\b\s*[:=]/i.test(description) ||
    new RegExp(`^[^\\S\\n]*(?:#{1,6}|h[1-6]\\.|\\*\\*)?[^\\S\\n]*(?:${v.environmentHeading})\\b[^\\n]*\\n(?:[^\\S\\n]*\\n)*[^\\S\\n]*[^#\\s]`, 'im').test(description) ||
    new RegExp(`^[^\\S\\n]*(?:${v.environmentHeading})[^\\S\\n]*\\**[^\\S\\n]*:[^\\S\\n]*\\S`, 'im').test(description)))

/** A list of checks without a heading, however short: content enough that the ticket is not legacy. */
export const hasListChecks = (v, description) => extractListCriteria(v, description).length > 0

/**
 * At least one file (a screenshot, a video, a document) is on the ticket. Once files were read
 * (`attach`), a file counts only when one gave text, or a file was added after the read: an empty
 * or unrelated image no longer earns the points. Files never read count as before.
 */
export function attachmentsSignal(ticket) {
  const n = Number(ticket.attachments)
  if (!(n >= 1)) return false
  const read = Number(ticket.attachmentsRead)
  return !(read >= 1) || Number(ticket.attachmentsWithText) >= 1 || n > read
}

/** A linked issue or a web link is on the ticket, or the fill-in added a ## Links line with a URL. */
export const linksSignal = ticket =>
  (Array.isArray(ticket.links) && ticket.links.length > 0) ||
  /^#{1,6}[ \t]*Links[ \t]*\n+[ \t]*(?:[-*][ \t]+)?https?:\/\/\S+/im.test(ticket.text?.description || '')
