import { normalise, stripComments } from './text.mjs'

// Every function takes the vocabulary `v` first so the language is never global.
// The g-flagged patterns (gherkinStepAll, thenAndLines, expected*, insteadOf) are for match/matchAll only: test/exec leak lastIndex.

/** Min total length for plain-language criteria. Gherkin is exempt. */
export const MIN_NATURAL_AC = 150

// An open question names no result, so it's never a criterion.
const QUESTION = /\?\s*$/

/** Strips list markers and bold (Jira writes **Given**, - Given) and drops filler steps. */
export const stepText = (v, text) => text.split('\n').map(l => l.replace(v.listItem, '').replace(/\*+/g, '')).filter(l => !isPlaceholder(l)).join('\n')

/** At least two line-anchored steps, one of them a Then. */
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

/** `## X`, `h2. X`, `**X**` or `X:` with X matching wordsSrc as whole words ("## Contextual" isn't Context). */
export function hasHeading(v, text, wordsSrc) {
  text = normalise(text)
  if (!text) return false
  const S = '[^\\S\\n]*'
  return (
    new RegExp(`^${S}(?:#{1,6}${S}|h[1-6]\\.${S}|\\*\\*${S})(?:${wordsSrc})\\b`, 'im').test(text) ||
    new RegExp(`^${S}(?:${wordsSrc})${S}\\**${S}:`, 'im').test(text)
  )
}

const PLACEHOLDER_WORDS = /^(?:tbd|tba|tbc|todo|to do|n\/?a|none|nothing|wip|x{3,8}|\?+|coming soon|same as above|to be (?:defined|decided|done|filled|added|determined|written|confirmed))$/i

/** Filler in place of criteria: lorem ipsum, TBD, N/A, xxx, a short run of one character. */
export function isPlaceholder(item) {
  const t = String(item ?? '').trim()
  const bare = t.replace(/^[\W_]+|[\W_]+$/g, '')
  if (!bare) return /^[-–—?.…_*\s]+$/.test(t) // dashes/dots are filler, a code fence isn't
  if (/\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b|\bnostrud exercitation\b|\bsed do eiusmod\b|\bullamco laboris\b/i.test(t)) return true
  if (PLACEHOLDER_WORDS.test(bare)) return true
  return bare.length <= 12 && /^(.)\1{2,}$/.test(bare.replace(/\s+/g, ''))
}

/**
 * Prose sentences, bullets and Gherkin Then/And lines under the AC heading.
 * `headingless` reads the whole text as AC (the Jira AC field).
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
    // Outside real Gherkin, "When X, Y" is a sentence with a result: read it as prose.
    const plainStepWord = !gherkinRuns.has(run) && statesResult(v, content)
    if ((cont || v.setupStep.test(content)) && !plainStepWord) {
      step = 'setup'
      continue
    }
    // A bare And after a result sentence is still a step and needs its own result.
    step = plainStepWord ? 'setup' : null
    if (isPlaceholder(content)) continue
    for (const sentence of content.split(/(?<=[.!?])\s+/)) if (sentence.trim()) items.push(sentence.trim())
  }
  // Keep filler and questions out of the length and count checks.
  return items.filter(i => !isPlaceholder(i) && !QUESTION.test(i))
}

// "When X, Y": a comma plus space after the step word. A comma inside a number ("2,5") doesn't count.
function statesResult(v, content) {
  const rest = v.gherkinStep.test(content) ? content.replace(v.gherkinStep, '') : content.match(v.continuation)?.[1]
  return rest != null && /,\s+\S/.test(rest)
}

const TABLE_ROW = /^\s*\|/
const DOC_FENCE = /^\s*(?:\"\"\"|```)/

/**
 * Non-blank AC lines, each tagged with a run: consecutive step-like lines, broken by prose, headers and section edges.
 * Table rows and doc strings attach to the preceding step's run and are left out of its Gherkin check.
 */
function sectionRows(v, visible, headingless) {
  const rows = []
  let inSection = headingless
  let acLevel = 0
  let run = 0
  let inDoc = false
  for (const line of visible.split('\n')) {
    if (v.acHeading.test(line)) {
      inSection = true
      acLevel = headingLevel(line)
      inDoc = false
      run++
      continue
    }
    if (!inSection || !line.trim()) continue
    if (!headingless && v.sectionEnd.test(line)) {
      if (!endsSection(v, line, acLevel)) { run++; continue } // sub-heading inside the AC
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

// `## X` -> 2, `h3. X` -> 3, anything else -> 0.
const headingLevel = line => {
  const m = line.match(/^\s*(?:(#{1,6})|h([1-6])\.)\s/)
  return m ? m[1]?.length ?? Number(m[2]) : 0
}

// Under `## AC`, a deeper heading or a bold line naming no known section is a sub-heading, not the end.
function endsSection(v, line, acLevel) {
  if (!acLevel) return true
  const level = headingLevel(line)
  if (level) return level <= acLevel
  return !/^\s*\*\*/.test(line) || v.namedSection.test(line.replace(/\*+/g, '').trim())
}

// A run is real Gherkin if it starts with a Scenario-style header or passes hasGherkin.
function realGherkinRuns(v, rows) {
  const runs = new Map()
  for (const r of rows) if (!r.attached) runs.set(r.run, [...(runs.get(r.run) ?? []), r])
  const real = new Set()
  for (const [run, list] of runs) {
    if (list[0].header || hasGherkin(v, list.map(r => r.content).join('\n'))) real.add(run)
  }
  return real
}

/** Drops vague lines inside the AC and vague Then/And lines anywhere, so a concrete answer can replace them. */
export function stripVagueCriteria(v, text, { headingless = false } = {}) {
  if (text == null || text === '') return ''
  let inSection = headingless
  let acLevel = 0
  const kept = []
  // Drop an AC heading left empty too, or the answer would add a second AC section.
  let head = null
  const dropEmpty = () => { if (head?.dropped && !head.content) kept.splice(head.at); head = null }
  // Written back to the ticket: match without the CR, keep the raw line with it.
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (v.acHeading.test(line)) { dropEmpty(); inSection = true; acLevel = headingLevel(line); head = { at: kept.length } }
    else if (inSection && !headingless && line.trim() && v.sectionEnd.test(line) && endsSection(v, line, acLevel)) { inSection = false; dropEmpty() }
    const content = line.replace(v.listItem, '').trim()
    const isStep = v.thenStep.test(content) || v.continuation.test(content)
    if (hasVaguePhrase(v, line) && (inSection || isStep)) { if (head && inSection) head.dropped = true; continue }
    if (head && inSection && content && kept.length > head.at) head.content = true
    kept.push(raw)
  }
  dropEmpty()
  return kept.join('\n')
}

const NUMBERED = /^\s*\d+[.)]\s+/
// Double quotes or guillemets only: single quotes are too often apostrophes.
const QUOTED = /["“«][^"“”«»\n]+["”»]/
// "Click Save: the toast reads Saved"
const RESULT_AFTER_ACTION = /(?::|→|->|=>|\s[–—]\s)\s*(.+)$/

/**
 * List blocks outside the AC and named sections (Steps to reproduce, Notes...).
 * A paragraph of plain lines counts as a list too, since Jira often loses the markers.
 */
function freeLists(v, text) {
  const blocks = []
  let section = null // 'ac' | 'named' | null
  let block = null
  let blank = false
  const close = () => { if (block) blocks.push(block); block = null }
  for (const line of stripComments(normalise(text)).split('\n')) {
    if (v.acHeading.test(line)) { close(); section = 'ac'; continue }
    if (v.sectionEnd.test(line)) {
      close()
      const words = line.replace(/^\s*(?:#{1,6}|h[1-6]\.)?\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
      section = v.namedSection.test(words) ? 'named' : null
      continue
    }
    if (!line.trim()) { blank = true; continue }
    const listed = v.listItem.test(line)
    if (block && (block.listed !== listed || (!listed && blank))) close()
    blank = false
    if (section) continue
    const content = line.replace(v.listItem, '').replace(/\*+/g, '').trim()
    if (!content) continue
    block ??= { listed, items: [], numbered: [] }
    block.items.push(content)
    block.numbered.push(NUMBERED.test(line))
  }
  close()
  return blocks
}

/**
 * True when the item names something a test can see. An action counts only after ":" or an arrow;
 * an unlisted line needs words or quotes, since a bare number (date, id) isn't a result.
 */
export function namesObservable(v, item, { listed = true } = {}) {
  if (QUESTION.test(item)) return false
  const result = v.actionStep.test(item) ? item.match(RESULT_AFTER_ACTION)?.[1] : item
  return !!result && (v.observable.test(result) || (listed && /\d/.test(result)) || QUOTED.test(result))
}

// Headingless criteria: 2+ items, each observable or vague (vague fails later), at least one observable.
export function extractListCriteria(v, text) {
  const items = []
  for (const b of freeLists(v, text)) {
    if (b.items.length < 2) continue
    const checks = b.items.filter(i => namesObservable(v, i, b))
    if (checks.length && b.items.every(i => checks.includes(i) || hasVaguePhrase(v, i))) items.push(...b.items)
  }
  return items
}

// A numbered list starting with an action and holding at least two ("1. Open the list 2. Click Filter").
export function hasActionSteps(v, text) {
  return freeLists(v, text).some(b => {
    const numbered = b.items.filter((_, i) => b.numbered[i])
    return numbered.length >= 2 && v.actionStep.test(numbered[0]) && numbered.filter(i => v.actionStep.test(i)).length >= 2
  })
}

export function naturalLength(items) {
  return (items || []).join(' ').length
}

export function hasNaturalAC(items) {
  return naturalLength(items) >= MIN_NATURAL_AC
}

/** On a one-line Given/When/Then, only the text after the last Then is the outcome (When is input). */
export function outcomeOf(chunk, v) {
  const hits = [...chunk.matchAll(v.thenWord)]
  const last = hits.at(-1)
  return last && /\b(?:given|when|dato|data|quando)\b/i.test(chunk.slice(0, last.index)) ? chunk.slice(last.index + last[0].length) : chunk
}

/** Takes a Gherkin string, {gherkin}, {then} or {expected}. */
export function hasConcreteThen(v, scenario) {
  const src =
    typeof scenario === 'string'
      ? scenario
      : (scenario?.then ?? scenario?.expected ?? scenario?.gherkin ?? '')
  const text = normalise(src)
  const oneLine = outcomeOf(text, v)
  const thenLine = (text.match(v.thenLineCapture) || [])[1] ?? (oneLine === text ? undefined : oneLine)
  // A then/expected field is already the result; a whole scenario needs an explicit Then.
  const isExpectedField =
    typeof scenario === 'object' && scenario !== null && (scenario.then != null || scenario.expected != null)
  if (thenLine == null && !isExpectedField) return false
  const then = String(thenLine ?? text).trim()
  // 12 chars rejects stubs like "Then ok".
  return then.length >= 12 && !hasVaguePhrase(v, then)
}

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

  // A Then under the AC heading is read twice; dedupe.
  return [...new Set(chunks.filter(Boolean))]
}

export function countDerivableFromText(v, text) {
  return extractExpectedChunks(v, text).filter(c => c.length >= 12 && !hasVaguePhrase(v, c)).length
}
