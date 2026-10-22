import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { buildBrief } from '../../lib/ticket/score.mjs'
import { messagesFor } from '../../lib/ticket/messages.mjs'
import { buildVocabulary } from '../../lib/ticket/languages/index.mjs'
import { stripVagueCriteria } from '../../lib/ticket/criteria.mjs'
import { applyAnswer, exampleFor, fillMenu, formatFillMenu, formatPick, projectPick } from '../../lib/ticket/fill.mjs'

const cfg = adapter => validateConfig({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en', 'it'],
  features: [{ label: 'Orders', route: '/orders' }, { label: 'Invoices', route: '/invoices' }],
  titlePrefixes: ['FE', 'BE', 'FS'],
}).config
const FE = cfg('playwright')
const BE = cfg('vitest')
const NOT_ON_STORY = ['environment', 'expected_defined']

const LONG_AC = 'The Delete button is disabled for an order that is already shipped. Hovering it shows the tooltip "Already shipped" and no delete request is sent to the server.'
const FIX_AC = 'The grid shows exactly 5 rows after filtering by code 22, one per matching order, and the counter above the grid reads 5 results. Rows for code 220 are not shown.'
const sentence = n => `The list shows ${'x'.repeat(n - 'The list shows .'.length)}.`

const feBare = { key: 'DEMO-1', issuetype: 'Bug', labels: [], text: { description: 'The delete button is in the wrong place.' } }
const beBare = { key: 'DEMO-1', summary: 'order filter wrong', issuetype: 'Bug', text: { description: 'The order filter is wrong.' }, labels: [] }
const vagueDesc = '## Acceptance criteria\n- The grid works correctly after filtering by code, for every product and every order in the workspace, archived ones and the new ones included too, every day'
const feVague = { ...feBare, text: { description: vagueDesc } }
const beVague = { ...beBare, text: { description: vagueDesc } }
const brief = (c, t) => buildBrief(c, t)

for (const [name, c, bare, vagueTicket] of [['playwright', FE, feBare, feVague], ['vitest', BE, beBare, beVague]]) {
  test(`${name}: answers are accepted into the ticket or rejected untouched`, () => {
    const acBad = applyAnswer(c, bare, 'ac_present', 'it works correctly')
    assert.ok(!acBad.ok && /works correctly/.test(acBad.reason) && acBad.input === bare, 'a vague criterion is rejected and names the vague words')
    const acOk = applyAnswer(c, bare, 'ac_present', LONG_AC)
    assert.ok(acOk.ok && acOk.brief.signals.ac_present && acOk.brief.signals.ac_testable, 'an observable criterion is accepted')
    assert.ok(acOk.input.text.description.includes(`## Acceptance criteria\n- ${LONG_AC}`), 'the answer lands as a bullet under an AC heading')
    assert.ok(acOk.input !== bare && bare.text.description.length < 50 && !bare.filled && bare.labels.length === 0, 'applyAnswer never mutates its input')
  })
  test(`${name}: short plain criteria are rejected with their length; Gherkin is exempt`, () => {
    const acShort = applyAnswer(c, bare, 'ac_present', 'The Delete button is disabled for an order')
    assert.ok(!acShort.ok && /42 characters/.test(acShort.reason) && /150/.test(acShort.reason) && acShort.input === bare, acShort.reason)
    const acGherkin = applyAnswer(c, bare, 'ac_present', 'Given an order that is shipped\nWhen I open its menu\nThen Delete is disabled')
    assert.ok(acGherkin.ok && acGherkin.input.text.description.includes('\nThen Delete is disabled'), 'short Gherkin is exempt and stays Gherkin')
  })
  test(`${name}: the 150-character rule is exact`, () => {
    assert.equal(sentence(150).length, 150)
    assert.ok(applyAnswer(c, bare, 'ac_present', sentence(150)).ok, '150 passes')
    const r = applyAnswer(c, bare, 'ac_present', sentence(149))
    assert.ok(!r.ok && /149 characters/.test(r.reason), '149 is rejected')
  })
  test(`${name}: a vague AC section is offered as make-it-specific, and a specific answer replaces it`, () => {
    assert.equal(fillMenu(c, brief(c, vagueTicket)).items[0].key, 'ac_testable')
    const fixed = applyAnswer(c, vagueTicket, 'ac_testable', FIX_AC)
    assert.ok(fixed.ok && !fixed.input.text.description.includes('works correctly'), 'the specific answer replaces the vague criterion')
    assert.deepEqual(fixed.input.filled, [{ key: 'ac_testable', section: `## Acceptance criteria\n- ${FIX_AC}`, replacedVague: true }])
    assert.ok(!applyAnswer(c, vagueTicket, 'ac_testable', 'The grid shows exactly 5 rows').ok, 'the 150-character rule also covers a rewritten vague criterion')
  })
  test(`${name}: the examples shown to QA pass the rules themselves`, () => {
    const m = messagesFor(c, 'bug')
    assert.ok(applyAnswer(c, bare, 'ac_present', m.ac_present.example).ok)
    assert.ok(applyAnswer(c, vagueTicket, 'ac_testable', m.ac_testable.example).ok)
    assert.ok(applyAnswer(c, bare, 'feature_label', m.feature_label.example).ok, 'the label example is a configured label')
  })
  test(`${name}: stripVagueCriteria never touches prose outside the AC section`, () => {
    const v = buildVocabulary(c.languages)
    assert.equal(
      stripVagueCriteria(v, '## Acceptance criteria\n- The grid works correctly\n- 5 rows\n## Notes\nThe old page works correctly'),
      '## Acceptance criteria\n- 5 rows\n## Notes\nThe old page works correctly')
  })
  test(`${name}: feature label must be a configured one, stored canonical`, () => {
    const lbl = applyAnswer(c, bare, 'feature_label', 'orders-team')
    assert.ok(!lbl.ok && lbl.reason.includes('Orders') && lbl.reason.includes('Invoices') && lbl.input === bare, 'an invented label is rejected and the real ones are listed')
    const ok = applyAnswer(c, bare, 'feature_label', 'orders')
    assert.ok(ok.ok && ok.input.labels.includes('Orders'), 'case-insensitive, stored canonical')
    assert.deepEqual(ok.input.filled, [{ key: 'feature_label', label: 'Orders' }])
    assert.ok(!('section' in ok.input.filled[0]))
    if (name === 'playwright') assert.equal(ok.brief.route, '/orders', 'the label routes the test')
  })
  test(`${name}: environment, expected | actual, steps`, () => {
    assert.ok(applyAnswer(c, bare, 'environment', 'staging').input.text.description.includes('## Environment\nEnv: staging'), 'a bare value is enough')
    assert.ok(applyAnswer(c, bare, 'environment', 'Env: staging').input.text.description.endsWith('## Environment\nEnv: staging'), 'a typed Env: prefix is not doubled')
    assert.ok(!applyAnswer(c, bare, 'environment', ' ').ok, 'empty is rejected')
    const ea = applyAnswer(c, bare, 'expected_defined', 'The button sits at 24px | The button sits at 80px')
    assert.ok(ea.ok && ea.input.text.description.includes('## Expected\nThe button sits at 24px\n\n## Actual\nThe button sits at 80px'), 'split into both sections')
    const noActual = applyAnswer(c, bare, 'expected_defined', 'The button sits at 24px')
    assert.ok(!noActual.ok && /\|/.test(noActual.reason), 'expected without actual is rejected')
    assert.ok(!applyAnswer(c, bare, 'expected_defined', 'it works correctly | the button is at 80px').ok, 'a vague expected is rejected')
    assert.ok(applyAnswer(c, bare, 'steps', 'Open the order list\nScroll to the bottom').input.text.description.includes('## Steps to reproduce\n1. Open the order list\n2. Scroll to the bottom'), 'bug steps are numbered')
    assert.ok(applyAnswer(c, { ...bare, issuetype: 'Story' }, 'steps', 'As a user I want X so that Y').input.text.description.includes('## User story\nAs a user'), 'story steps become a user story')
    assert.ok(!applyAnswer(c, bare, 'steps', 'open').ok, 'a stub of steps is rejected')
  })
  test(`${name}: qa_plan_found and unknown keys can never be typed in`, () => {
    const qa = applyAnswer(c, bare, 'qa_plan_found', 'x')
    assert.ok(!qa.ok && qa.input === bare)
    const nope = applyAnswer(c, bare, 'nope', 'x')
    assert.ok(!nope.ok && nope.reason.includes('nope') && nope.input === bare)
    assert.ok(!applyAnswer(c, bare, 'ac_present', '').ok && applyAnswer(c, bare, 'ac_present', undefined).reason === 'The answer is empty.')
  })
  test(`${name}: each accepted answer is recorded once, in order; a rejected one records nothing`, () => {
    const f1 = applyAnswer(c, bare, 'ac_present', LONG_AC).input
    const f2 = applyAnswer(c, f1, 'feature_label', 'Orders').input
    const f3 = applyAnswer(c, f2, 'environment', 'staging').input
    assert.equal(f3.filled.map(f => f.key).join(), 'ac_present,feature_label,environment')
    assert.equal(applyAnswer(c, f1, 'ac_present', 'it works correctly').input.filled.length, 1)
    assert.equal(brief(c, f3).score, brief(c, { ...f3, filled: undefined }).score, 'the filled record never moves the score')
  })
  test(`${name}: a story is never asked for environment or expected vs actual`, () => {
    const storyMenu = fillMenu(c, brief(c, { ...bare, issuetype: 'Story' }))
    assert.ok(!storyMenu.items.some(i => NOT_ON_STORY.includes(i.key)))
    assert.equal(storyMenu.items.find(i => i.key === 'steps').title, 'User story')
    assert.ok(!storyMenu.items.some(i => i.key === 'qa_plan_found'))
  })
}

test('playwright: bug menu lists every gap once, AC first, no QA plan', () => {
  const menu = fillMenu(FE, brief(FE, feBare))
  assert.equal(menu.items.map(i => i.key).join(), 'ac_present,steps,expected_defined,attachments,feature_label,links,environment')
  assert.equal(menu.items[0].gain, 50, 'AC gain counts the testable and expected it also credits')
  assert.deepEqual(menu.items.map(i => i.n), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(menu.items.every(i => i.n && i.title && i.question && i.example && Number.isInteger(i.gain)))
  assert.deepEqual(Object.keys(menu), ['key', 'rubric', 'issuetype', 'score', 'threshold', 'signals', 'items'])
  assert.ok(menu.items.find(i => i.key === 'feature_label').question.includes('Orders, Invoices'), 'the feature question lists the configured features')
  assert.ok(formatFillMenu(menu).includes('0 of the 70 points'))
})
test('vitest: bug menu lists every gap once, AC first, testable folded into AC', () => {
  const menu = fillMenu(BE, brief(BE, beBare))
  assert.equal(menu.items.map(i => i.key).join(), 'ac_present,expected_defined,steps,attachments,links,context,title_prefix,feature_label,environment')
  assert.equal(menu.items[0].gain, 55)
  assert.ok(!menu.items.some(i => i.key === 'ac_testable'))
  assert.ok(menu.items.every(i => i.n && i.question && i.example))
  assert.ok(formatFillMenu(menu).includes('0 of the 70 points'))
  const story = fillMenu(BE, brief(BE, { ...beBare, issuetype: 'Story' }))
  assert.ok(story.items.find(i => i.key === 'context').question.startsWith('In two or three sentences'), 'story wording for context')
})
test('playwright: picks reach the bar or fall short', () => {
  const menu = fillMenu(FE, brief(FE, feBare))
  const p1 = projectPick(menu, [menu.items.find(i => i.key === 'environment').n])
  assert.ok(p1.score === 5 && p1.short === 65 && !p1.enough, JSON.stringify(p1))
  assert.ok(formatPick(p1).includes('65 points short'))
  const p2 = projectPick(menu, [1, 2, menu.items.find(i => i.key === 'feature_label').n])
  assert.ok(p2.enough && p2.score === 70 && p2.short === 0)
  assert.ok(formatPick(p2).includes('enough'))
  assert.deepEqual(Object.keys(p2.picked[0]), ['n', 'key', 'title', 'question', 'example'])
  assert.ok(projectPick(menu, [42]).error, 'an unknown number is an error')
  assert.equal(formatPick(projectPick(menu, [42])), 'There is no number 42 on the list.')
  assert.ok(projectPick(menu, []).error)
  assert.equal(projectPick(menu, [1, 1]).picked.length, 1, 'a repeated number counts once')
})
test('vitest: the 15-point ticket, pick only Environment, then AC + Environment', () => {
  const at25 = { ...beBare, text: { description: '## Summary\nfilter is wrong\n## Steps to reproduce\n1. open\n2. filter 22' } }
  const m25 = fillMenu(BE, brief(BE, at25))
  assert.equal(m25.score, 15)
  const envN = m25.items.find(i => i.key === 'environment').n
  const p1 = projectPick(m25, [envN])
  assert.ok(p1.score === 20 && p1.short === 50 && !p1.enough, JSON.stringify(p1))
  assert.ok(formatPick(p1).includes('50 points short'))
  const p2 = projectPick(m25, [m25.items.find(i => i.key === 'ac_present').n, envN])
  assert.ok(p2.enough && p2.score === 75)
  assert.ok(projectPick(m25, [99]).error, 'an unknown number is an error, not a silent skip')
  assert.deepEqual(projectPick(JSON.parse(JSON.stringify(m25)), [envN]).score, 20, 'a menu that went through JSON still projects')
})
test('vitest: context and title prefix', () => {
  assert.ok(!applyAnswer(BE, beBare, 'context', 'bad').ok, 'a stub context is rejected')
  const ctx = applyAnswer(BE, beBare, 'context', 'Order filter matches substrings')
  assert.ok(ctx.ok && ctx.input.text.description.includes('## Summary\nOrder filter matches substrings'))
  const ctxStory = applyAnswer(BE, { ...beBare, issuetype: 'Story' }, 'context', 'Finding one order means scrolling')
  assert.ok(ctxStory.ok && ctxStory.input.text.description.includes('## Context\nFinding one order'), 'a story gets a Context heading')
  assert.equal(applyAnswer(BE, beBare, 'title_prefix', 'be').input.summary, '[BE] order filter wrong', 'prefix is prepended, canonical case')
  assert.equal(applyAnswer(BE, beBare, 'title_prefix', '[fs]').input.summary, '[FS] order filter wrong')
  assert.equal(applyAnswer(BE, { ...beBare, summary: '[FE] order filter wrong' }, 'title_prefix', 'BE').input.summary, '[BE] order filter wrong', 'an old prefix is replaced')
  const bad = applyAnswer(BE, beBare, 'title_prefix', 'backend team')
  assert.ok(!bad.ok && bad.reason.includes('FE, BE or FS'))
  assert.deepEqual(applyAnswer(BE, beBare, 'title_prefix', 'BE').input.filled, [{ key: 'title_prefix', prefix: 'BE' }])
  const own = validateConfig({ ...BE, titlePrefixes: ['UI', 'API'] }).config
  assert.equal(applyAnswer(own, beBare, 'title_prefix', 'api').input.summary, '[API] order filter wrong', 'prefixes come from config')
  assert.ok(!applyAnswer(own, beBare, 'title_prefix', 'BE').ok)
})
test('title_prefix rejection text is overridable from config messages', () => {
  const custom = 'Type BE (backend), FE (frontend) or FS (both).'
  const c = validateConfig({ ...BE, messages: { title_prefix: { reject: custom } } }).config
  assert.equal(applyAnswer(c, beBare, 'title_prefix', 'backend team').reason, custom)
  assert.equal(applyAnswer(BE, beBare, 'title_prefix', 'backend team').reason, 'Type FE, BE or FS.')
})
test('the menu names its rubric; projectPick uses it, and falls back to signals without it', () => {
  const m = fillMenu(BE, brief(BE, beBare))
  assert.equal(m.rubric, 'vitest')
  assert.equal(fillMenu(FE, brief(FE, feBare)).rubric, 'playwright')
  const n = m.items.find(i => i.key === 'environment').n
  assert.equal(projectPick(m, [n]).score, 5)
  const { rubric, ...bare } = JSON.parse(JSON.stringify(m))
  assert.equal(projectPick(bare, [n]).score, 5)
  // a wrong signal shape cannot mislead it when the id is present
  assert.equal(projectPick({ ...m, signals: { ...m.signals } }, [n]).score, 5)
})
test('playwright has no context or title prefix to fill; vitest has no QA plan', () => {
  assert.ok(!applyAnswer(FE, feBare, 'context', 'Order filter matches substrings').ok)
  assert.ok(!applyAnswer(FE, feBare, 'title_prefix', 'BE').ok)
  assert.ok(!fillMenu(BE, brief(BE, beBare)).items.some(i => i.key === 'qa_plan_found'))
})
test('rejection wording follows each rubric', () => {
  assert.equal(applyAnswer(FE, feBare, 'ac_present', 'it works correctly').reason, '"works correctly" is not something a test can see. Name the label, the count or the exact text.')
  assert.equal(applyAnswer(BE, beBare, 'ac_present', 'it works correctly').reason, '"works correctly" is not a result a test can check. Name the number or the exact text.')
  assert.ok(applyAnswer(FE, feBare, 'ac_present', 'too short').reason.includes('what the user should see'))
  assert.ok(applyAnswer(BE, beBare, 'ac_present', 'too short').reason.includes('what should happen'))
  assert.equal(applyAnswer(FE, feBare, 'expected_defined', 'a').reason, 'Write both, separated by |: what you should see | what you see now.')
  assert.equal(applyAnswer(BE, beBare, 'expected_defined', 'a').reason, 'Write both, separated by |: what should happen | what happens now.')
  assert.equal(applyAnswer(FE, feBare, 'nope', 'x').reason, 'There is no criterion called nope that can be typed in.')
  assert.equal(applyAnswer(BE, beBare, 'nope', 'x').reason, 'There is no criterion called nope.')
})
test('exampleFor: only a key the rubric lets the author type in has an example', () => {
  assert.equal(exampleFor(FE, feBare, 'environment'), messagesFor(FE, 'bug').environment.example)
  assert.equal(exampleFor(BE, { ...beBare, issuetype: 'Story' }, 'context'), messagesFor(BE, 'story').context.example)
  assert.equal(exampleFor(FE, feBare, 'context'), undefined, 'playwright does not score context')
  assert.equal(exampleFor(FE, feBare, 'title_prefix'), undefined, 'playwright does not score a title prefix')
  assert.equal(exampleFor(FE, feBare, 'qa_plan_found'), undefined, 'a QA plan cannot be typed in')
  assert.equal(exampleFor(BE, beBare, 'nope'), undefined)
})

// spec §10 #10: a plain sentence that starts with a Gherkin keyword is plain criteria, not Gherkin.
const WHEN_AC = 'When a user enters a quantity above the maximum allowed in the order drawer, the field shows the error "Quantity too high" and the Save button stays disabled. The orders page keeps working and no order is created.'
for (const [name, c, bare] of [['playwright', FE, feBare], ['vitest', BE, beBare]]) {
  test(`${name}: a long plain sentence starting with When is credited`, () => {
    const r = applyAnswer(c, bare, 'ac_present', WHEN_AC)
    assert.ok(r.ok && r.brief.signals.ac_present && r.brief.signals.ac_testable, r.reason)
  })
  test(`${name}: a short plain sentence starting with When goes through the 150-character check`, () => {
    const r = applyAnswer(c, bare, 'ac_present', 'When the quantity is too high, the Save button is disabled')
    assert.ok(!r.ok && /58 characters/.test(r.reason) && r.input === bare, r.reason)
    const it = applyAnswer(c, bare, 'ac_present', 'Quando la quantità è troppo alta, il pulsante Salva è disattivato')
    assert.ok(!it.ok && /characters/.test(it.reason), it.reason)
  })
}

// Round 3, ruling R37: half-written Gherkin is refused; the trial sentence still passes.
const TRIAL_AC = 'When a user enters a quantity above the maximum allowed in the order drawer, the field shows the error "Quantity too high" and the Save button stays disabled. The orders page keeps working and no order is created.'
const FILLER_GW = 'Given an order list that holds forty orders from three different customers in the current month\nGiven the user is signed in as a sales manager with read access\nWhen the user opens the orders page from the menu'
const FILLER_W = '- When the user opens the orders page from the main menu\n- When the user filters the list by the customer name\n- When the user sorts the orders by their creation date'
const TRIAL_IT = 'Quando un utente inserisce una quantità oltre il massimo consentito nel pannello ordine, il campo mostra l\'errore "Quantità troppo alta" e il pulsante Salva resta disattivato. La pagina ordini continua a funzionare.'
for (const [name, c, bare] of [['playwright', FE, feBare], ['vitest', BE, beBare]]) {
  test(`${name}: R37 refuses bare Given / When steps with no Then, credits a When sentence with a result`, () => {
    for (const filler of [FILLER_GW, FILLER_W, 'Quando l\'utente apre la pagina ordini dal menu principale\nQuando l\'utente filtra la lista per nome del cliente\nQuando l\'utente ordina gli ordini per data di creazione']) {
      const r = applyAnswer(c, bare, 'ac_present', filler)
      assert.ok(!r.ok && /no Then line/.test(r.reason) && r.input === bare, r.reason)
    }
    for (const ok of [TRIAL_AC, TRIAL_IT]) {
      const r = applyAnswer(c, bare, 'ac_present', ok)
      assert.ok(r.ok && r.brief.signals.ac_present && r.brief.signals.ac_testable, r.reason)
    }
  })
  test(`${name}: a bulleted Given / When / Then answer is written as plain Gherkin and credited`, () => {
    const r = applyAnswer(c, bare, 'ac_present', '- Given an order that is shipped\n- When I open its menu\n* Then Delete is disabled')
    assert.ok(r.ok && r.brief.signals.ac_present, r.reason)
    assert.ok(r.input.text.description.endsWith('## Acceptance criteria\nGiven an order that is shipped\nWhen I open its menu\nThen Delete is disabled'), r.input.text.description)
  })
}

// Steps with no Then get a message that names the missing Then, not "Too short: 0 characters".
for (const [name, c, bare] of [['playwright', FE, feBare], ['vitest', BE, beBare]]) {
  test(`${name}: Given / When steps without a Then are told the Then is missing`, () => {
    const r = applyAnswer(c, bare, 'ac_present', 'Given a list of orders\nWhen I filter by customer')
    assert.ok(!r.ok && /Then/.test(r.reason) && !/0 characters/.test(r.reason) && r.input === bare, r.reason)
  })
}

test('an Italian-only project gets Italian headings, so every answer it types is credited', () => {
  const it = { ...BE, languages: ['it'] }
  const bug = { ...beBare, text: { description: 'Il filtro ordini è sbagliato.' } }
  const answers = {
    steps: 'Apri gli ordini\nFiltra per codice 22',
    expected_defined: 'La griglia mostra 5 righe | La griglia mostra 0 righe',
    context: 'Il filtro per codice non trova gli ordini spediti.',
    environment: 'staging',
  }
  for (const [key, answer] of Object.entries(answers)) {
    const r = applyAnswer(it, bug, key, answer)
    assert.equal(r.ok, true, `${key}: ${r.reason}`)
  }
  assert.match(applyAnswer(it, bug, 'steps', answers.steps).input.text.description, /## Passi per riprodurre/)
})
