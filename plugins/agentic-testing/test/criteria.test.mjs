import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVocabulary } from '../core/languages/index.mjs'
import * as C from '../core/criteria.mjs'

const v = buildVocabulary(['en', 'it'])
const L = 'The last cost is 0 after a movement with cost 0. The KPI row for that product shows 0 as its last unit cost, and the previous value of 50 is not shown anymore.'

test('150 rule: 149 no, 150 yes', () => {
  assert.equal(C.hasNaturalAC(C.extractNaturalAC(v, `## Acceptance criteria\n${'x'.repeat(149)}.`)), true)
  assert.equal(C.hasNaturalAC(C.extractNaturalAC(v, `## Acceptance criteria\n${'x'.repeat(148)}.`)), false)
})
test('mixed section reads prose and each Then with its And', () => {
  const items = C.extractNaturalAC(v, '## Acceptance criteria\nThe report title is in Italian.\nScenario: z\n  Given a\n  When b\n  Then the last cost is 0\n  And the KPI is updated\nAllora il costo è 0')
  assert.deepEqual(items, ['The report title is in Italian.', 'the last cost is 0', 'the KPI is updated', 'il costo è 0'])
})
test('HTML comments are not criteria', () => {
  assert.deepEqual(C.extractNaturalAC(v, '## Acceptance criteria\n<!--\n"Then it works correctly" fails.\n-->\nThe total is 150.'), ['The total is 150.'])
})
test('section ends at a bare section name', () => {
  assert.equal(C.extractNaturalAC(v, `## Acceptance criteria\n${L}\n\nSteps to reproduce\n1. open`).length, 2)
})
test('AC field needs no heading; prose without heading is nothing', () => {
  assert.equal(C.extractNaturalAC(v, `- ${L}`, { headingless: true }).length, 2)
  assert.equal(C.extractNaturalAC(v, L).length, 0)
})
test('stripVagueCriteria keeps prose outside the section', () => {
  assert.equal(
    C.stripVagueCriteria(v, '## Acceptance criteria\n- The list works correctly\n- The total is 150\nThen it works as expected\n## Notes\nThe old page works correctly'),
    '## Acceptance criteria\n- The total is 150\n## Notes\nThe old page works correctly')
})
test('CRLF text reads the same as LF', () => {
  assert.deepEqual(
    C.extractNaturalAC(v, `## Acceptance criteria\r\n- ${L}\r\n`),
    C.extractNaturalAC(v, `## Acceptance criteria\n- ${L}\n`))
})
test('gherkin needs a Then and two steps', () => {
  assert.equal(C.hasGherkin(v, 'Given a\nWhen b\nThen c'), true)
  assert.equal(C.hasGherkin(v, 'Scenario: x'), false)
})
test('derivable from text counts a Then under the heading once', () => {
  assert.equal(C.countDerivableFromText(v, '## Acceptance criteria\nGiven a product\nWhen I save cost 0\nThen the last cost is 0'), 1)
})
test('derivable from scenarios ignores vague and stub Thens', () => {
  assert.equal(C.countDerivable(v, [{ then: 'shows exactly 5 rows' }, { then: 'as expected' }, { then: 'ok' }]), 1)
})

test('hasThen / hasVaguePhrase / hasHeading', () => {
  assert.equal(C.hasThen(v, 'x\nAllora y'), true)
  assert.equal(C.hasThen(v, 'Given x'), false)
  assert.equal(C.hasVaguePhrase(v, 'it is fine'), true)
  assert.equal(C.hasVaguePhrase(v, ''), false)
  assert.equal(C.hasHeading(v, '## Steps to reproduce\n1. a', v.stepsHeading), true)
  assert.equal(C.hasHeading(v, 'Expected: 5', v.expectedHeading), true)
  assert.equal(C.hasHeading(v, 'no heading expected here', v.expectedHeading), false)
})
test('hasConcreteThen reads strings and objects', () => {
  assert.equal(C.hasConcreteThen(v, 'Given a\nWhen b\nThen the total is 150'), true)
  assert.equal(C.hasConcreteThen(v, 'Given a\nWhen b'), false)
  assert.equal(C.hasConcreteThen(v, { gherkin: 'Then it works correctly' }), false)
  assert.equal(C.hasConcreteThen(v, { expected: 'the total is 150' }), true)
})
test('extractExpectedChunks reads every form, shared regexes keep no state', () => {
  const t = '## Expected\nTotal is 5\n## Other\nWhat is the expected behavior? **zero cost**\nIt shows 7 instead of 0\nThen the last cost is 0'
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(C.extractExpectedChunks(v, t), ['the last cost is 0', 'zero cost', 'Total is 5', '0'])
  }
  assert.deepEqual(C.extractExpectedChunks(v, ''), [])
})
test('constants', () => { assert.equal(C.MIN_NATURAL_AC, 150); assert.equal(C.naturalLength(['ab', 'cd']), 5) })
