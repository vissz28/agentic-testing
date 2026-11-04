// Regression tests for fixed bugs (AGT-169): the proof line, the pipeline option, the routine suite, the prompts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isBug, regressionProof, regressionTitle } from '../../lib/pipeline/regression.mjs'
import { formatCard } from '../../lib/pipeline/card.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('the proof: red before and green now is proved; green before is no proof; red now is pending', () => {
  assert.equal(regressionProof('red', 'green').status, 'proved')
  assert.match(regressionProof('red', 'green').text, /failed before the fix, passes now/)
  assert.equal(regressionProof('green', 'green').status, 'not_proof')
  assert.equal(regressionProof('red', 'tests_red').status, 'waiting')
  assert.equal(regressionProof('red', 'not_verified').status, 'unknown')
  assert.equal(regressionProof(undefined, 'green'), null)
  assert.equal(regressionProof('maybe', 'green'), null)
})
test('the title carries the key once; only Bug tickets count', () => {
  assert.equal(regressionTitle('ABC-1', 'rounds up'), 'ABC-1 rounds up')
  assert.equal(regressionTitle('ABC-1', 'ABC-1 rounds up'), 'ABC-1 rounds up')
  assert.equal(isBug('Bug'), true)
  assert.equal(isBug(' bug '), true)
  assert.equal(isBug('Story'), false)
  assert.equal(isBug(null), false)
})
test('the card shows the proof line after the verdict', () => {
  const outcome = { verdict: 'green', decidedBy: null, steps: [], regression: regressionProof('red', 'green') }
  const lines = formatCard(outcome, { specs: ['a.spec.ts'], key: 'ABC-1' }).split('\n')
  assert.ok(lines.some(l => l.startsWith('Regression proof: failed before the fix, passes now')))
  assert.ok(!formatCard({ ...outcome, regression: undefined }, { specs: ['a.spec.ts'] }).includes('Regression proof'))
})
test('spec and routine point to the guide and the options', () => {
  const spec = read('commands/spec.md')
  assert.ok(spec.includes('guides/regression-from-bug.md'))
  assert.ok(spec.includes('--regression-before'))
  const routine = read('commands/routine.md')
  assert.match(routine, /--regression/)
  assert.match(routine, /@regression/)
  const guide = read('guides/regression-from-bug.md')
  assert.match(guide, /fail before the fix/)
  assert.match(guide, /`@regression`/)
  assert.match(guide, /project's conventions first/)
})
