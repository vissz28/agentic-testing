// Jira comment and update bodies for refused tickets and fill-ins.
import { messagesFor, refuseFallback, templateFor } from './messages.mjs'

export { templateFor }

// Only on old comments. Never emit it: Jira renders it as visible text.
export const REFUSE_COMMENT_MARK = '<!-- /spec refuse -->'

// Last line of everything we write to Jira.
export const COAUTHOR_LINE = 'Co-authored via Quality Code'

// Identifies our comment so a re-run edits it instead of posting again.
export const REFUSE_COMMENT_FOOTER = 'Thanks, we can continue as soon as these are on the ticket.'

// Footer used before 2026-09-23; still matched or a re-run would duplicate.
export const OLD_FOOTER = 'Thanks — we can continue as soon as these are on the ticket.'

// Default for config.messages.jiraFillMark.
export const JIRA_FILL_MARK = '_Added during the quality-code readiness check._'

export function jiraFillMark(config) {
  const custom = config?.messages?.jiraFillMark
  return typeof custom === 'string' ? custom : JIRA_FILL_MARK
}

// Not in the Story template.
const NOT_ON_STORY = new Set(['environment', 'expected_defined'])

export function isRefuseComment(text) {
  const s = String(text ?? '')
  return [REFUSE_COMMENT_FOOTER, OLD_FOOTER, REFUSE_COMMENT_MARK].some(m => s.includes(m))
}

export function templateLine(config, issuetype) {
  const kind = templateFor(issuetype, config)
  const custom = config.messages?.templateLine?.[kind]
  if (typeof custom === 'string') return custom
  const path = config.ticketTemplates?.[kind]
  if (!path) return ''
  return `The full ${kind === 'bug' ? 'Bug' : 'Story'} template is at ${path}.`
}

export const browseUrl = (config, key) => `${config.jira.site}/browse/${key}`

function authorGaps(config, brief) {
  const kind = templateFor(brief.issuetype, config)
  const items = brief.missing || []
  const keys = new Set(items.map(m => m.key))
  const omitted = brief.omitted ?? new Set()
  return items.filter(
    m =>
      // the QA plan is on us, not the author
      m.key !== 'qa_plan_found' &&
      !omitted.has(m.key) &&
      // missing AC and vague AC are one fix
      !(m.key === 'ac_testable' && keys.has('ac_present')) &&
      !(kind === 'story' && NOT_ON_STORY.has(m.key)),
  )
}

/** Posted verbatim, never rewritten. */
export function formatRefuseComment(config, brief) {
  const kind = templateFor(brief.issuetype, config)
  const msgs = messagesFor(config, kind)
  const shown = authorGaps(config, brief)
  const body = shown
    .map((m, i) => {
      const block = msgs[m.key]
      if (!block) return `### ${i + 1}. ${m.label}`
      return [`### ${i + 1}. ${block.title}`, block.missing, '', block.add].join('\n')
    })
    .join('\n\n')
  const line = templateLine(config, brief.issuetype)
  return [
    'Hi, this ticket needs a bit more information before we can start the checks.',
    '',
    'Here is what to add:',
    '',
    body || refuseFallback(config),
    '',
    ...(line ? [line, ''] : []),
    REFUSE_COMMENT_FOOTER,
    '',
    COAUTHOR_LINE,
  ].join('\n')
}

// Identifies the risk note so a re-run edits it.
export const RISK_COMMENT_FOOTER = 'Logged by quality-code: tests were written on an incomplete ticket.'

/** Note for tests written past the gate (refuse option 3). Posted verbatim. */
export function formatRiskComment(config, brief) {
  const msgs = messagesFor(config, templateFor(brief.issuetype, config))
  const gaps = authorGaps(config, brief).map(m => `- ${msgs[m.key]?.title ?? m.label}`)
  return [
    `Tests were written for this ticket although it is not complete: it has ${brief.score} points and needs ${brief.threshold}.`,
    '',
    '🔴 [RISK / NOT RECOMMENDED] The tests check what the ticket says today. Until the missing parts are added, they may check the wrong thing.',
    ...(gaps.length ? ['', 'Still missing:', ...gaps] : []),
    '',
    RISK_COMMENT_FOOTER,
    '',
    COAUTHOR_LINE,
  ].join('\n')
}

// Built from `filled` only, so the redacted text on disk never goes back to Jira.
export function jiraUpdate(config, input) {
  const filled = input.filled ?? []
  const sections = filled.filter(f => f.section).map(f => f.section)
  return {
    append: sections.length ? [jiraFillMark(config), ...sections].join('\n\n') : null,
    labelsAdd: [...new Set(filled.filter(f => f.label).map(f => f.label))],
    titlePrefix: filled.findLast(f => f.prefix)?.prefix ?? null,
    replacedVague: filled.some(f => f.replacedVague),
  }
}

export function formatJiraUpdate(update) {
  if (!update.append && !update.labelsAdd.length && !update.titlePrefix) {
    return 'Nothing was added, so there is nothing to put on the Jira ticket.'
  }
  const out = []
  if (update.append) {
    out.push('This will be added to the end of the description:', '', ...update.append.split('\n').map(l => (l ? `  ${l}` : '')), '')
  }
  if (update.labelsAdd.length) out.push(`Label added: ${update.labelsAdd.join(', ')}`)
  if (update.titlePrefix) out.push(`Title gets the prefix [${update.titlePrefix}]`)
  out.push('Nothing already on the ticket is changed.')
  if (update.replacedVague) {
    out.push('The vague criterion you rewrote stays on the ticket; remove it there if you want the next check to pass without this step.')
  }
  return out.join('\n')
}
