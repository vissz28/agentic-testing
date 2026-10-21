import en from './en.mjs'
import it from './it.mjs'
import { alt } from '../text.mjs'

const PACKS = { en, it }
const merge = (langs, k) => langs.flatMap(l => PACKS[l][k])

export function buildVocabulary(langs) {
  for (const l of langs) if (!PACKS[l]) throw new Error(`language "${l}" is not supported`)
  const m = k => alt(merge(langs, k))
  return {
    gherkinStep: new RegExp(`^\\s*(?:${m('steps')})\\b`, 'im'),
    gherkinStepAll: new RegExp(`^\\s*(?:${m('steps')})\\b`, 'gim'),
    thenLine: new RegExp(`^\\s*(?:${m('then')})\\b`, 'im'),
    thenLineCapture: new RegExp(`^\\s*(?:${m('then')})\\b(.*)$`, 'im'),
    thenAndLines: new RegExp(`^\\s*(?:${alt([...merge(langs, 'then'), 'and'])})\\b.*`, 'gim'),
    acHeading: new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:\\*\\*\\s*)?(?:${m('acHeading')})\\b\\s*:?\\s*(?:\\*\\*)?\\s*:?\\s*$`, 'i'),
    listItem: /^\s*(?:[-*•]|\d+[.)])\s+/,
    thenStep: new RegExp(`^\\s*(?:${m('then')})\\b\\s*(.*)$`, 'i'),
    setupStep: new RegExp(`^\\s*(?:${m('setup')})\\b`, 'i'),
    continuation: new RegExp(`^\\s*(?:${m('continuation')})\\b\\s*(.*)$`, 'i'),
    sectionEnd: new RegExp(`^\\s*(?:#{1,6}\\s|\\*\\*[^*]+\\*\\*\\s*:?\\s*$|[^\\s:][^:]{0,40}:\\s*$|(?:${m('sectionNames')})\\s*$)`, 'i'),
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
    listOrStep: new RegExp(`^(?:[-*•]\\s|\\d+[.)]\\s|(?:${alt(['scenario', ...merge(langs, 'steps'), ...merge(langs, 'continuation')])})\\b)`, 'i'),
  }
}
