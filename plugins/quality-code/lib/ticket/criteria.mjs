import { normalise, stripComments } from './text.mjs'

// Every function takes the vocabulary `v` first, so the language is never global.
// v.gherkinStepAll / v.thenAndLines / v.expectedQuestion / v.expectedSection / v.insteadOf carry
// the `g` flag: use them only with match / matchAll (never test / exec), so lastIndex never leaks.

/** Plain-language criteria need this many characters in total to count. Gherkin is exempt. */
export const MIN_NATURAL_AC = 150

/**
 * Each line as the step patterns read it: no list marker, no bold. Jira's markdown writes a bold
 * keyword as **Given** and a bulleted step as - Given, as the criteria section rows already do.
 */
export const stepText = (v, text) => text.split('\n').map(l => l.replace(v.listItem, '').replace(/\*+/g, '')).join('\n')

/** Literal Gherkin: line-anchored step words with a Then present and at least two steps. */
export function hasGherkin(v, text) {
  text = stepText(v, stripComments(normalise(text)))
  if (!text) return false
  const steps = (text.match(v.gherkinStepAll) || []).length
  const hasThenLine = v.thenLine.test(text)
  return hasThenLine && steps >= 2
}

export function hasThen(v, text) {
  text = stepText(v, stripComments(normalise(text)))
  return !!text && v.thenLine.test(text)
}

export function hasVaguePhrase(v, text) {
  text = normalise(text)
  return !!text && v.vague.test(text)
}

/**
 * A markdown heading (`## X`, Jira's `h2. X`), a bold line (`**X**`), or a label line (`X:`)
 * matching `wordsSrc` as whole words: "## Contextual menu" is no Context heading.
 */
export function hasHeading(v, text, wordsSrc) {
  text = normalise(text)
  if (!text) return false
  const S = '[^\\S\\n]*'
  return (
    new RegExp(`^${S}(?:#{1,6}${S}|h[1-6]\\.${S}|\\*\\*${S})(?:${wordsSrc})\\b`, 'im').test(text) ||
    new RegExp(`^${S}(?:${wordsSrc})${S}\\**${S}:`, 'im').test(text)
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
  const rows = sectionRows(v, stripComments(text), headingless)
  const gherkinRuns = realGherkinRuns(v, rows)
  let step = null // 'setup' | 'then' while inside a Gherkin block
  for (const { content, run } of rows) {
    const then = content.match(v.thenStep)
    const cont = step && content.match(v.continuation)
    if (then || (cont && step === 'then')) {
      step = 'then'
      if ((then ?? cont)[1].trim()) items.push((then ?? cont)[1].trim())
      continue
    }
    // A Given / When / And line outside real Gherkin that states a result ("When a user enters
    // X, the field shows Y") is a plain sentence: it is read as prose below. A bare step stays setup.
    const plainStepWord = !gherkinRuns.has(run) && statesResult(v, content)
    if ((cont || v.setupStep.test(content)) && !plainStepWord) {
      step = 'setup'
      continue
    }
    // After a result sentence, a bare And is still a step: it must state its own result.
    step = plainStepWord ? 'setup' : null
    for (const sentence of content.split(/(?<=[.!?])\s+/)) if (sentence.trim()) items.push(sentence.trim())
  }
  return items
}

/**
 * A Given / When / And line that reads as a sentence with a result: after the step word, a comma
 * and a space followed by more text ("When X, Y", "Quando X, Y"). A comma inside a number
 * ("2,5", "1,000") is not a result.
 */
function statesResult(v, content) {
  const rest = v.gherkinStep.test(content) ? content.replace(v.gherkinStep, '') : content.match(v.continuation)?.[1]
  return rest != null && /,\s+\S/.test(rest)
}

const TABLE_ROW = /^\s*\|/
const DOC_FENCE = /^\s*(?:\"\"\"|```)/

/**
 * The non-blank lines inside the criteria section, bullets and bold stripped. Each carries a run
 * number: a run is a block of consecutive step-like lines (step words, continuations, Scenario
 * and the other headers), broken by a prose line, by a header line, and by the section's edges.
 * Data-table rows and doc strings (the fences and the lines between them) belong to the run of
 * the step they follow; they break nothing and are not part of the run's Gherkin check.
 */
function sectionRows(v, visible, headingless) {
  const rows = []
  let inSection = headingless
  let run = 0
  let inDoc = false
  for (const line of visible.split('\n')) {
    if (v.acHeading.test(line)) {
      inSection = true
      inDoc = false
      run++
      continue
    }
    if (!inSection || !line.trim()) continue
    if (!headingless && v.sectionEnd.test(line)) {
      inSection = false
      inDoc = false
      run++
      continue
    }
    const content = line.replace(v.listItem, '').replace(/\*+/g, '').trim()
    if (inDoc || DOC_FENCE.test(line) || TABLE_ROW.test(line)) {
      if (DOC_FENCE.test(line)) inDoc = !inDoc
      rows.push({ content, run, attached: true })
      continue
    }
    const stepLike = v.thenStep.test(content) || v.setupStep.test(content) || v.continuation.test(content)
    const header = stepLike && !v.gherkinStep.test(content) && !v.continuation.test(content)
    if (!stepLike || header) run++
    rows.push({ content, run, header })
    if (!stepLike) run++
  }
  return rows
}

/** The runs that are real Gherkin: a Scenario-style header, or the hasGherkin rule on the run. */
function realGherkinRuns(v, rows) {
  const runs = new Map()
  for (const r of rows) if (!r.attached) runs.set(r.run, [...(runs.get(r.run) ?? []), r])
  const real = new Set()
  for (const [run, list] of runs) {
    if (list[0].header || hasGherkin(v, list.map(r => r.content).join('\n'))) real.add(run)
  }
  return real
}

/**
 * Drop the vague criteria so a concrete answer can replace them: every vague line inside an
 * Acceptance criteria section, and vague Then / And lines anywhere. Vague prose outside the AC
 * section is left alone.
 */
export function stripVagueCriteria(v, text, { headingless = false } = {}) {
  if (text == null || text === '') return ''
  let inSection = headingless
  const kept = []
  // The result is written back into the ticket, so each kept line keeps its own line end: read a
  // line without its CR, keep it with it.
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (v.acHeading.test(line)) inSection = true
    else if (inSection && !headingless && line.trim() && v.sectionEnd.test(line)) inSection = false
    const content = line.replace(v.listItem, '').trim()
    const isStep = v.thenStep.test(content) || v.continuation.test(content)
    if (hasVaguePhrase(v, line) && (inSection || isStep)) continue
    kept.push(raw)
  }
  return kept.join('\n')
}

const NUMBERED = /^\s*\d+[.)]\s+/
// A shown text in quotes: straight or curly double quotes, or guillemets. Single quotes are
// apostrophes too often ("doesn't … it's").
const QUOTED = /["“«][^"“”«»\n]+["”»]/
// What follows an action and states its result: "Click Save: the toast reads Saved".
const RESULT_AFTER_ACTION = /(?::|→|->|=>|\s[–—]\s)\s*(.+)$/

/**
 * The list blocks of a text, outside an Acceptance criteria section and outside a named section
 * (Steps to reproduce, Expected, Environment, Notes...): each a run of list items, blank lines
 * allowed between them, ended by any other line. A heading the vocabulary does not name
 * ("## Description", "**Checks**") leaves the list readable.
 */
function freeLists(v, text) {
  const blocks = []
  let section = null // 'ac' | 'named' | null
  let block = null
  const close = () => { if (block) blocks.push(block); block = null }
  for (const line of stripComments(normalise(text)).split('\n')) {
    if (v.acHeading.test(line)) { close(); section = 'ac'; continue }
    if (v.sectionEnd.test(line)) {
      close()
      const words = line.replace(/^\s*(?:#{1,6}|h[1-6]\.)?\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
      section = v.namedSection.test(words) ? 'named' : null
      continue
    }
    if (!line.trim()) continue
    if (!v.listItem.test(line)) { close(); continue }
    if (section) continue
    const content = line.replace(v.listItem, '').replace(/\*+/g, '').trim()
    if (!content) continue
    block ??= { items: [], numbered: [] }
    block.items.push(content)
    block.numbered.push(NUMBERED.test(line))
  }
  close()
  return blocks
}

/**
 * Does this list item name a result a test can see: a state, a shown text, a count, a value? An
 * item that starts with an action ("Open the list") is a step; it only names a result after a
 * ":" or an arrow ("Click Save: the toast reads Saved").
 */
export function namesObservable(v, item) {
  const result = v.actionStep.test(item) ? item.match(RESULT_AFTER_ACTION)?.[1] : item
  return !!result && (v.observable.test(result) || /\d/.test(result) || QUOTED.test(result))
}

/**
 * The criteria read from a list that has no Acceptance criteria heading (AGT-120): two or more
 * items, every one a check (it names an observable, or it is vague, which then makes the
 * criteria untestable), at least one naming an observable. A list of actions is not criteria.
 */
export function extractListCriteria(v, text) {
  const items = []
  for (const b of freeLists(v, text)) {
    if (b.items.length < 2) continue
    const checks = b.items.filter(i => namesObservable(v, i))
    if (checks.length && b.items.every(i => checks.includes(i) || hasVaguePhrase(v, i))) items.push(...b.items)
  }
  return items
}

/**
 * Numbered action steps without a heading (AGT-120): a numbered list of two or more items that
 * starts with an action ("1. Open the list 2. Click Filter") and has at least two of them.
 */
export function hasActionSteps(v, text) {
  return freeLists(v, text).some(b => {
    const numbered = b.items.filter((_, i) => b.numbered[i])
    return numbered.length >= 2 && v.actionStep.test(numbered[0]) && numbered.filter(i => v.actionStep.test(i)).length >= 2
  })
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
  text = stripComments(normalise(text))
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
