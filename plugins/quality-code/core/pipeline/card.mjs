const LABEL = { 'suite-honesty': 'assertions' }
const ICON = { pass: '✅', fail: '❌', not_run: '⚠️' }
const VERDICT = { green: '✅ green', checks_failed: '❌ checks failed', not_verified: '⚠️ not verified', tests_red: '🔴 tests red' }

const label = check => LABEL[check] || check
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

function whatToDo(outcome) {
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
      return `'${f.test}'${f.detail ? `: ${f.detail}` : ''}. For a bug whose fix isn't merged yet, red is the expected result.`
    }
    default: return null
  }
}

/** The mark a run forced past the readiness gate carries ("continue anyway"). Red in a terminal. */
export function riskLine({ score, bar }, color = false) {
  const text = `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (${score}/${bar})`
  return color ? `\x1b[31m${text}\x1b[0m` : text
}

export function formatCard(outcome, { specs = [], key = null, color = false } = {}) {
  const n = specs.length
  const sides = outcome.runners?.length ? ` · ${outcome.runners.map(r => ({ vitest: 'Vitest', playwright: 'Playwright' })[r] ?? r).join(' + ')}` : ''
  const lines = [`quality-code check · ${n} spec file${n === 1 ? '' : 's'}${sides}${key ? ` · ticket ${key}` : ''}`]
  if (outcome.incompleteTicket) lines.push(riskLine(outcome.incompleteTicket, color))
  lines.push('', `Verdict: ${VERDICT[outcome.verdict]}`)
  const d = (outcome.steps.find(x => x.check === 'tests') || {}).data
  const counts = d && typeof d.passed === 'number' && typeof d.failed === 'number'
  if (counts) lines.push('', `Tests     ${d.passed} passed · ${d.failed} failed · ${d.skipped || 0} to do`)
  if (outcome.steps.length) {
    if (!counts) lines.push('')
    lines.push('Checks', ...outcome.steps.filter(x => x.data?.applicable !== false).map(stepLine))
  }
  const todo = whatToDo(outcome)
  if (todo) lines.push('', `What to do: ${todo}`)
  lines.push(`PIPELINE_JSON:${JSON.stringify(outcome)}`)
  return lines.join('\n')
}
