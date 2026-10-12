// The comment posted on a refused ticket, and what is pushed to Jira after a guided fill-in.
import { messagesFor, refuseFallback, templateFor } from './messages.mjs'

export { templateFor }

/** Tag on the oldest comments. Never emit it: Jira renders it as visible text. */
export const REFUSE_COMMENT_MARK = '<!-- /spec refuse -->'

/** Marks our comment, so a re-run edits it instead of posting a second one. */
export const REFUSE_COMMENT_FOOTER = 'Thanks, we can continue as soon as these are on the ticket.'

/** Same footer as posted before 2026-09-23. Still matched, or a re-run would duplicate. */
export const OLD_FOOTER = 'Thanks — we can continue as soon as these are on the ticket.'

export const JIRA_FILL_MARK = '_Added during the /spec readiness check._'

/** Sections the Story template does not have. Never ask a Story author for them. */
const NOT_ON_STORY = new Set(['environment', 'expected_defined'])

export function isRefuseComment(text) {
  const s = String(text ?? '')
  return [REFUSE_COMMENT_FOOTER, OLD_FOOTER, REFUSE_COMMENT_MARK].some(m => s.includes(m))
}

/** The closing line: the configured one, a pointer to the template file, or nothing. */
export function templateLine(config, issuetype) {
  const kind = templateFor(issuetype)
  const custom = config.messages?.templateLine?.[kind]
  if (typeof custom === 'string') return custom
  const path = config.ticketTemplates?.[kind]
  if (!path) return ''
  return `The full ${kind === 'bug' ? 'Bug' : 'Story'} template is at ${path}.`
}

export const browseUrl = (config, key) => `${config.jira.site}/browse/${key}`

/** The Jira comment body. Posted verbatim, never rewritten. */
export function formatRefuseComment(config, brief) {
  const kind = templateFor(brief.issuetype)
  const msgs = messagesFor(config, kind)
  const items = brief.missing || []
  const keys = new Set(items.map(m => m.key))
  const shown = items.filter(
    m =>
      // a missing QA plan is on us, not on the ticket author
      m.key !== 'qa_plan_found' &&
      // if Given/When/Then is missing, skip the "Then is vague" item, it is one fix
      !(m.key === 'ac_testable' && keys.has('ac_present')) &&
      // and never ask for a section the ticket's own template does not carry
      !(kind === 'story' && NOT_ON_STORY.has(m.key)),
  )
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
  ].join('\n')
}

/**
 * What to send to Jira after a guided fill-in: new sections to append to the description, labels
 * to add, and a title prefix. Built from the `filled` record only, so the sanitized (redacted) text
 * on disk never goes back.
 */
export function jiraUpdate(input) {
  const filled = input.filled ?? []
  const sections = filled.filter(f => f.section).map(f => f.section)
  return {
    append: sections.length ? [JIRA_FILL_MARK, ...sections].join('\n\n') : null,
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
