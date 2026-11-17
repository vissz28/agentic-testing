import { extractListCriteria, extractNaturalAC, hasActionSteps, hasGherkin, hasNaturalAC, hasThen, hasVaguePhrase, stepText } from '../criteria.mjs'
import { stripComments } from '../text.mjs'

/** Same for both stacks. Vagueness only counts on Then/And lines and AC items. */
export function acSignals(v, description, acField) {
  const acText = [acField, description].filter(Boolean).join('\n')
  const gherkin = hasGherkin(v, acField) || hasGherkin(v, description)
  const naturalItems = [...extractNaturalAC(v, acField, { headingless: true }), ...extractNaturalAC(v, description)]
  // No field, heading or Gherkin: fall back to a headingless list of checks.
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

// Keys this config can never credit (no features -> no feature label).
export const omittedKeys = config => new Set([...((config.features ?? []).length ? [] : ['feature_label']), ...(config.gate?.omit ?? [])])

/** An opening paragraph before any heading or list counts as context. */
export function introSignal(description) {
  const text = stripComments(String(description ?? '')).trim()
  const first = text.split(/\n[^\S\n]*(?=#{1,6}\s|h[1-6]\.\s|\*\*[^*]+\*\*[^\S\n]*:?[^\S\n]*(?:\n|$)|[-*•]\s|\d+[.)]\s)/)[0]
  return first.length >= 80 && first.split(/\s+/).length >= 12
}

/** Case-insensitive; returns the configured spelling. */
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
  v.userStoryLine.some(r => r.test(description)) ||
  hasActionSteps(v, description)

/** An Env: line, an environment named in the text, or a non-empty Environment heading. */
export const envSignal = (v, hasHeading, description) =>
  // Strip template hints like "<!-- staging or production -->".
  /^[^\S\n]*(?:[-*][^\S\n]+)?\**env\**[^\S\n]*[:=][^\S\n]*\S/im.test(stripComments(description)) ||
  v.environmentMention.test(stripComments(description)) ||
  (hasHeading(v, description, v.environmentHeading) && (
    /\benv\b\s*[:=]/i.test(description) ||
    new RegExp(`^[^\\S\\n]*(?:#{1,6}|h[1-6]\\.|\\*\\*)?[^\\S\\n]*(?:${v.environmentHeading})\\b[^\\n]*\\n(?:[^\\S\\n]*\\n)*[^\\S\\n]*[^#\\s]`, 'im').test(description) ||
    new RegExp(`^[^\\S\\n]*(?:${v.environmentHeading})[^\\S\\n]*\\**[^\\S\\n]*:[^\\S\\n]*\\S`, 'im').test(description)))

// Any headingless checks list, however short, means the ticket isn't legacy.
export const hasListChecks = (v, description) => extractListCriteria(v, description).length > 0

/**
 * Once files were read, they count only if one gave text or a new file was added since,
 * so an empty or unrelated image earns nothing. Unread files always count.
 */
export function attachmentsSignal(ticket) {
  const n = Number(ticket.attachments)
  if (!(n >= 1)) return false
  const read = Number(ticket.attachmentsRead)
  return !(read >= 1) || Number(ticket.attachmentsWithText) >= 1 || n > read
}

// Also accepts the ## Links section a fill-in writes.
export const linksSignal = ticket =>
  (Array.isArray(ticket.links) && ticket.links.length > 0) ||
  /^#{1,6}[ \t]*Links[ \t]*\n+[ \t]*(?:[-*][ \t]+)?https?:\/\/\S+/im.test(ticket.text?.description || '')
