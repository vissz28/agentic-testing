import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVocabulary } from '../core/languages/index.mjs'
import { normalise, alt } from '../core/text.mjs'

const v = buildVocabulary(['en', 'it'])
const yes = (re, s) => assert.ok(re.test(s), `${re} should match ${JSON.stringify(s)}`)
const no = (re, s) => assert.ok(!re.test(s), `${re} should not match ${JSON.stringify(s)}`)

test('gherkin steps EN+IT', () => {
  for (const s of ['Given a', '  When b', 'Then c', 'Dato a', 'Quando b', 'Allora c']) yes(v.gherkinStep, s)
  no(v.gherkinStep, 'Thenceforth')
})
test('criteria headings', () => {
  for (const s of ['## Acceptance criteria', '**Criteri di accettazione:**', 'AC:', 'Acceptance criteria']) yes(v.acHeading, s)
  no(v.acHeading, '## Actual')
})
test('section end', () => {
  for (const s of ['## Notes', '**Expected**', 'Expected result', 'Steps to reproduce', 'Risultato atteso', 'Short label:']) yes(v.sectionEnd, s)
  no(v.sectionEnd, 'The total is 150.')
})
test('vague words', () => {
  for (const s of ['it works correctly', 'working correctly', 'as expected', 'is fine', 'funziona correttamente', 'come previsto', 'come atteso']) yes(v.vague, s)
  no(v.vague, 'the total is 150')
})
test('english only drops Italian', () => {
  const en = buildVocabulary(['en'])
  no(en.gherkinStep, 'Dato a')
  no(en.vague, 'funziona correttamente')
  yes(en.gherkinStep, 'Given a')
})
test('backend question forms', () => {
  yes(v.expectedPhrase, 'What is the expected behavior?')
  yes(v.actualPhrase, 'Cosa succede?')
})
test('normalise CRLF', () => {
  assert.equal(normalise('a\r\nb\rc'), 'a\nb\nc')
  assert.equal(normalise(null), '')
  assert.equal(normalise(undefined), '')
})
test('alt joins sources', () => {
  assert.equal(alt(['a', 'b\\s+c']), 'a|b\\s+c')
})
test('unknown language throws', () => {
  assert.throws(() => buildVocabulary(['fr']), /not supported/)
})

// --- Equivalence with the regex literals used by the scorers before the packs existed. ---
const same = (name, srcRe, built, cases) => test(`equivalence: ${name}`, () => {
  for (const [s, want] of cases) {
    // fresh non-global copies, so lastIndex never leaks between cases
    const a = new RegExp(srcRe.source, srcRe.flags.replace('g', ''))
    const b = new RegExp(built.source, built.flags.replace('g', ''))
    assert.equal(a.test(s), want, `source ${srcRe} on ${JSON.stringify(s)}`)
    assert.equal(b.test(s), want, `built ${built} on ${JSON.stringify(s)}`)
  }
})

same('gherkinStep', /^\s*(?:given|when|then|dato|quando|allora)\b/im, v.gherkinStep, [
  ['Given a', true], ['x\n  quando b', true], ['ALLORA c', true], ['Thenceforth', false], ['and then', false], ['E poi', false],
])
test('equivalence: gherkinStepAll counts steps', () => {
  const text = 'Given a\nWhen b\nThen c\nAnd d\nDato e\nplain'
  const src = /^\s*(?:given|when|then|dato|quando|allora)\b/gim
  assert.equal((text.match(v.gherkinStepAll) || []).length, (text.match(src) || []).length)
  assert.equal((text.match(v.gherkinStepAll) || []).length, 4)
})
same('thenLine', /^\s*(?:then|allora)\b/im, v.thenLine, [
  ['Then x', true], ['a\nAllora x', true], ['Given x', false], ['thenx', false], ['and then', false],
])
test('equivalence: thenLineCapture captures the rest of the line', () => {
  assert.equal('Then total is 5'.match(v.thenLineCapture)[1], ' total is 5')
  assert.equal('x\nAllora ok'.match(v.thenLineCapture)[1], ' ok')
  assert.equal('Given x'.match(v.thenLineCapture), null)
})
test('equivalence: thenAndLines selects then/allora/and lines', () => {
  const text = 'Given a\nThen b\nAnd c\nAllora d\nBut e\nE f\nandroid'
  const src = /^\s*(?:then|allora|and)\b.*/gim
  assert.deepEqual(text.match(v.thenAndLines), text.match(src))
  assert.deepEqual(text.match(v.thenAndLines), ['Then b', 'And c', 'Allora d'])
})
same('acHeading', /^\s*(?:#{1,6}\s*)?(?:\*\*\s*)?(?:acceptance\s+criteria|criteri\s+di\s+accettazione|AC)\b\s*:?\s*(?:\*\*)?\s*:?\s*$/i, v.acHeading, [
  ['## Acceptance criteria', true], ['**Criteri di accettazione:**', true], ['AC:', true], ['ac', true],
  ['Acceptance criteria are below', false], ['## Actual', false],
])
same('listItem', /^\s*(?:[-*•]|\d+[.)])\s+/, v.listItem, [
  ['- a', true], ['  * b', true], ['• c', true], ['1. d', true], ['2) e', true], ['-a', false], ['plain', false],
])
same('thenStep', /^\s*(?:then|allora)\b\s*(.*)$/i, v.thenStep, [
  ['Then x', true], ['allora y', true], ['Given z', false], ['Thence', false], ['And x', false],
])
same('setupStep', /^\s*(?:scenario(?: outline)?|feature|background|examples|esempi|given|when|dato|quando)\b/i, v.setupStep, [
  ['Scenario: a', true], ['Scenario Outline: a', true], ['Esempi:', true], ['  Dato x', true], ['Then x', false], ['Features', false],
])
same('continuation', /^\s*(?:and|but|e|ma)\b\s*(.*)$/i, v.continuation, [
  ['And x', true], ['But y', true], ['E z', true], ['ma w', true], ['Then x', false], ['Android', false], ['era', false],
])
same('sectionEnd', /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*:?\s*$|[^\s:][^:]{0,40}:\s*$|(?:summary|context|contesto|sommario|steps to reproduce|passi per riprodurre|expected(?: result| behaviou?r)?|actual(?: result)?|risultato atteso|risultato effettivo|comportamento attuale|environment|ambiente|notes?|impact|impatto|user story|storia utente|out of scope|fuori ambito)\s*$)/i, v.sectionEnd, [
  ['## Notes', true], ['**Expected**', true], ['Risultato atteso', true], ['Fuori ambito', true], ['Short label:', true],
  ['The total is 150.', false], ['Notes about this', false],
])
same('vague', /\b(works?\s+correctly|working\s+correctly|as\s+expected|is\s+fine|funziona\s+correttamente|come\s+previsto|come\s+atteso)\b/i, v.vague, [
  ['it works correctly', true], ['working correctly', true], ['as expected', true], ['funziona correttamente', true],
  ['come atteso', true], ['the total is 150', false], ['fine print', false],
])

// Heading sources are used inside larger regexes by the callers; compare them as plain regexes.
// hasHeading builds them with the 'i' flag, so both sides are compared case-insensitively.
const srcCases = (name, srcRe, source, cases) =>
  same(name, new RegExp(srcRe.source, 'i'), new RegExp(source, 'i'), cases)
srcCases('stepsHeading', /steps to reproduce|passi per riprod\w*/, v.stepsHeading, [
  ['Steps to reproduce', true], ['Passi per riprodurre', true], ['Passi per riprodurlo', true], ['steps', false], ['passi', false],
])
srcCases('userStoryHeading', /user story|storia utente/, v.userStoryHeading, [
  ['User story', true], ['Storia utente', true], ['story', false], ['utente', false],
])
srcCases('expectedHeading', /expected|risultato atteso/, v.expectedHeading, [
  ['Expected', true], ['Risultato atteso', true], ['atteso', false], ['result', false],
])
srcCases('actualHeading', /actual|risultato effettivo|comportamento attuale/, v.actualHeading, [
  ['Actual', true], ['Risultato effettivo', true], ['Comportamento attuale', true], ['effettivo', false], ['current', false],
])
srcCases('environmentHeading', /environment|ambiente/, v.environmentHeading, [
  ['Environment', true], ['Ambiente', true], ['env', false], ['ambient', false],
])
srcCases('contextHeadingFE', /context|summary|contesto|impact|impatto/, v.contextHeadingFE, [
  ['Context', true], ['Summary', true], ['Contesto', true], ['Impact', true], ['Impatto', true], ['Sommario', false],
])
srcCases('contextHeadingBE', /context|summary|contesto|sommario/, v.contextHeadingBE, [
  ['Context', true], ['Summary', true], ['Contesto', true], ['Sommario', true], ['Impatto', false], ['Impact', false],
])
test('equivalence: userStoryLine', () => {
  const src = [/\bas an?\b[^\n]*\bi want\b/i, /\bcome\b[^\n]*\bvoglio\b/i]
  for (const [s, want] of [
    ['As a user I want x', true], ['as an admin, I want y', true], ['Come utente voglio z', true],
    ['As a user\nI want x', false], ['I want x', false], ['voglio x', false],
  ]) {
    assert.equal(src.some(r => r.test(s)), want)
    assert.equal(v.userStoryLine.some(r => r.test(s)), want, JSON.stringify(s))
  }
})
same('expectedPhrase', /\bexpected\s+(?:behavio(?:u)?r|result|outcome|value)\b|\bcomportamento\s+atteso\b|\brisultato\s+atteso\b/i, v.expectedPhrase, [
  ['The expected behaviour is x', true], ['expected result', true], ['Expected value', true], ['comportamento atteso', true],
  ['risultato atteso', true], ['expected', false], ['unexpected results', false],
])
same('actualPhrase', /\bwhat\s+happens\b|\bcosa\s+succede\b|\bcurrent\s+behavio(?:u)?r\b/i, v.actualPhrase, [
  ['What happens?', true], ['Cosa succede?', true], ['current behaviour', true], ['current behavior', true],
  ['whatever happens', false], ['actual result', false],
])
same('contextPhrase', /\bwhat\s+happens\b|\bcosa\s+succede\b/i, v.contextPhrase, [
  ['What happens?', true], ['Cosa succede?', true], ['whatever happens', false], ['current behaviour', false],
])
same('listOrStep', /^(?:[-*•]\s|\d+[.)]\s|(?:scenario|given|when|then|and|but|dato|quando|allora|e|ma)\b)/i, v.listOrStep, [
  ['- a', true], ['1. b', true], ['Scenario: c', true], ['Allora d', true], ['Ma e', true], ['E f', true],
  ['plain text', false], ['  - indented', false], ['Android', false],
])

// Backend expected-chunk regexes (global: compare via fresh copies / matchAll).
test('equivalence: expectedQuestion', () => {
  const src = /(?:what is the expected behavio(?:u)?r\??|qual è il comportamento atteso\??)\s*[:*]?\s*(.*)$/gim
  for (const s of ['What is the expected behavior? **Total 5**', 'Qual è il comportamento atteso: zero', 'x\nwhat is the expected behaviour?\nnext', 'nothing here']) {
    assert.deepEqual([...s.matchAll(v.expectedQuestion)].map(m => m[1]), [...s.matchAll(src)].map(m => m[1]), JSON.stringify(s))
  }
  assert.equal(v.expectedQuestion.flags, 'gim')
})
test('equivalence: expectedSection', () => {
  const src = /^(?:#{1,6}\s*|\*\*\s*)(?:expected|risultato atteso)\b[^\n]*$/gim
  for (const s of ['## Expected\nx', '**Risultato atteso**\nx', 'Expected\nx', '## Expectedly', '  ## Expected', '### expected result']) {
    assert.deepEqual([...s.matchAll(v.expectedSection)].map(m => m[0]), [...s.matchAll(src)].map(m => m[0]), JSON.stringify(s))
  }
  assert.equal(v.expectedSection.flags, 'gim')
})
test('equivalence: insteadOf', () => {
  const src = /(?:instead of|invece di)\s+([+\u2212-]?\d+(?:[.,]\d+)?)/gi
  for (const s of ['shows 5 instead of 0', 'invece di -3,5 e INSTEAD OF +2', 'instead of nothing', 'instead of \u22121']) {
    assert.deepEqual([...s.matchAll(v.insteadOf)].map(m => m[1]), [...s.matchAll(src)].map(m => m[1]), JSON.stringify(s))
  }
  assert.equal(v.insteadOf.flags, 'gi')
})
test('english only drops Italian backend phrases', () => {
  const en = buildVocabulary(['en'])
  assert.equal([...'invece di 5'.matchAll(en.insteadOf)].length, 0)
  assert.equal([...'## Risultato atteso'.matchAll(en.expectedSection)].length, 0)
})
