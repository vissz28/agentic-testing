import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVocabulary } from '../../lib/ticket/languages/index.mjs'
import * as C from '../../lib/ticket/criteria.mjs'

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
test('stripVagueCriteria keeps the original line ends (it rewrites the stored ticket)', () => {
  const crlf = '## Acceptance criteria\r\n- The list works correctly\r\n- The total is 150\r\n## Notes\r\nThe old page works correctly'
  assert.equal(C.stripVagueCriteria(v, crlf), '## Acceptance criteria\r\n- The total is 150\r\n## Notes\r\nThe old page works correctly')
  assert.equal(C.stripVagueCriteria(v, 'Given a\r\nThen it works correctly\r\nThen 5 rows'), 'Given a\r\nThen 5 rows')
  assert.equal(C.stripVagueCriteria(v, 'Then 5 rows\r\n'), 'Then 5 rows\r\n', 'nothing vague: unchanged byte for byte')
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
test('Gherkin and Then inside an HTML comment are not criteria (spec §10 #7)', () => {
  const hidden = '## Acceptance criteria\n<!-- example:\nScenario: s\nGiven a list of 8 orders\nWhen I filter by customer Rossi\nThen the grid shows exactly 5 rows -->'
  assert.equal(C.hasGherkin(v, hidden), false)
  assert.equal(C.hasThen(v, hidden), false)
  assert.equal(C.countDerivableFromText(v, hidden), 0)
  const shown = hidden.replace('<!-- example:', '').replace(' -->', '')
  assert.equal(C.hasGherkin(v, shown), true)
  assert.equal(C.hasThen(v, shown), true)
})

// spec §10 #10: plain criteria that start with a Gherkin keyword count as plain criteria.
const WHEN_EN = 'When a user enters a quantity above the maximum allowed in the order drawer, the field shows the error "Quantity too high" and the Save button stays disabled. The orders page keeps working and no order is created.'
const WHEN_IT = 'Quando un utente inserisce una quantità oltre il massimo consentito nel pannello ordine, il campo mostra l\'errore "Quantità troppo alta" e il pulsante Salva resta disattivato. La pagina ordini continua a funzionare e nessun ordine viene creato.'
const IF_EN = WHEN_EN.replace(/^When/, 'If')

test('a plain sentence starting with When counts like one starting with If (en, description, bullet and no bullet)', async () => {
  const { acSignals } = await import('../../lib/ticket/rubrics/shared.mjs')
  for (const body of [`- ${WHEN_EN}`, WHEN_EN]) {
    const desc = `## Acceptance criteria\n${body}`
    assert.ok(C.naturalLength(C.extractNaturalAC(v, desc)) >= C.MIN_NATURAL_AC, body.slice(0, 10))
    assert.equal(acSignals(v, desc, '').ac_present, true, body.slice(0, 10))
    assert.deepEqual(acSignals(v, desc, ''), acSignals(v, `## Acceptance criteria\n${body.replace('When', 'If')}`, ''))
  }
  assert.equal(acSignals(v, `## Acceptance criteria\n${IF_EN}`, '').ac_present, true)
})
test('a plain sentence starting with Quando counts (it, AC field, bullet and no bullet)', async () => {
  const { acSignals } = await import('../../lib/ticket/rubrics/shared.mjs')
  const vIt = buildVocabulary(['it'])
  for (const body of [`- ${WHEN_IT}`, WHEN_IT]) {
    assert.ok(C.naturalLength(C.extractNaturalAC(vIt, body, { headingless: true })) >= C.MIN_NATURAL_AC, body.slice(0, 10))
    assert.equal(acSignals(vIt, '', body).ac_present, true, body.slice(0, 10))
    assert.equal(acSignals(vIt, `## Criteri di accettazione\n${body}`, '').ac_present, true, body.slice(0, 10))
  }
})
test('R37: of a Given and a When without a Then, only the sentence with a result is prose (en)', () => {
  assert.deepEqual(C.extractNaturalAC(v, `- ${WHEN_EN}`, { headingless: true }), C.extractNaturalAC(v, `- ${IF_EN}`, { headingless: true }).map((s, i) => i ? s : s.replace(/^If/, 'When')))
  assert.deepEqual(C.extractNaturalAC(v, 'Given an empty cart\nWhen the user opens it, the page says "Empty".', { headingless: true }),
    ['When the user opens it, the page says "Empty".'])
})
test('a real Given/When/Then scenario is still read as Gherkin, bulleted or not', () => {
  const scenario = 'Scenario: s\nGiven a list of 8 orders\nWhen I filter by customer\nThen the grid shows exactly 5 rows\nAnd the counter reads 5'
  assert.deepEqual(C.extractNaturalAC(v, `## Acceptance criteria\n${scenario}`), ['the grid shows exactly 5 rows', 'the counter reads 5'])
  assert.deepEqual(C.extractNaturalAC(v, scenario.split('\n').map(l => `- ${l}`).join('\n'), { headingless: true }), ['the grid shows exactly 5 rows', 'the counter reads 5'])
  assert.deepEqual(C.extractNaturalAC(v, 'Dato un elenco\nQuando filtro\nAllora vedo 5 righe', { headingless: true }), ['vedo 5 righe'])
})
test('mixed section: a plain When sentence and a separate real scenario', () => {
  const desc = `## Acceptance criteria\n- ${WHEN_EN}\n\nScenario: s\nGiven a list of 8 orders\nWhen I filter by customer\nThen the grid shows exactly 5 rows`
  const items = C.extractNaturalAC(v, desc)
  assert.equal(items[0], WHEN_EN.split(/(?<=[.!?])\s+/)[0])
  assert.ok(!items.includes('Given a list of 8 orders') && !items.includes('When I filter by customer'))
  assert.equal(items.at(-1), 'the grid shows exactly 5 rows')
})
test('vague words still fail a plain When sentence', async () => {
  const { acSignals } = await import('../../lib/ticket/rubrics/shared.mjs')
  const vagueWhen = `## Acceptance criteria\n- When a user enters a quantity above the maximum allowed in the order drawer, the page works correctly and the Save button stays disabled for every order in the list.`
  assert.deepEqual(acSignals(v, vagueWhen, ''), { ac_present: true, ac_testable: false })
})

// Round 3. Gherkin with a data table or a doc string, and no Scenario header, is still Gherkin:
// these outputs are pinned to what the scorer gave before spec §10 #10 (commit a0a8955).
const TABLE = 'Given the following orders exist in the list\n| id | qty |\n| 1 | 5 |\nWhen I filter by quantity 5\nThen the grid shows exactly 5 rows'
const TABLE_COMMA = TABLE.replace('exist in the list', 'exist, two of them shipped')
const DOC = 'Given an order with this note\n"""\nShip before noon\n"""\nWhen I open the order\nThen the note reads "Ship before noon"'
const DOC_TICKS = DOC.replaceAll('"""', '```')
const DOC_COMMA = DOC.replace('this note', 'this note, written by the customer')
const TABLE_VAGUE = TABLE.replace('in the list', 'as expected')
const signalsOf = async (desc, acField) => (await import('../../lib/ticket/rubrics/shared.mjs')).acSignals(v, desc, acField)
for (const [name, g, items] of [
  ['a data table', TABLE, ['| id | qty |', '| 1 | 5 |', 'the grid shows exactly 5 rows']],
  ['a data table after a Given with a comma', TABLE_COMMA, ['| id | qty |', '| 1 | 5 |', 'the grid shows exactly 5 rows']],
  ['a """ doc string', DOC, ['"""', 'Ship before noon', '"""', 'the note reads "Ship before noon"']],
  ['a ``` doc string', DOC_TICKS, ['```', 'Ship before noon', '```', 'the note reads "Ship before noon"']],
  ['a doc string after a Given with a comma', DOC_COMMA, ['"""', 'Ship before noon', '"""', 'the note reads "Ship before noon"']],
]) {
  test(`Gherkin with ${name} reads as before §10 #10, in the description and in the AC field`, async () => {
    const desc = `## Acceptance criteria\n${g}`
    assert.deepEqual(C.extractNaturalAC(v, desc), items)
    assert.deepEqual(C.extractNaturalAC(v, g, { headingless: true }), items)
    assert.equal(C.countDerivableFromText(v, desc), 2)
    assert.deepEqual(await signalsOf(desc, ''), { ac_present: true, ac_testable: true })
    assert.deepEqual(await signalsOf('', g), { ac_present: true, ac_testable: true })
  })
}
test('a vague Given above a data table does not make the criteria vague (as before §10 #10)', async () => {
  assert.deepEqual(await signalsOf(`## Acceptance criteria\n${TABLE_VAGUE}`, ''), { ac_present: true, ac_testable: true })
  assert.deepEqual(await signalsOf('', TABLE_VAGUE), { ac_present: true, ac_testable: true })
  assert.equal(C.countDerivableFromText(v, `## Acceptance criteria\n${TABLE_VAGUE}`), 2)
})

// Ruling R37: a stray Given / When / And line is plain criteria only when it states a result:
// after the keyword, a comma followed by more text. Bare steps without a Then earn nothing.
const FILLER_GIVEN_WHEN = '- Given an order list that holds forty orders from three different customers in the current month\n- Given the user is signed in as a sales manager with read access\n- When the user opens the orders page from the menu'
const FILLER_WHEN = '- When the user opens the orders page from the main menu\n- When the user filters the list by the customer name\n- When the user sorts the orders by their creation date'
test('R37: bare Given / When steps without a Then are setup and earn nothing', async () => {
  for (const filler of [FILLER_GIVEN_WHEN, FILLER_WHEN]) {
    assert.deepEqual(C.extractNaturalAC(v, `## Acceptance criteria\n${filler}`), [])
    assert.deepEqual(await signalsOf(`## Acceptance criteria\n${filler}`, ''), { ac_present: false, ac_testable: false })
    assert.deepEqual(await signalsOf('', filler), { ac_present: false, ac_testable: false })
  }
})
test('R37: a lone "When it loads" / "Quando la pagina si carica" adds nothing to derivable', () => {
  assert.equal(C.countDerivableFromText(v, '## Acceptance criteria\nWhen it loads'), 0)
  assert.equal(C.countDerivableFromText(v, '## Criteri di accettazione\nQuando la pagina si carica'), 0)
})
test('R37: a step-word sentence with a comma and a result is prose (en and it)', () => {
  assert.deepEqual(C.extractNaturalAC(v, 'When the list loads, the counter reads 5.', { headingless: true }), ['When the list loads, the counter reads 5.'])
  assert.deepEqual(C.extractNaturalAC(v, 'Quando la lista si carica, il contatore mostra 5.', { headingless: true }), ['Quando la lista si carica, il contatore mostra 5.'])
  assert.deepEqual(C.extractNaturalAC(v, 'When the list loads,', { headingless: true }), [])
})

// Review of R37: an And line after a "When X, Y" sentence is a bare step unless it states a result
// itself, and a comma inside a number ("2,5 kg", "1,000") is not a result (Ruling R38).
test('R37: bare And / E lines after a result sentence stay setup', async () => {
  const and = 'When it loads, ok\nAnd the user opens the orders page from the main menu\nAnd the user filters the list by the customer name\nAnd the user sorts the orders by their creation date'
  assert.deepEqual(C.extractNaturalAC(v, and, { headingless: true }), ['When it loads, ok'])
  assert.deepEqual(await signalsOf('', and), { ac_present: false, ac_testable: false })
  const e = 'Quando la pagina si carica, ok\nE l\'utente apre la pagina ordini dal menu principale\nE l\'utente filtra la lista per nome del cliente'
  assert.deepEqual(C.extractNaturalAC(v, e, { headingless: true }), ['Quando la pagina si carica, ok'])
})
test('R38: a comma inside a number is not a result', async () => {
  const dec = 'Quando l\'utente inserisce 2,5 kg nel campo quantità della riga ordine\nQuando l\'utente inserisce 1,000 pezzi nel campo quantità della seconda riga\nQuando l\'utente salva la bozza'
  assert.deepEqual(C.extractNaturalAC(v, dec, { headingless: true }), [])
  assert.deepEqual(await signalsOf('', dec), { ac_present: false, ac_testable: false })
  assert.deepEqual(C.extractNaturalAC(v, 'When the user enters 2,5 kg, the total reads 2,5 kg.', { headingless: true }), ['When the user enters 2,5 kg, the total reads 2,5 kg.'])
})
