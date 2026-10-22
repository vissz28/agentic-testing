import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCard, formatRunLog } from '../../lib/pipeline/card.mjs'

const s = (check, status, summary, findings = [], data = {}) => ({ check, status, summary, findings, data })
const base = [
  s('boundary', 'pass', 'no change outside the boundary'),
  s('honesty', 'pass', 'no assertion or test removed, no skip without a ticket'),
  s('suite-honesty', 'fail', '1 test(s) run but assert nothing', [{ file: 'orders.spec.ts', test: 'cancels', kind: 'hollow test', detail: 'runs but has no expect()' }]),
  s('types', 'pass', 'compiles'),
  s('tests', 'pass', '8 passed', [], { ran: true, passed: 8, failed: 0, skipped: 1 }),
  s('mutation', 'not_run', 'skipped: the tests did not run'),
]

test('the checks-failed card, exactly', () => {
  const out = formatCard({ verdict: 'checks_failed', decidedBy: 'suite-honesty', steps: base }, { specs: ['a.spec.ts', 'b.spec.ts'], key: 'ABC-123' })
  const lines = out.split('\n')
  assert.deepEqual(lines.slice(0, -1), [
    'quality-code check · 2 spec files · ticket ABC-123',
    '',
    'Verdict: ❌ checks failed',
    '',
    'Tests     8 passed · 0 failed · 1 to do',
    'Checks',
    '  ✅ boundary       no change outside the boundary',
    '  ✅ honesty        no assertion or test removed, no skip without a ticket',
    "  ❌ assertions     1 test(s) run but assert nothing: orders.spec.ts › 'cancels'",
    '  ✅ types          compiles',
    '  ✅ tests          8 passed',
    '  ⚠️ mutation       not run: the tests did not run',
    '',
    "What to do: add a real expect(...) to 'cancels', or mark it todo if the behaviour isn't known yet.",
  ])
  assert.ok(lines.at(-1).startsWith('PIPELINE_JSON:'))
  assert.equal(JSON.parse(lines.at(-1).slice(14)).verdict, 'checks_failed')
})
test('verdict lines and one spec without a key', () => {
  const t = v => formatCard({ verdict: v, decidedBy: null, steps: [] }, { specs: ['a.spec.ts'], key: null })
  assert.match(t('green'), /^quality-code check · 1 spec file\n\nVerdict: ✅ green/)
  assert.match(t('not_verified'), /Verdict: ⚠️ not verified/)
  assert.match(t('tests_red'), /Verdict: 🔴 tests red/)
})
test('what to do, per deciding step', () => {
  const card = (decidedBy, step, verdict = 'checks_failed') => formatCard({ verdict, decidedBy, steps: [step] }, { specs: ['a'], key: null }).split('\n').find(l => l.startsWith('What to do:'))
  assert.equal(card('boundary', s('boundary', 'fail', 'x', [{ file: 'src/a.ts' }, { file: '.env' }])), 'What to do: undo the changes to src/a.ts, .env: tests never change application code.')
  assert.equal(card('honesty', s('honesty', 'fail', 'x')), 'What to do: restore the removed assertion or test, or name a ticket on the skip.')
  assert.equal(card('types', s('types', 'fail', 'a.ts(1,1): error TS1')), 'What to do: fix the compile error: a.ts(1,1): error TS1')
  assert.equal(card('mutation', s('mutation', 'fail', 'x', [{ test: 'adds' }, { test: 'subs' }])), "What to do: an assertion can't fail: bind the real expected value in 'adds', 'subs'.")
  assert.equal(card('flaky', s('flaky', 'fail', 'x', [{ test: 'a > t' }])), "What to do: fix the non-determinism in 'a > t', or skip them with a ticket.")
  assert.equal(card('tests', s('tests', 'fail', 'x', [{ test: 'adds', detail: 'Expected 2' }]), 'tests_red'), "What to do: 'adds': Expected 2. For a bug whose fix isn't merged yet, red is the expected result.")
  assert.equal(card('tests', s('tests', 'not_run', 'could not run: db down'), 'not_verified'), 'What to do: tests could not run: could not run: db down')
  assert.equal(formatCard({ verdict: 'green', decidedBy: null, steps: [] }, { specs: ['a'] }).includes('What to do'), false)
})
test('a failing test with an empty message gives no dangling colon', () => {
  const out = formatCard({ verdict: 'tests_red', decidedBy: 'tests', steps: [s('tests', 'fail', 'x', [{ test: 'adds', detail: '' }])] }, { specs: ['a'] })
  assert.ok(out.includes("What to do: 'adds'. For a bug whose fix isn't merged yet, red is the expected result."))
  assert.ok(!out.includes("'adds': ."))
})
test('a not-applicable boundary line is hidden from the card; an applicable one stays', () => {
  const na = s('boundary', 'pass', 'not applicable: not a test-writing run', [], { applicable: false })
  const out = formatCard({ verdict: 'green', decidedBy: null, steps: [na, s('honesty', 'pass', 'ok')] }, { specs: ['a'] })
  assert.ok(!out.split('\n').slice(0, -1).join('\n').includes('boundary'))
  assert.ok(out.includes('  ✅ honesty'))
  assert.ok(formatCard({ verdict: 'green', decidedBy: null, steps: [s('boundary', 'pass', 'ok', [], { applicable: true })] }, { specs: ['a'] }).includes('  ✅ boundary'))
})
test('a skipped step is not shown as "not run: skipped:" in what to do either', () => {
  const out = formatCard({ verdict: 'not_verified', decidedBy: 'mutation', steps: [s('mutation', 'not_run', 'skipped: the tests did not run')] }, { specs: ['a'] })
  assert.ok(out.includes('What to do: mutation could not run: the tests did not run'))
})
test('not verified uses the step summary generically, including a never-ran file', () => {
  const step = s('tests', 'not_run', '1 file(s) never ran: x.spec.ts: boom', [{ file: 'x.spec.ts', kind: 'never ran', detail: 'boom' }])
  const out = formatCard({ verdict: 'not_verified', decidedBy: null, steps: [step] }, { specs: ['x.spec.ts'], key: null })
  assert.ok(out.includes('What to do: tests could not run: 1 file(s) never ran: x.spec.ts: boom'))
  assert.ok(out.includes('  ⚠️ tests          not run: 1 file(s) never ran'))
})

test('what to do for expected and stryker; a not-applicable stryker line is hidden', () => {
  const exp = s('expected', 'fail', '1 of 2 expected value(s) from the ticket not asserted', [{ kind: 'expected value not asserted', token: '1.234,50', then: 'the total is 1.234,50', detail: '1.234,50 (from "the total is 1.234,50")' }])
  const out = formatCard({ verdict: 'checks_failed', decidedBy: 'expected', steps: [exp] })
  assert.match(out, /What to do: assert the ticket's expected value 1\.234,50 \(from "the total is 1\.234,50"\)/)
  assert.match(out, /❌ expected {7}1 of 2 expected value\(s\)/)
  const st = s('stryker', 'fail', '40% of code changes caught, the bar is 60%', [{ file: 'src/price.ts', kind: 'code changes not caught' }], { applicable: true, target: 'src/price.ts' })
  assert.match(formatCard({ verdict: 'checks_failed', decidedBy: 'stryker', steps: [st] }), /What to do: the tests miss changes in src\/price\.ts: assert the values the code computes/)
  const na = s('stryker', 'pass', 'not applicable: no target file', [], { applicable: false })
  assert.doesNotMatch(formatCard({ verdict: 'green', decidedBy: null, steps: [na] }).split('\n').slice(0, -1).join('\n'), /stryker/)
  assert.match(formatCard({ verdict: 'green', decidedBy: null, steps: [{ ...na, summary: '80% of code changes caught (bar 60%)', data: { applicable: true } }] }), /✅ stryker/)
})

const RISK = '🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (45/70)'
test('continue anyway: the risk line is the first line after the title, for every verdict; the verdict is unchanged', () => {
  for (const verdict of ['green', 'checks_failed', 'tests_red', 'not_verified']) {
    const out = formatCard({ verdict, decidedBy: null, steps: base, incompleteTicket: { score: 45, bar: 70 } }, { specs: ['a.spec.ts'], key: 'ABC-1' })
    const lines = out.split('\n')
    assert.equal(lines[0], 'quality-code check · 1 spec file · ticket ABC-1')
    assert.equal(lines[1], RISK, verdict)
    assert.equal(lines[2], '')
    assert.match(lines[3], /^Verdict: /)
    const plain = formatCard({ verdict, decidedBy: null, steps: base }, { specs: ['a.spec.ts'], key: 'ABC-1' }).split('\n')
    assert.deepEqual(lines.slice(3, -1), plain.slice(2, -1), 'the rest of the card is the same')
  }
})
test('without incompleteTicket there is no risk line', () => {
  assert.doesNotMatch(formatCard({ verdict: 'green', decidedBy: null, steps: base }, { specs: ['a.spec.ts'] }), /RISK/)
})
test('color: true makes the risk line red in a terminal; the default has no escape codes', () => {
  const o = { verdict: 'green', decidedBy: null, steps: base, incompleteTicket: { score: 45, bar: 70 } }
  assert.equal(formatCard(o, { specs: ['a.spec.ts'], color: true }).split('\n')[1], `\x1b[31m${RISK}\x1b[0m`)
  assert.doesNotMatch(formatCard(o, { specs: ['a.spec.ts'] }), /\x1b/)
})

const listed = list => ({ verdict: list.some(t => t.status === 'failed') ? 'tests_red' : 'green', decidedBy: 'tests', steps: [
  { check: 'tests', status: list.some(t => t.status === 'failed') ? 'fail' : 'pass', summary: 's', findings: list.filter(t => t.status === 'failed').map(t => ({ test: t.title, detail: t.message })), data: { ran: true, passed: list.filter(t => t.status === 'passed').length, failed: list.filter(t => t.status === 'failed').length, skipped: 0, list } },
] })

test('card: one line per test; the ticket\'s tests first, the extra probes after, a red one says why', () => {
  const card = formatCard(listed([
    { title: 'shows the total', status: 'passed' },
    { title: 'applies the discount', status: 'failed', message: 'Expected "€ 108,00", received "€ 120,00"' },
    { title: 'Extra: a long product name', status: 'passed' },
  ]), { specs: ['e2e/a.spec.ts'], key: 'ABC-1' })
  assert.ok(card.includes([
    'Tests     2 passed · 1 failed · 0 to do',
    '  From the ticket',
    '    ✓ shows the total',
    '    ✗ applies the discount: Expected "€ 108,00", received "€ 120,00"',
    '  Extra (not in the ticket)',
    '    ✓ Extra: a long product name',
  ].join('\n')), card)
  const plain = formatCard(listed([{ title: 'adds', status: 'passed' }]), { specs: ['a.spec.ts'] })
  assert.ok(plain.includes('Tests     1 passed · 0 failed · 0 to do\n  ✓ adds'), 'no extra probe: no headings')
})

test('card: a red run on a ticket Jira calls finished says the bug is still there; the log line', () => {
  const red = listed([{ title: 'rounds', status: 'failed', message: 'Expected 0.23' }])
  assert.match(formatCard(red, { jiraStatus: 'Test OK' }), /\nJira says Test OK\. This branch still has the bug\.\n/)
  assert.doesNotMatch(formatCard(red, { jiraStatus: 'In Progress' }), /Jira says/)
  assert.doesNotMatch(formatCard(listed([{ title: 'rounds', status: 'passed' }]), { jiraStatus: 'Done' }), /Jira says/)
  assert.match(formatCard(red, { log: '.claude/quality-code/tickets/ABC-1/run.md' }), /\n\nFull details: \.claude\/quality-code\/tickets\/ABC-1\/run\.md\nPIPELINE_JSON:/)
})

test('run log: verdict in words, the tests table, every check with its numbers and findings, the re-run line', () => {
  const outcome = { verdict: 'checks_failed', decidedBy: 'mutation', steps: [
    listed([{ title: 'adds | sums', status: 'passed' }]).steps[0],
    { check: 'mutation', status: 'fail', summary: '1 of 2 mutant(s) survived', findings: [{ file: 'a.spec.ts', test: 'adds', kind: 'survived', detail: 'expect(x).toBeDefined()' }], data: { killed: 1, survived: 1, total: 2, survivors: ['expect(x).toBeDefined()'] } },
  ] }
  const log = formatRunLog(outcome, { specs: ['a.spec.ts'], key: 'ABC-1', jiraStatus: 'In Progress', date: new Date('2026-10-16T10:00:00Z') })
  assert.ok(log.startsWith('# ABC-1: ❌ checks failed\n'))
  assert.ok(log.includes('- **Jira status:** In Progress'))
  assert.ok(log.includes('- **Verdict:** a check found a problem with the tests themselves; fix the tests, not the code.'))
  assert.ok(log.includes('| adds \\| sums | passed |  |'), 'a | in a title is escaped')
  assert.ok(log.includes('### ❌ mutation\n\n1 of 2 mutant(s) survived\n\nkilled: 1 · survived: 1 · total: 2 · survivors: expect(x).toBeDefined()'))
  assert.ok(log.includes("- a.spec.ts › 'adds' [survived]: expect(x).toBeDefined()"))
  assert.ok(log.includes('## What to do'))
  assert.ok(log.includes('`/quality-code:check a.spec.ts --key ABC-1`'))
})
