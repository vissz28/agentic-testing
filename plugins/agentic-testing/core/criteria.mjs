import { normalise } from './text.mjs'

// Every function takes the vocabulary `v` first, so the language is never global.
// v.gherkinStepAll / v.thenAndLines / v.expectedQuestion / v.expectedSection / v.insteadOf carry
// the `g` flag: use them only with match / matchAll (never test / exec), so lastIndex never leaks.

/** Plain-language criteria need this many characters in total to count. Gherkin is exempt. */
export const MIN_NATURAL_AC = 150

/** Literal Gherkin: line-anchored step words with a Then present and at least two steps. */
export function hasGherkin(v, text) {
  text = normalise(text)
  if (!text) return false
  const steps = (text.match(v.gherkinStepAll) || []).length
  const hasThenLine = v.thenLine.test(text)
  return hasThenLine && steps >= 2
}

export function hasThen(v, text) {
  text = normalise(text)
  return !!text && v.thenLine.test(text)
}

export function hasVaguePhrase(v, text) {
  text = normalise(text)
  return !!text && v.vague.test(text)
}

/** A markdown heading (`## X`), a bold line (`**X**`), or a label line (`X:`) matching `wordsSrc`. */
export function hasHeading(v, text, wordsSrc) {
  text = normalise(text)
  if (!text) return false
  return (
    new RegExp(`^\\s*(?:#{1,6}\\s*|\\*\\*\\s*)(?:${wordsSrc})`, 'im').test(text) ||
    new RegExp(`^\\s*(?:${wordsSrc})\\s*\\**\\s*:`, 'im').test(text)
  )
}

/**
 * The criteria under an Acceptance criteria heading, in either format: each prose sentence or
 * bullet, and each Gherkin Then (with its And lines), up to the next section. `headingless` reads
 * the whole text as the AC (the Jira AC field is the criteria by definition).
 */
export function extractNaturalAC(v, text, { headingless = false } = {}) {
  text = normalise(text)
  if (!text) return []
  const items = []
  let inSection = headingless
  let step = null // 'setup' | 'then' while inside a Gherkin block
  // HTML comments are authoring hints in the issue templates, never criteria.
  const visible = text.replace(/<!--[\s\S]*?-->/g, '')
  for (const line of visible.split('\n')) {
    if (v.acHeading.test(line)) {
      inSection = true
      continue
    }
    if (!inSection || !line.trim()) continue
    if (!headingless && v.sectionEnd.test(line)) {
      inSection = false
      continue
    }
    const content = line.replace(v.listItem, '').replace(/\*+/g, '').trim()
    const then = content.match(v.thenStep)
    const cont = step && content.match(v.continuation)
    if (then || (cont && step === 'then')) {
      step = 'then'
      if ((then ?? cont)[1].trim()) items.push((then ?? cont)[1].trim())
      continue
    }
    if (cont || v.setupStep.test(content)) {
      step = 'setup'
      continue
    }
    step = null
    for (const sentence of content.split(/(?<=[.!?])\s+/)) if (sentence.trim()) items.push(sentence.trim())
  }
  return items
}

/**
 * Drop the vague criteria so a concrete answer can replace them: every vague line inside an
 * Acceptance criteria section, and vague Then / And lines anywhere. Vague prose outside the AC
 * section is left alone.
 */
export function stripVagueCriteria(v, text, { headingless = false } = {}) {
  text = normalise(text)
  if (!text) return text
  let inSection = headingless
  const kept = []
  for (const line of text.split('\n')) {
    if (v.acHeading.test(line)) inSection = true
    else if (inSection && !headingless && line.trim() && v.sectionEnd.test(line)) inSection = false
    const content = line.replace(v.listItem, '').trim()
    const isStep = v.thenStep.test(content) || v.continuation.test(content)
    if (hasVaguePhrase(v, line) && (inSection || isStep)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/** Length of the plain-language criteria text, as the scorer reads it (bullets stripped). */
export function naturalLength(items) {
  return (items || []).join(' ').length
}

/** Natural-language AC counts only when there is enough of it to test against. */
export function hasNaturalAC(items) {
  return naturalLength(items) >= MIN_NATURAL_AC
}

/**
 * Does this scenario carry an expected result concrete enough to assert on? Accepts a raw
 * Gherkin string, {gherkin}, {then} or {expected}.
 */
export function hasConcreteThen(v, scenario) {
  const src =
    typeof scenario === 'string'
      ? scenario
      : (scenario?.then ?? scenario?.expected ?? scenario?.gherkin ?? '')
  const text = normalise(src)
  const thenLine = (text.match(v.thenLineCapture) || [])[1]
  // A `then` / `expected` field IS the expected result already. A whole scenario has to state
  // its Then out loud.
  const isExpectedField =
    typeof scenario === 'object' && scenario !== null && (scenario.then != null || scenario.expected != null)
  if (thenLine == null && !isExpectedField) return false
  const then = String(thenLine ?? text).trim()
  // 12 chars rejects stubs like "Then ok" without needing to parse the sentence.
  return then.length >= 12 && !hasVaguePhrase(v, then)
}

/** How many of the scenarios carry an assertable expected result. */
export function countDerivable(v, scenarios = []) {
  return (scenarios || []).filter(s => hasConcreteThen(v, s)).length
}

/** Then lines, Expected sections, "expected behaviour?" answers, "instead of N", natural AC. */
export function extractExpectedChunks(v, text) {
  text = normalise(text)
  if (!text) return []
  const chunks = []
  for (const m of text.matchAll(new RegExp(v.thenLineCapture.source, 'gim'))) chunks.push(m[1].trim())

  for (const m of text.matchAll(v.expectedQuestion)) chunks.push(m[1].replace(/\*+/g, '').trim())

  for (const m of text.matchAll(v.expectedSection)) {
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/\n\s*(?:#{1,6}\s*|\*\*)/)
    chunks.push(rest.slice(0, next < 0 ? rest.length : next).trim())
  }

  for (const m of text.matchAll(v.insteadOf)) chunks.push(m[1])

  chunks.push(...extractNaturalAC(v, text))

  // A Then under the AC heading is read twice (as a Then and as natural AC): count it once.
  return [...new Set(chunks.filter(Boolean))]
}

export function countDerivableFromText(v, text) {
  return extractExpectedChunks(v, text).filter(c => c.length >= 12 && !hasVaguePhrase(v, c)).length
}
