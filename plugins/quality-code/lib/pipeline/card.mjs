import { DEFAULT_DONE_STATUSES } from '../base/config.mjs'
import { runnerLabel } from '../base/runners.mjs'
const LABEL = { 'suite-honesty': 'assertions' }
const ICON = { pass: '✅', fail: '❌', not_run: '⚠️' }
const VERDICT = { green: '✅ green', checks_failed: '❌ checks failed', not_verified: '⚠️ not verified', tests_red: '🔴 tests red' }

export const label = check => LABEL[check] || check
const quoted = findings => findings.filter(f => f.test).map(f => `'${f.test}'`).join(', ')

function stepLine(step) {
  let text = step.summary
  if (step.status === 'not_run') text = `not run: ${text.replace(/(^|: )skipped: /g, '$1')}`
  else if (step.status === 'fail') {
    const f = (step.findings || []).find(x => x.test)
    if (f) text += `: ${f.file ? `${f.file} › ` : ''}'${f.test}'`
  }
  return `  ${ICON[step.status]} ${label(step.check).padEnd(15)}${text}`
}

const BUG = /\b(?:bug|defect|difetto|incident)\b/i
const isDone = (status, done) => {
  const s = String(status ?? '').trim().toLowerCase()
  // A status that says the change was merged ("Merged in MB") is finished too, whatever the project calls it.
  return Boolean(s) && (done.some(d => d.trim().toLowerCase() === s) || /\bmerg/.test(s))
}

/**
 * Why a red test may be fine, or not, by what the ticket is: red is expected only for a Bug whose fix is not merged yet.
 * Without a ticket (a suite run) nothing is said about bugs.
 */
export function redAdvice({ issueType = null, status = null, done = DEFAULT_DONE_STATUSES } = {}) {
  if (!issueType) return 'Either the code does not do what the ticket says, or the test is wrong.'
  if (!BUG.test(issueType)) return `The ticket is a ${issueType}, not a bug: the code does not do what it says, or the test is wrong.`
  if (isDone(status, done)) return `Jira says ${String(status).trim()}: the fix should be on this branch, so the code still has the bug, or the test is wrong.`
  return "For a bug whose fix isn't merged yet, red is the expected result."
}

function whatToDo(outcome, ctx = {}) {
  if (outcome.verdict === 'green') return null
  const steps = outcome.steps
  if (outcome.verdict === 'not_verified') {
    const nr = steps.find(x => x.status === 'not_run')
    return nr ? `${label(nr.check)} could not run: ${String(nr.summary).replace(/^skipped: /, '')}` : null
  }
  const step = steps.find(x => x.check === outcome.decidedBy) || steps.find(x => x.status === 'fail')
  if (!step) return null
  const fs = step.findings || []
  switch (step.check) {
    case 'boundary': return `undo the changes to ${fs.map(f => f.file).filter(Boolean).join(', ')}: tests never change application code.`
    case 'honesty': return 'restore the removed assertion or test, or name a ticket on the skip.'
    case 'suite-honesty': return `add a real expect(...) to ${quoted(fs)}, or mark it todo if the behaviour isn't known yet.`
    case 'types': return `fix the compile error: ${String(step.summary).split('\n')[0]}`
    case 'mutation': return `an assertion can't fail: bind the real expected value in ${quoted(fs)}.`
    case 'expected': {
      const f = fs.find(x => x.token) || {}
      if (f.actual) return `the test asserts ${f.actual}, the wrong result the ticket reports: assert the expected ${f.token} (from "${f.then}")`
      if (f.kind === 'field not asserted') return `assert on the field the ticket names, ${f.token} (from "${f.then}"), not on another one`
      return `assert the ticket's expected value ${f.token} (from "${f.then}")`
    }
    case 'stryker': return `the tests miss changes in ${step.data?.target}: assert the values the code computes`
    case 'flaky': return `fix the non-determinism in ${quoted(fs)}, or skip them with a ticket.`
    case 'tests': {
      const f = fs.find(x => x.test) || fs[0] || {}
      return `'${f.test}'${f.detail ? `: ${f.detail}` : ''}. ${redAdvice(ctx)}`
    }
    default: return null
  }
}

// A probe the ticket did not ask for: the writing guides name it "Extra: …" (old backend specs: "edge …").
const EXTRA = /^\s*(?:extra\b|edge\b)/i
const MARK = { passed: '✓', failed: '✗', skipped: '–' }
const clip = (s, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** What a red test recorded about where it stopped: the step, the locator, the page. */
export function contextLines(c, pad = '') {
  if (!c) return []
  return [
    ...(c.at ? [`${pad}at ${c.at}`] : []),
    ...(c.locator ? [`${pad}waiting for ${c.locator}`] : []),
    ...(c.url ? [`${pad}page ${c.url}`] : []),
    ...(c.text ? [`${pad}page text: ${c.text}`] : []),
    ...(c.hint ? [`${pad}${c.hint}`] : []),
  ]
}

/** One line per test, the ticket's first and the extra probes after; a red one says why. */
function testLines(list) {
  if (!Array.isArray(list) || !list.length) return []
  const row = (t, pad) => [`${pad}${MARK[t.status] ?? '–'} ${t.title}${t.status === 'failed' && t.message ? `: ${clip(t.message)}` : ''}`, ...(t.status === 'failed' ? contextLines(t.context, `${pad}    `) : [])].join('\n')
  const own = list.filter(t => !EXTRA.test(t.title))
  const extra = list.filter(t => EXTRA.test(t.title))
  if (!extra.length) return own.map(t => row(t, '  '))
  return [...(own.length ? ['  From the ticket', ...own.map(t => row(t, '    '))] : []), '  Extra (not in the ticket)', ...extra.map(t => row(t, '    '))]
}

// A ticket Jira calls finished (jira.doneStatuses) while its tests are red: the bug is still on this branch.
export const finishedButRed = (outcome, status, done = DEFAULT_DONE_STATUSES) =>
  outcome.verdict === 'tests_red' && done.some(d => d.trim().toLowerCase() === String(status ?? '').trim().toLowerCase())

/** The mark a run forced past the readiness gate carries ("continue anyway"). Red in a terminal. */
export function riskLine({ score, bar }, color = false) {
  const text = `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (${score}/${bar})`
  return color ? `\x1b[31m${text}\x1b[0m` : text
}

export function formatCard(outcome, { specs = [], key = null, color = false, jiraStatus = null, issueType = null, doneStatuses = DEFAULT_DONE_STATUSES, log = null } = {}) {
  const n = specs.length
  const sides = outcome.runners?.length ? ` · ${outcome.runners.map(runnerLabel).join(' + ')}` : ''
  const lines = [`quality-code check · ${n} spec file${n === 1 ? '' : 's'}${sides}${key ? ` · ticket ${key}` : ''}`]
  if (outcome.incompleteTicket) lines.push(riskLine(outcome.incompleteTicket, color))
  lines.push('', `Verdict: ${VERDICT[outcome.verdict]}`)
  if (finishedButRed(outcome, jiraStatus, doneStatuses)) lines.push(`Jira says ${String(jiraStatus).trim()}. This branch still has the bug.`)
  const d = (outcome.steps.find(x => x.check === 'tests') || {}).data
  const counts = d && typeof d.passed === 'number' && typeof d.failed === 'number'
  if (counts) lines.push('', `Tests     ${d.passed} passed · ${d.failed} failed · ${d.skipped || 0} to do`, ...testLines(d.list))
  if (outcome.steps.length) {
    if (!counts) lines.push('')
    lines.push('Checks', ...outcome.steps.filter(x => x.data?.applicable !== false).map(stepLine))
  }
  const todo = whatToDo(outcome, { issueType, status: jiraStatus, done: doneStatuses })
  if (todo) lines.push('', `What to do: ${todo}`)
  if (log) lines.push('', `Full details: ${log}`)
  lines.push(`PIPELINE_JSON:${JSON.stringify(outcome)}`)
  return lines.join('\n')
}

const VERDICT_TEXT = {
  green: 'every check passed: the tests run, assert the ticket\'s values and catch changes to them.',
  tests_red: 'the checks passed and some tests fail.',
  checks_failed: 'a check found a problem with the tests themselves; fix the tests, not the code.',
  not_verified: 'something could not run, so nothing was proved. This is never a pass.',
}

/** The developer log: everything the card says, with every finding and number, for a person to read later. */
export function formatRunLog(outcome, { specs = [], key = null, jiraStatus = null, issueType = null, doneStatuses = DEFAULT_DONE_STATUSES, date = new Date() } = {}) {
  const md = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const out = [`# ${key ?? 'Check'}: ${VERDICT[outcome.verdict]}`, '']
  if (outcome.incompleteTicket) out.push(riskLine(outcome.incompleteTicket), '')
  out.push(`- **Checked:** ${date.toISOString()}`, `- **Specs:** ${specs.map(s => `\`${s}\``).join(', ') || 'none'}`)
  if (outcome.runners?.length) out.push(`- **Runners:** ${outcome.runners.map(runnerLabel).join(', ')}`)
  if (jiraStatus) out.push(`- **Jira status:** ${jiraStatus}`)
  out.push(`- **Verdict:** ${VERDICT_TEXT[outcome.verdict] ?? outcome.verdict}${outcome.verdict === 'tests_red' ? ` ${redAdvice({ issueType, status: jiraStatus, done: doneStatuses })}` : ''}`)
  if (finishedButRed(outcome, jiraStatus, doneStatuses)) out.push(`- **Note:** Jira says ${jiraStatus}, but this branch still has the bug.`)
  const t = outcome.steps.find(x => x.check === 'tests')?.data
  if (Array.isArray(t?.list) && t.list.length) {
    out.push('', '## Tests', '', '| Test | Result | Why |', '|---|---|---|')
    for (const x of t.list) out.push(`| ${md(x.title)}${EXTRA.test(x.title) ? ' (extra, not in the ticket)' : ''} | ${x.status} | ${md([x.message, ...contextLines(x.context)].filter(Boolean).join(' · '))} |`)
  }
  out.push('', '## Checks')
  for (const s of outcome.steps) {
    out.push('', `### ${ICON[s.status]} ${label(s.check)}`, '', md(s.summary))
    const nums = Object.entries(s.data ?? {}).filter(([k, v]) => typeof v === 'number' || (Array.isArray(v) && v.length && v.length <= 20 && v.every(x => typeof x === 'string') && k !== 'list'))
    if (nums.length) out.push('', nums.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))
    const fs = (s.findings ?? []).slice(0, 20)
    for (const f of fs) out.push(`- ${[f.runner, f.file, f.test && `'${f.test}'`].filter(Boolean).join(' › ')}${f.kind ? ` [${f.kind}]` : ''}${f.detail ? `: ${md(f.detail)}` : ''}`)
    if ((s.findings ?? []).length > fs.length) out.push(`- …and ${s.findings.length - fs.length} more`)
  }
  const todo = whatToDo(outcome, { issueType, status: jiraStatus, done: doneStatuses })
  if (todo) out.push('', '## What to do', '', todo)
  out.push('', '## Run it again', '', `\`/quality-code:run-pipeline ${specs.join(' ')}${key ? ` --key ${key}` : ''}\``, '')
  return out.join('\n')
}
