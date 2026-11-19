// Guided fill-in for a refused ticket. The model asks; these functions decide what counts.
import { buildVocabulary } from './languages/index.mjs'
import { extractNaturalAC, hasGherkin, hasThen, MIN_NATURAL_AC, naturalLength, stripVagueCriteria } from './criteria.mjs'
import { messagesFor, templateFor } from './messages.mjs'
import { buildBrief, omittedFor, rubricFor, scoreTicket } from './score.mjs'
import { asAdapter, isFullstack } from '../stacks/stack.mjs'
import { backendOf } from '../stacks/backends.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'

// Rejection messages per rubric.
const REASONS = {
  playwright: {
    unknownKey: k => `There is no criterion called ${k} that can be typed in.`,
    vague: w => `"${w}" is not something a test can see. Name the label, the count or the exact text.`,
    short: n => `Too short: ${n} characters. Plain-language criteria need at least ${MIN_NATURAL_AC} (two or three sentences on what the user should see), or write them as Given / When / Then.`,
    pair: 'Write both, separated by |: what you should see | what you see now.',
    noThen: 'These Given / When steps have no Then line. Add a Then saying what the user should see, or write it as a sentence: When X, Y.',
  },
  vitest: {
    unknownKey: k => `There is no criterion called ${k}.`,
    vague: w => `"${w}" is not a result a test can check. Name the number or the exact text.`,
    short: n => `Too short: ${n} characters. Plain-language criteria need at least ${MIN_NATURAL_AC} (two or three sentences on what should happen), or write them as Given / When / Then.`,
    pair: 'Write both, separated by |: what should happen | what happens now.',
    noThen: 'These Given / When steps have no Then line. Add a Then saying what should happen, or write it as a sentence: When X, Y.',
  },
}

// Items a Figma design can answer.
export const DESIGN_ITEMS = ['ac_present', 'ac_testable', 'steps', 'expected_defined']

const FIGMA_URL = /https?:\/\/(?:[\w-]+\.)?figma\.com\/(?:design|file|proto|board)\/[^\s<>"'`)\]]+/gi
export const MAX_FIGMA_LINKS = 5

export function figmaLinks(ticket) {
  const sources = [
    ...(Array.isArray(ticket?.links) ? ticket.links.map(l => (typeof l === 'string' ? l : l?.url)) : []),
    ticket?.text?.description,
    ticket?.text?.acField,
    ticket?.figma,
  ]
  const found = []
  for (const src of sources) {
    if (typeof src !== 'string') continue
    for (const m of src.matchAll(FIGMA_URL)) {
      const url = m[0].replace(/[.,;:!?]+$/, '')
      if (!found.includes(url)) found.push(url)
    }
  }
  return found.slice(0, MAX_FIGMA_LINKS)
}

// Filling AC also credits testable and expected, as the rubric does.
function credit(signals, keys) {
  const s = { ...signals }
  for (const k of keys) {
    s[k] = true
    if (k === 'ac_present') Object.assign(s, { ac_testable: true, expected_defined: true })
  }
  return s
}

export function fillMenu(config, brief) {
  const rubric = { playwright, vitest }[brief.rubric] ?? rubricFor(config)
  const kind = templateFor(brief.issuetype, config)
  const msgs = messagesFor(config, kind)
  const keys = new Set(brief.missing.map(m => m.key))
  const omitted = brief.omitted ?? omittedFor(rubric, config, brief)
  const order = Object.keys(rubric.weights)
  const items = brief.missing
    .filter(m => m.key !== 'qa_plan_found' && !(m.key === 'ac_testable' && keys.has('ac_present')))
    .map(m => {
      const block = msgs[m.key] ?? {}
      const gain = scoreTicket(rubric, credit(brief.signals, [m.key]), omitted).score - brief.score
      return { key: m.key, title: block.title ?? m.label, gain, question: block.question, example: block.example, ...(DESIGN_ITEMS.includes(m.key) ? { design: true } : {}) }
    })
    .sort((a, b) => b.gain - a.gain || order.indexOf(a.key) - order.indexOf(b.key))
    .map((item, i) => ({ n: i + 1, ...item }))
  const menu = { key: brief.key, rubric: rubric.id, issuetype: brief.issuetype, score: brief.score, threshold: brief.threshold, signals: brief.signals, items }
  // Non-enumerable, as on the brief.
  Object.defineProperty(menu, 'omitted', { value: [...omitted], enumerable: false })
  // Gaps that can't be typed in (a Confluence QA plan).
  Object.defineProperty(menu, 'untyped', { value: brief.missing.filter(m => m.key === 'qa_plan_found').map(m => m.label), enumerable: false })
  return menu
}

// The rubric id is non-enumerable, so a menu read back from JSON is identified by its signal keys.
function rubricOfSignals(signals) {
  return Object.keys(signals ?? {}).includes('context') ? vitest : playwright
}

export function projectPick(menu, nums) {
  const picked = []
  for (const n of nums) {
    const item = menu.items.find(i => i.n === Number(n))
    if (!item) return { error: `There is no number ${n} on the list.` }
    if (!picked.includes(item)) picked.push(item)
  }
  if (!picked.length) return { error: 'Type at least one number from the list.' }
  const rubric = { vitest, playwright }[menu.rubric] ?? rubricOfSignals(menu.signals)
  const score = scoreTicket(rubric, credit(menu.signals, picked.map(i => i.key)), new Set(menu.omitted ?? [])).score
  return {
    picked: picked.map(({ n, key, title, question, example }) => ({ n, key, title, question, example })),
    score,
    threshold: menu.threshold,
    enough: score >= menu.threshold,
    short: Math.max(0, menu.threshold - score),
  }
}

// Within 10 points and with something to check, /quality-code:spec goes on with a risk mark.
// ponytail: a fixed gap, a config field if a team asks.
export const BORDERLINE_GAP = 10

/** Band (ready/borderline/refused) and the fewest fill-in items, biggest gain first, that pass the bar. */
export function nextStep(config, brief) {
  if (brief.gate === 'pass') return { band: 'ready', fix: [], reach: brief.score, threshold: brief.threshold, enough: true }
  const band = brief.score >= brief.threshold - BORDERLINE_GAP && brief.derivable >= 1 ? 'borderline' : 'refused'
  const menu = fillMenu(config, brief)
  let pick = null
  for (let n = 1; n <= menu.items.length && !pick?.enough; n++) pick = projectPick(menu, menu.items.slice(0, n).map(i => i.n))
  const fix = (pick?.picked ?? []).map(p => ({ key: p.key, title: p.title, gain: menu.items.find(i => i.key === p.key).gain }))
  return { band, fix, reach: pick?.score ?? brief.score, threshold: brief.threshold, enough: Boolean(pick?.enough) }
}

export function formatNextStep(step) {
  if (step.band === 'ready' || !step.fix.length) return null
  const names = step.fix.map(f => f.title)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return step.enough
    ? `To pass: add ${list} (→ ${step.reach} points, needs ${step.threshold}).`
    : `Even with ${list} the ticket reaches ${step.reach} points: the fill-in alone cannot get it to ${step.threshold}.`
}

export function formatFillMenu(menu) {
  // Never show an empty list on a refused ticket.
  if (!menu.items.length && menu.score < menu.threshold) {
    return [
      `This ticket has ${menu.score} points and needs ${menu.threshold}.`,
      `Nothing missing can be typed in here${menu.untyped?.length ? `: it needs ${menu.untyped.join(', ')}` : ''}.`,
      'Post a comment on Jira with what to add, or continue anyway.',
    ].join('\n')
  }
  const width = Math.max(...menu.items.map(i => i.title.length), 0)
  return [
    `This ticket has ${menu.score} points and needs ${menu.threshold}.`,
    'What is missing:',
    ...menu.items.map(i => `  ${i.n}. ${i.title.padEnd(width)}  +${i.gain}`),
    'Type the numbers you want to fill, for example: 1 3',
  ].join('\n')
}

export function formatPick(pick) {
  if (pick.error) return pick.error
  const nums = pick.picked.map(p => p.n).join(' and ')
  return pick.enough
    ? `With ${nums} the ticket reaches ${pick.score} points (needs ${pick.threshold}): enough.`
    : `With ${nums} the ticket reaches ${pick.score} points (needs ${pick.threshold}): ${pick.short} points short. Pick more numbers, or type them again.`
}

export function exampleFor(config, ticket, key) {
  const rubric = rubricFor(config, ticket)
  if (key === 'qa_plan_found' || !Object.hasOwn(rubric.weights, key)) return undefined
  return messagesFor(config, templateFor(ticket.issuetype, config))[key]?.example
}

/**
 * Writes the answer only if the rubric then credits it; a rejection returns the input untouched.
 * `drafted` marks a model draft the author confirmed; it scores the same.
 */
export function applyAnswer(config, ticket, key, answer, { drafted = false } = {}) {
  const rubric = rubricFor(config, ticket)
  const why = REASONS[rubric.id]
  const v = buildVocabulary(config.languages)
  const text = String(answer ?? '').trim()
  const kind = templateFor(ticket.issuetype, config)
  const reject = reason => ({ ok: false, reason, input: ticket })
  if (key === 'qa_plan_found' || !Object.hasOwn(rubric.weights, key)) return reject(why.unknownKey(key))
  if (!text) return reject('The answer is empty.')
  const next = { ...ticket, text: { ...(ticket.text ?? {}) }, labels: [...(ticket.labels ?? [])] }
  let desc = next.text.description ?? ''
  // Recorded so a Jira update pushes only QA's text.
  const entry = { key }
  const addSection = (heading, body) => {
    entry.section = `## ${heading}\n${body}`
    desc = [desc.trimEnd(), entry.section].filter(Boolean).join('\n\n')
  }
  const vague = t => t.match(v.vague)?.[0]
  // First configured language, so its vocabulary credits them.
  const h = v.headings
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const featureLabels = (config.features ?? []).map(f => f.label)
  const prefixes = config.titlePrefixes ?? []

  switch (key) {
    case 'ac_present':
    case 'ac_testable': {
      if (vague(text)) return reject(why.vague(vague(text)))
      // Uses the scorer's Gherkin rule; a lone "When ..." is plain criteria. Bullets are stripped
      // from "- Given ..." so the scorer reads it as Gherkin.
      const unbulleted = lines.map(l => l.replace(/^[-*]\s+/, ''))
      const bulletedGherkin = lines.some(l => /^[-*]\s+/.test(l)) && hasGherkin(v, unbulleted.join('\n'))
      if (bulletedGherkin) lines.splice(0, lines.length, ...unbulleted)
      const isGherkin = bulletedGherkin || hasGherkin(v, text)
      const length = naturalLength(extractNaturalAC(v, text, { headingless: true }))
      const stepsOnly = !isGherkin && !hasThen(v, text) && unbulleted.some(l => v.gherkinStep.test(l))
      if (stepsOnly && length === 0) return reject(why.noThen)
      if (!isGherkin && length < MIN_NATURAL_AC) return reject(why.short(length))
      // The menu folds ac_testable into ac_present, so this also replaces the vague lines.
      const stripped = stripVagueCriteria(v, desc)
      const acField = next.text.acField && stripVagueCriteria(v, next.text.acField, { headingless: true })
      if (key === 'ac_testable' || stripped !== desc || acField !== next.text.acField) {
        entry.replacedVague = true
        desc = stripped
        if (next.text.acField) next.text.acField = acField
      }
      addSection(h.ac, lines.map(l => (v.listOrStep.test(l) ? l : `- ${l}`)).join('\n'))
      break
    }
    case 'steps':
      if (text.length < 12) return reject('Too short to follow. Write the steps one per line.')
      if (kind === 'story') addSection(h.userStory, text)
      else addSection(h.steps, lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+[.)]\s*/, '')}`).join('\n'))
      break
    case 'expected_defined': {
      // Split at the first "|" (else the first line break) only: extra lines stay with their side, never dropped.
      const cut = text.includes('|') ? text.indexOf('|') : text.search(/\n/)
      const [expected, actual] = cut < 0 ? [text, ''] : [text.slice(0, cut).trim(), text.slice(cut + 1).trim()]
      if (!expected || !actual) return reject(why.pair)
      if (vague(expected)) return reject(why.vague(vague(expected)))
      addSection(h.expected, `${expected}\n\n## ${h.actual}\n${actual}`)
      break
    }
    case 'context':
      if (text.length < 12) return reject('Too short. One or two sentences is enough.')
      addSection(kind === 'story' ? h.context : h.summary, text)
      break
    case 'title_prefix': {
      const typed = text.match(/^\[?\s*([^\]]*?)\s*\]?$/)?.[1] ?? ''
      const prefix = prefixes.find(p => p.toLowerCase() === typed.toLowerCase())
      if (!prefix) {
        const custom = messagesFor(config, kind).title_prefix.reject
        return reject(typeof custom === 'string' && custom ? custom : `Type ${prefixes.length > 1 ? `${prefixes.slice(0, -1).join(', ')} or ${prefixes.at(-1)}` : prefixes[0] ?? 'a prefix'}.`)
      }
      entry.prefix = prefix
      // Only a configured prefix is swapped; any other tag, like [URGENT], is the author's and stays after ours.
      const old = String(next.summary ?? '').match(/^\s*\[\s*([^\]]*?)\s*\]\s*/)
      const own = old && prefixes.some(p => p.toLowerCase() === old[1].toLowerCase())
      next.summary = `[${prefix}] ${String(next.summary ?? '').slice(own ? old[0].length : 0).trim()}`
      break
    }
    case 'feature_label': {
      const label = featureLabels.find(l => l.toLowerCase() === text.toLowerCase())
      if (!label) return reject(`"${text}" is not a feature label.${featureLabels.length ? ` Use one of: ${featureLabels.join(', ')}` : ''}`)
      if (!next.labels.includes(label)) next.labels.push(label)
      entry.label = label
      break
    }
    case 'links': {
      const url = lines[0] ?? ''
      let ok = false
      try { const u = new URL(url); ok = /^https?:$/.test(u.protocol) && u.hostname.length > 0 && !/\s/.test(url) } catch { ok = false }
      if (!ok || lines.length > 1) return reject('Paste one web address that starts with http:// or https://.')
      addSection('Links', url)
      next.links = [...(next.links ?? []), { url, title: '' }]
      break
    }
    case 'attachments':
      // "done" is only a promise; it counts once the ticket is re-read from Jira.
      if (!/^(done|fatto)$/i.test(text)) return reject('Attach a screenshot, a video or a file on the Jira ticket, then answer: done')
      return { ok: false, pending: true, input: ticket, reason: 'Not counted yet. The check only counts a file it can see on the ticket: it is read again from Jira, then scored.' }
    case 'environment': {
      const env = text.replace(/^env\s*[:=]\s*/i, '').trim()
      if (!env) return reject('Name the environment, for example staging.')
      addSection(h.environment, `Env: ${env}`)
      break
    }
  }
  next.text.description = desc
  const brief = buildBrief(config, next)
  // Check credit with the rubric that asked: on fullstack the other side's may decide the brief.
  // The backend rubric's id is "vitest" whatever the runner.
  const { signals } = isFullstack(config) ? buildBrief(asAdapter(config, rubric.id === 'playwright' ? 'playwright' : backendOf(config)), next) : brief
  const credited = key === 'ac_present' ? signals.ac_present && signals.ac_testable : signals[key]
  if (!credited) return reject('The answer was added, but the check still does not count it. Try the example form.')
  if (drafted) {
    entry.drafted = true
    next.drafted = [...new Set([...(Array.isArray(ticket.drafted) ? ticket.drafted : []), key])]
  }
  next.filled = [...(ticket.filled ?? []), entry]
  return { ok: true, input: next, brief }
}
