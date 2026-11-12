// Is a ticket's story too long, unstructured or too thin? The script decides; the command only shows the offer.
import { join } from 'node:path'
import { normalise, stripComments } from './text.mjs'
import { isTicketKey } from '../core/text.mjs'

// Every threshold of the check, in one place.
export const STORY_LIMITS = {
  maxWords: 400,         // above this the description is too long to read at a glance
  maxProseParagraphs: 6, // this many plain paragraphs with no heading at all is a wall of text
  minWords: 30,          // below this there is too little to write tests from
}

const HEADING = /^\s{0,3}(#{1,6}\s|\*\*[^*]+\*\*\s*:?\s*$|[A-Z][A-Za-z ]{2,30}:\s*$)/
const LIST = /^\s*([-*+]|\d+[.)])\s+/
const GOAL = /(^|\n)\s*(#{1,6}\s*|\*\*)?(goal|user story|obiettivo|storia utente)\b|\bas an?\s+[^,\n]{2,60},?\s+i\s+(want|need|would like)|\bcome\s+[^,\n]{2,60},?\s+(voglio|vorrei|devo)/i
const CRITERIA = /(^|\n)\s*(#{1,6}\s*|\*\*)?(acceptance criteria|criteri di accettazione|done when|fatto quando)\b|(^|\n)\s*(given|dato|dati|scenario)\b/i
const SHAPE = [
  ['Goal', /(^|\n)#{1,6}\s*goal\b/i],
  ['What', /(^|\n)#{1,6}\s*what\b/i],
  ['Acceptance criteria', /(^|\n)#{1,6}\s*acceptance criteria\b/i],
  ['Done when', /(^|\n)#{1,6}\s*done when\b/i],
]

const wordCount = t => (t.match(/\S+/g) ?? []).length

/** What the story looks like, and why (if at all) it should be rewritten. Pure: reads ticket.text only. */
export function checkStory(ticket, limits = STORY_LIMITS) {
  const acField = String(ticket?.text?.acField ?? '')
  const text = normalise(stripComments(`${ticket?.text?.description ?? ''}\n${acField}`)).trim()
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const prose = blocks.filter(b => b.split('\n').every(l => !HEADING.test(l) && !LIST.test(l)))
  const headings = text.split('\n').filter(l => HEADING.test(l)).length
  const words = wordCount(text)
  const hasGoal = GOAL.test(text)
  const hasCriteria = CRITERIA.test(text) || acField.trim().length > 0
  const reasons = []
  if (words < limits.minWords) reasons.push('too_thin')
  if (words > limits.maxWords || (prose.length > limits.maxProseParagraphs && headings === 0)) reasons.push('too_long')
  if (words >= limits.minWords) {
    if (!hasGoal && !hasCriteria) reasons.push('no_structure')
    else if (!hasCriteria) reasons.push('no_criteria')
  }
  return { flagged: reasons.length > 0, reasons, words, paragraphs: blocks.length, proseParagraphs: prose.length, headings, hasGoal, hasCriteria }
}

const WHY = {
  too_long: 'the description is long or a wall of text',
  too_thin: 'the description is very short',
  no_structure: 'it has no goal and no acceptance criteria',
  no_criteria: 'it has no acceptance criteria',
}
export const formatStoryCheck = c => (c.flagged
  ? `Story check: this story could be clearer (${c.reasons.map(r => WHY[r]).join('; ')}). ${c.words} words.`
  : `Story check: ok (${c.words} words).`)

/** Which of the project's story sections (Goal / What / Acceptance criteria / Done when) a draft has. */
export function storyShape(draft) {
  const t = normalise(draft)
  const have = SHAPE.filter(([, re]) => re.test(t)).map(([n]) => n)
  return { have, missing: SHAPE.map(([n]) => n).filter(n => !have.includes(n)) }
}

/** The ticket as it would be scored with the draft as its story: only the draft's own text counts. */
export const draftTicket = (ticket, draft) => ({ ...ticket, text: { ...ticket.text, description: draft, acField: '' }, scenarios: [] })

/** <ticketsDir>/<KEY>/story.md and the draft beside it, or null for a key that could leave its folder. */
export const storyPath = (ticketsRoot, key) => (isTicketKey(key) ? join(ticketsRoot, key, 'story.md') : null)
export const draftPath = (ticketsRoot, key) => (isTicketKey(key) ? join(ticketsRoot, key, 'story-draft.md') : null)
