import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCard } from '../../core/pipeline/card.mjs'

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
