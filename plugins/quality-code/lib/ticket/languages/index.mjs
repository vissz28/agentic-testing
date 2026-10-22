import en from './en.mjs'
import it from './it.mjs'
import { alt } from '../text.mjs'

const PACKS = { en, it }
const merge = (langs, k) => langs.flatMap(l => PACKS[l][k])

/** One pack entry for the given languages, as regex sources (field-name lookups). */
export const packWords = (langs, k) => merge(langs.filter(l => PACKS[l]), k)

export function buildVocabulary(langs) {
  for (const l of langs) if (!PACKS[l]) throw new Error(`language "${l}" is not supported`)
  const m = k => alt(merge(langs, k))
  // Line-anchored patterns use S (spaces, never a line break): with the m flag, \s* would run over
  // blank lines and make a long ticket quadratic. A step word ends at a space, ":" or ",", never at
  // a "\b": the Italian "e" must not read "e.g." or "E-mail" as a step.
  const S = '[^\\S\\n]*'
  const W = '(?=[\\s:,]|$)'
  return {
    gherkinStep: new RegExp(`^${S}(?:${m('steps')})${W}`, 'im'),
    gherkinStepAll: new RegExp(`^${S}(?:${m('steps')})${W}`, 'gim'),
    thenLine: new RegExp(`^${S}(?:${m('then')})${W}`, 'im'),
    thenLineCapture: new RegExp(`^${S}(?:${m('then')})${W}(.*)$`, 'im'),
    // The lines whose vagueness counts: Then and every continuation (and, but, e, ma).
    thenAndLines: new RegExp(`^${S}(?:${alt([...merge(langs, 'then'), ...merge(langs, 'continuation')])})${W}.*`, 'gim'),
    // A heading line (#, or Jira's h2.) may carry symbols before the words and a note after them
    // ("## ✅ Acceptance criteria (AC)"); a plain line must be the words alone.
    acHeading: new RegExp(`^${S}(?:(?:#{1,6}|h[1-6]\\.)${S}[^\\p{L}\\p{N}\\s*]*${S}(?:\\*\\*${S})?(?:${m('acHeading')})\\b${S}(?:\\*\\*)?${S}(?:[:(/|\\u2013\\u2014-].*)?|(?:\\*\\*${S})?(?:${m('acHeading')})\\b${S}:?${S}(?:\\*\\*)?${S}:?${S})$`, 'iu'),
    listItem: /^\s*(?:[-*•]|\d+[.)])\s+/,
    thenStep: new RegExp(`^${S}(?:${m('then')})${W}\\s*(.*)$`, 'i'),
    setupStep: new RegExp(`^${S}(?:${m('setup')})${W}`, 'i'),
    continuation: new RegExp(`^${S}(?:${m('continuation')})${W}\\s*(.*)$`, 'i'),
    // A label line ends the section only when it names a section: "These columns:" is a criterion.
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
    // The wrong result a bug reports: its Actual section, and the number before "instead of".
    actualSection: new RegExp(`^(?:#{1,6}\\s*|\\*\\*\\s*)(?:${m('actualHeading')})\\b[^\\n]*$`, 'gim'),
    beforeInsteadOf: new RegExp(`([+\\u2212-]?\\d+(?:[.,]\\d+)?)\\s+(?:${m('insteadOf')})\\b`, 'gi'),
    negatedWord: new RegExp(`\\b(?:${alt(['not', 'non', ...merge(langs, 'insteadOf')])})\\s+[\\w.-]+`, 'gi'),
    listOrStep: new RegExp(`^(?:[-*•]\\s|\\d+[.)]\\s|(?:${alt(['scenario', ...merge(langs, 'steps'), ...merge(langs, 'continuation')])})${W})`, 'i'),
    // Content signals, read without a heading (AGT-120). An action word followed by "is", "button"
    // and the like names a control ("Delete is disabled"), not a step.
    observable: new RegExp(`\\b(?:${m('observable')})\\b`, 'i'),
    actionStep: new RegExp(`^(?:please\\s+)?(?:${m('action')})\\b(?!\\s+(?:is|are|was|were|button|link|icon|menu|field|shows?|displays?|has|have|stays|remains|becomes|should|must|will|can|does|do|sono|resta|rimane|deve|pulsante|bottone)\\b)`, 'i'),
    environmentMention: new RegExp(alt(merge(langs, 'environmentMention')), 'i'),
    // The sections a list must not belong to, to be read as criteria: steps, expected, notes...
    namedSection: new RegExp(`^(?:${alt([...merge(langs, 'sectionNames'), ...merge(langs, 'stepsHeading'), ...merge(langs, 'userStoryHeading'), ...merge(langs, 'expectedHeading'), ...merge(langs, 'actualHeading'), ...merge(langs, 'environmentHeading'), ...merge(langs, 'contextHeadingFE'), ...merge(langs, 'contextHeadingBE')])})\\b`, 'i'),
    // The headings a fill-in writes: the first configured language, so its own vocabulary reads them.
    headings: PACKS[langs[0]].headings,
  }
}
