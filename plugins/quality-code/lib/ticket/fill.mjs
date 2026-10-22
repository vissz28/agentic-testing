// Guided fill-in: option 2 on the refuse card. The model asks the questions; these decide.
// A menu of the gaps with their real gains, a projection of a pick, and an answer writer that
// keeps an answer only if the rubric then credits it.
import { buildVocabulary } from './languages/index.mjs'
import { extractNaturalAC, hasGherkin, hasThen, MIN_NATURAL_AC, naturalLength, stripVagueCriteria } from './criteria.mjs'
import { messagesFor, templateFor } from './messages.mjs'
import { buildBrief, rubricFor, scoreTicket } from './score.mjs'
import { asAdapter, isFullstack } from '../base/stack.mjs'
import playwright from './rubrics/playwright.mjs'
import vitest from './rubrics/vitest.mjs'

/** A story is never asked for these: they are Bug language. */
const NOT_ON_STORY = new Set(['environment', 'expected_defined'])

// Rejection wording, one table per rubric: the two stacks phrase these slightly differently.
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

/** The menu items a design can answer: what the screen shows, not who asked or where. */
export const DESIGN_ITEMS = ['ac_present', 'ac_testable', 'steps', 'expected_defined']

const FIGMA_URL = /https?:\/\/(?:[\w-]+\.)?figma\.com\/(?:design|file|proto|board)\/[^\s<>"'`)\]]+/gi
export const MAX_FIGMA_LINKS = 5

/** The distinct Figma URLs of a ticket (its links, description and `figma` field), http(s) only, at most 5. */
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

/** The signals as they would be if `keys` were filled. AC also credits testable and expected, as the rubric does. */
function credit(signals, keys) {
  const s = { ...signals }
  for (const k of keys) {
    s[k] = true
    if (k === 'ac_present') Object.assign(s, { ac_testable: true, expected_defined: true })
  }
  return s
}

/** The numbered list QA picks from: the refuse comment's gaps, each with the points it would really add. */
export function fillMenu(config, brief) {
  // On a fullstack project the brief says which side's rubric decided it.
  const rubric = { playwright, vitest }[brief.rubric] ?? rubricFor(config)
  const kind = templateFor(brief.issuetype, config)
  const msgs = messagesFor(config, kind)
  const keys = new Set(brief.missing.map(m => m.key))
  const omitted = brief.omitted ?? rubric.omitted?.(config, brief) ?? new Set()
  const order = Object.keys(rubric.weights)
  const items = brief.missing
    .filter(m =>
      m.key !== 'qa_plan_found' &&
      !(m.key === 'ac_testable' && keys.has('ac_present')) &&
      !(kind === 'story' && NOT_ON_STORY.has(m.key)))
    .map(m => {
      const block = msgs[m.key] ?? {}
      const gain = scoreTicket(rubric, credit(brief.signals, [m.key]), omitted).score - brief.score
      return { key: m.key, title: block.title ?? m.label, gain, question: block.question, example: block.example, ...(DESIGN_ITEMS.includes(m.key) ? { design: true } : {}) }
    })
    .sort((a, b) => b.gain - a.gain || order.indexOf(a.key) - order.indexOf(b.key))
    .map((item, i) => ({ n: i + 1, ...item }))
  const menu = { key: brief.key, rubric: rubric.id, issuetype: brief.issuetype, score: brief.score, threshold: brief.threshold, signals: brief.signals, items }
  // Non-enumerable, as on the brief: projectPick scores a pick over the same keys.
  Object.defineProperty(menu, 'omitted', { value: [...omitted], enumerable: false })
  return menu
}

/** The rubric a menu was built for, read from its signal keys so a menu that went through JSON still works. */
function rubricOfSignals(signals) {
  return Object.keys(signals ?? {}).includes('context') ? vitest : playwright
}

/** Would filling these menu numbers reach the bar? */
export function projectPick(menu, nums) {
  const picked = []
  for (const n of nums) {
    const item = menu.items.find(i => i.n === Number(n))
    if (!item) return { error: `There is no number ${n} on the list.` }
    if (!picked.includes(item)) picked.push(item)
  }
  if (!picked.length) return { error: 'Type at least one number from the list.' }
  const rubric = menu.rubric === 'vitest' ? vitest : menu.rubric === 'playwright' ? playwright : rubricOfSignals(menu.signals)
  const score = scoreTicket(rubric, credit(menu.signals, picked.map(i => i.key)), new Set(menu.omitted ?? [])).score
  return {
    picked: picked.map(({ n, key, title, question, example }) => ({ n, key, title, question, example })),
    score,
    threshold: menu.threshold,
    enough: score >= menu.threshold,
    short: Math.max(0, menu.threshold - score),
  }
}

// Up to ten points under the bar, with something to check, a ticket is borderline: /quality-code:spec
// goes on with the risk mark instead of stopping. ponytail: a fixed gap, a config field if a team asks.
export const BORDERLINE_GAP = 10

/**
 * What the gate means for the next step: the band (ready, borderline or refused) and the fewest
 * fill-in items, biggest gain first, that get the ticket over the bar, with the score they reach.
 */
export function nextStep(config, brief) {
  if (brief.gate === 'pass') return { band: 'ready', fix: [], reach: brief.score, threshold: brief.threshold, enough: true }
  const band = brief.score >= brief.threshold - BORDERLINE_GAP && brief.derivable >= 1 ? 'borderline' : 'refused'
  const menu = fillMenu(config, brief)
  let pick = null
  for (let n = 1; n <= menu.items.length && !pick?.enough; n++) pick = projectPick(menu, menu.items.slice(0, n).map(i => i.n))
  const fix = (pick?.picked ?? []).map(p => ({ key: p.key, title: p.title, gain: menu.items.find(i => i.key === p.key).gain }))
  return { band, fix, reach: pick?.score ?? brief.score, threshold: brief.threshold, enough: Boolean(pick?.enough) }
}

/** The one line that leads the refuse card, or null for a ready ticket. */
export function formatNextStep(step) {
  if (step.band === 'ready' || !step.fix.length) return null
  const names = step.fix.map(f => f.title)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return step.enough
    ? `To pass: add ${list} (→ ${step.reach} points, the bar is ${step.threshold}).`
    : `Even with ${list} the ticket reaches ${step.reach} points: the fill-in alone cannot get it to the bar.`
}

export function formatFillMenu(menu) {
  const width = Math.max(...menu.items.map(i => i.title.length), 0)
  return [
    `This ticket has ${menu.score} of the ${menu.threshold} points it needs.`,
    'What is missing:',
    ...menu.items.map(i => `  ${i.n}. ${i.title.padEnd(width)}  +${i.gain}`),
    'Type the numbers you want to fill, for example: 1 3',
  ].join('\n')
}

export function formatPick(pick) {
  if (pick.error) return pick.error
  const nums = pick.picked.map(p => p.n).join(' and ')
  return pick.enough
    ? `With ${nums} the ticket reaches ${pick.score} points (the bar is ${pick.threshold}): enough.`
    : `With ${nums} the ticket reaches ${pick.score} points (the bar is ${pick.threshold}): ${pick.short} points short. Pick more numbers, or type them again.`
}

/** The example shown after a rejected answer: only for a key the rubric lets the author type in. */
export function exampleFor(config, ticket, key) {
  const rubric = rubricFor(config, ticket)
  if (key === 'qa_plan_found' || !Object.hasOwn(rubric.weights, key)) return undefined
  return messagesFor(config, templateFor(ticket.issuetype, config))[key]?.example
}

/**
 * Write one answer into the ticket, but only if the rubric then credits it. A rejected answer
 * returns the untouched input and the reason, so nothing half-written reaches the file.
 * `drafted`: the text began as the model's draft and the author confirmed it. The fill-in record
 * and the ticket's `drafted` list say so; the score is the same as for a typed answer.
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
  // What this answer adds, recorded so a Jira update can push only QA's text.
  const entry = { key }
  const addSection = (heading, body) => {
    entry.section = `## ${heading}\n${body}`
    desc = [desc.trimEnd(), entry.section].filter(Boolean).join('\n\n')
  }
  const vague = t => t.match(v.vague)?.[0]
  // Headings in the first configured language, so that language's vocabulary credits them.
  const h = v.headings
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const featureLabels = (config.features ?? []).map(f => f.label)
  const prefixes = config.titlePrefixes ?? []

  switch (key) {
    case 'ac_present':
    case 'ac_testable': {
      if (vague(text)) return reject(why.vague(vague(text)))
      // Gherkin carries its own structure; plain sentences must say enough to test against. Real
      // Gherkin is the scorer's rule: a lone "When ..." sentence is plain criteria, not Gherkin.
      // Gherkin typed as "- Given ..." bullets is written without them, so the scorer reads it.
      const unbulleted = lines.map(l => l.replace(/^[-*]\s+/, ''))
      const bulletedGherkin = lines.some(l => /^[-*]\s+/.test(l)) && hasGherkin(v, unbulleted.join('\n'))
      if (bulletedGherkin) lines.splice(0, lines.length, ...unbulleted)
      const isGherkin = bulletedGherkin || hasGherkin(v, text)
      const length = naturalLength(extractNaturalAC(v, text, { headingless: true }))
      const stepsOnly = !isGherkin && !hasThen(v, text) && unbulleted.some(l => v.gherkinStep.test(l))
      if (stepsOnly && length === 0) return reject(why.noThen)
      if (!isGherkin && length < MIN_NATURAL_AC) return reject(why.short(length))
      if (key === 'ac_testable') {
        entry.replacedVague = true
        desc = stripVagueCriteria(v, desc)
        if (next.text.acField) next.text.acField = stripVagueCriteria(v, next.text.acField, { headingless: true })
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
      const [expected, actual] = text.split(/\s*\|\s*|\n+/).map(t => t.trim())
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
      next.summary = `[${prefix}] ${String(next.summary ?? '').replace(/^\s*\[[^\]]*\]\s*/, '')}`
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
      // A file cannot be typed in. "done" is only a promise: the score counts it after the ticket is read again.
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
  // Credited by the rubric it was asked for: on a fullstack project the other side's may decide now.
  const { signals } = isFullstack(config) ? buildBrief(asAdapter(config, rubric.id), next) : brief
  const credited = key === 'ac_present' ? signals.ac_present && signals.ac_testable : signals[key]
  if (!credited) return reject('The answer was added, but the check still does not count it. Try the example form.')
  if (drafted) {
    entry.drafted = true
    next.drafted = [...new Set([...(Array.isArray(ticket.drafted) ? ticket.drafted : []), key])]
  }
  next.filled = [...(ticket.filled ?? []), entry]
  return { ok: true, input: next, brief }
}
