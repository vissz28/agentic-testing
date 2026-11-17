import en from './en.mjs'
import it from './it.mjs'
import { alt } from '../text.mjs'

const PACKS = { en, it }
const merge = (langs, k) => langs.flatMap(l => PACKS[l][k])

/** Regex sources for one pack key, unknown languages skipped. */
export const packWords = (langs, k) => merge(langs.filter(l => PACKS[l]), k)

export function buildVocabulary(langs) {
  for (const l of langs) if (!PACKS[l]) throw new Error(`language "${l}" is not supported`)
  const m = k => alt(merge(langs, k))
  // S never crosses a newline: with the m flag \s* runs over blank lines and goes quadratic on long tickets.
  // W instead of \b so the Italian "e" doesn't match "e.g." or "E-mail".
  const S = '[^\\S\\n]*'
  const W = '(?=[\\s:,]|$)'
  return {
    gherkinStep: new RegExp(`^${S}(?:${m('steps')})${W}`, 'im'),
    gherkinStepAll: new RegExp(`^${S}(?:${m('steps')})${W}`, 'gim'),
    // Outcome word inside a one-line Given/When/Then.
    thenWord: new RegExp(`\\b(?:${m('then')})\\b`, 'ig'),
    thenLine: new RegExp(`^${S}(?:${m('then')})${W}`, 'im'),
    thenLineCapture: new RegExp(`^${S}(?:${m('then')})${W}(.*)$`, 'im'),
    // Then and its continuations: where vagueness counts.
    thenAndLines: new RegExp(`^${S}(?:${alt([...merge(langs, 'then'), ...merge(langs, 'continuation')])})${W}.*`, 'gim'),
    // A heading may carry symbols and a note ("## ✅ Acceptance criteria (AC)"); a plain line can't.
    acHeading: new RegExp(`^${S}(?:(?:#{1,6}|h[1-6]\\.)${S}[^\\p{L}\\p{N}\\s*]*${S}(?:\\*\\*${S})?(?:${m('acHeading')})\\b${S}(?:\\*\\*)?${S}(?:[:(/|\\u2013\\u2014-].*)?|(?:\\*\\*${S})?(?:${m('acHeading')})\\b${S}:?${S}(?:\\*\\*)?${S}:?${S})$`, 'iu'),
    listItem: /^\s*(?:[-*•]|\d+[.)])\s+/,
    thenStep: new RegExp(`^${S}(?:${m('then')})${W}\\s*(.*)$`, 'i'),
    setupStep: new RegExp(`^${S}(?:${m('setup')})${W}`, 'i'),
    continuation: new RegExp(`^${S}(?:${m('continuation')})${W}\\s*(.*)$`, 'i'),
    // A label line ends the section only if it names one: "These columns:" is a criterion.
    sectionEnd: new RegExp(`^${S}(?:#{1,6}\\s|h[1-6]\\.\\s|\\*\\*[^*]+\\*\\*${S}:?${S}$|(?:${m('sectionNames')})${S}:?${S}$)`, 'i'),
    vague: new RegExp(`\\b(${m('vague')})\\b`, 'i'),
    stepsHeading: m('stepsHeading'),
    userStoryHeading: m('userStoryHeading'),
    userStoryLine: merge(langs, 'userStoryLine').map(s => new RegExp(s, 'i')),
    expectedHeading: m('expectedHeading'),
    actualHeading: m('actualHeading'),
    environmentHeading: m('environmentHeading'),
    contextHeadingFE: m('contextHeadingFE'),
    contextHeadingBE: m('contextHeadingBE'),
    expectedPhrase: new RegExp(m('expectedPhrase'), 'i'),
    actualPhrase: new RegExp(m('actualPhrase'), 'i'),
    contextPhrase: new RegExp(m('contextPhrase'), 'i'),
    expectedQuestion: new RegExp(`(?:${m('expectedQuestion')})\\s*[:*]?\\s*(.*)$`, 'gim'),
    expectedSection: new RegExp(`^(?:#{1,6}\\s*|\\*\\*\\s*)(?:${m('expectedSection')})\\b[^\\n]*$`, 'gim'),
    insteadOf: new RegExp(`(?:${m('insteadOf')})\\s+([+\\u2212-]?\\d+(?:[.,]\\d+)?)`, 'gi'),
    // The bug's wrong result: Actual section, or the number before "instead of".
    actualSection: new RegExp(`^(?:#{1,6}\\s*|\\*\\*\\s*)(?:${m('actualHeading')})\\b[^\\n]*$`, 'gim'),
    beforeInsteadOf: new RegExp(`([+\\u2212-]?\\d+(?:[.,]\\d+)?)\\s+(?:${m('insteadOf')})\\b`, 'gi'),
    negatedWord: new RegExp(`\\b(?:${alt(['not', 'non', ...merge(langs, 'insteadOf')])})\\s+[\\w.-]+`, 'gi'),
    listOrStep: new RegExp(`^(?:[-*•]\\s|\\d+[.)]\\s|(?:${alt(['scenario', ...merge(langs, 'steps'), ...merge(langs, 'continuation')])})${W})`, 'i'),
    // "Delete is disabled" names a control, not an action step.
    observable: new RegExp(`\\b(?:${m('observable')})\\b`, 'i'),
    actionStep: new RegExp(`^(?:please\\s+)?(?:${m('action')})\\b(?!\\s+(?:is|are|was|were|button|link|icon|menu|field|shows?|displays?|has|have|stays|remains|becomes|should|must|will|can|does|do|sono|resta|rimane|deve|pulsante|bottone)\\b)`, 'i'),
    environmentMention: new RegExp(alt(merge(langs, 'environmentMention')), 'i'),
    // A list under one of these isn't criteria.
    namedSection: new RegExp(`^(?:${alt([...merge(langs, 'sectionNames'), ...merge(langs, 'stepsHeading'), ...merge(langs, 'userStoryHeading'), ...merge(langs, 'expectedHeading'), ...merge(langs, 'actualHeading'), ...merge(langs, 'environmentHeading'), ...merge(langs, 'contextHeadingFE'), ...merge(langs, 'contextHeadingBE')])})\\b`, 'i'),
    // Fill-in headings use the first language so its vocabulary reads them back.
    headings: PACKS[langs[0]].headings,
  }
}
