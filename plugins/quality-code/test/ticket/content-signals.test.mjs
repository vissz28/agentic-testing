// AGT-120: the criteria, steps and environment are read from the content of a ticket, not only
// from its headings. A ticket is legacy only when it has no content signal at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { buildBrief } from '../../lib/ticket/score.mjs'
import { buildVocabulary } from '../../lib/ticket/languages/index.mjs'
import { extractListCriteria, hasActionSteps, namesObservable } from '../../lib/ticket/criteria.mjs'

const cfg = adapter => validateConfig({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en', 'it'],
  features: [{ label: 'Documents', route: '/documents', qaPlanSearch: 'documents' }],
  titlePrefixes: ['FE', 'BE', 'FS'],
}).config
const FE = cfg('playwright')
const BE = cfg('vitest')
const v = buildVocabulary(['en', 'it'])
const ticket = (description, extra = {}) => ({ key: 'DEMO-1', issuetype: 'Story', summary: 'document filter', labels: [], text: { description }, ...extra })

// Synthetic sprint tickets of the shape that was refused as legacy: no Gherkin, no AC heading.
export const SPRINT = {
  'five-checks': [
    'The document list needs a filter by status, so the operator finds the drafts without scrolling.',
    '',
    '1. The Status filter shows the options Draft, Sent and Archived.',
    '2. Selecting Draft lists only the documents with status Draft.',
    '3. The counter above the list reads "3 documents" for the sample workspace.',
    '4. The Clear button is disabled while no filter is selected.',
    '5. After a reload the selected filter is still visible in the toolbar.',
  ].join('\n'),
  'bug-steps-env-checks': [
    'Exporting the invoice list to CSV drops the last row.',
    'Env: staging',
    '',
    '1. Open the invoice list',
    '2. Filter by customer code 22',
    '3. Click Export CSV',
    '',
    'What we expect:',
    '- The CSV file has as many rows as the grid shows, 12 for customer code 22 in the sample data.',
    '- The last row of the grid is in the file too, with its total 108.00 and its date.',
  ].join('\n'),
  'vague-checks': [
    'The archive page needs a cleanup before the release.',
    '',
    '1. The archive list works correctly after the cleanup, for every document type in the workspace.',
    '2. The export of the archive works correctly too, as it did before the change was made.',
    '3. The search in the archive shows the same results as expected by the team, for any word.',
  ].join('\n'),
  'italian-checks': [
    'Nella lista ordini serve il filtro per deposito di destinazione.',
    '',
    '1. Il filtro mostra tutti i depositi attivi del workspace, in ordine alfabetico.',
    '2. Selezionando un deposito la griglia mostra solo gli ordini verso quel deposito.',
    '3. Il contatore sopra la griglia riporta il totale delle righe filtrate, per esempio 4.',
  ].join('\n'),
  'notes-only': [
    'Follow-up of the planning meeting.',
    '',
    '- Talk to the product owner about the scope',
    '- Update the onboarding docs afterwards',
  ].join('\n'),
}

test('a numbered list of five checks without a heading is credited as acceptance criteria', () => {
  for (const c of [FE, BE]) {
    const b = buildBrief(c, ticket(SPRINT['five-checks']))
    assert.equal(b.signals.ac_present, true)
    assert.equal(b.signals.ac_testable, true)
    assert.equal(b.legacy, false)
  }
  assert.equal(extractListCriteria(v, SPRINT['five-checks']).length, 5)
})

test('a list whose items say "works correctly" is not credited as testable criteria', () => {
  for (const c of [FE, BE]) {
    const b = buildBrief(c, ticket(SPRINT['vague-checks']))
    assert.equal(b.signals.ac_testable, false)
    assert.ok(b.missing.some(m => m.key === 'ac_testable'))
  }
  // Only vague items, nothing a test can see: no criteria at all.
  const onlyVague = '- The list works correctly for every document type there is, today and tomorrow, archived or not.\n- The export works correctly in every format the workspace offers, csv and xlsx and pdf.'
  assert.deepEqual(extractListCriteria(v, onlyVague), [])
})

test('prose plus a numbered list of checks is not legacy, even when the list is too short to credit', () => {
  const short = 'The grid needs a total.\n\n1. The total row shows 108.00\n2. The total is hidden when the grid is empty'
  for (const c of [FE, BE]) {
    const b = buildBrief(c, ticket(short))
    assert.equal(b.signals.ac_present, false, 'under 150 characters: not enough to credit')
    assert.equal(b.legacy, false)
    assert.equal(buildBrief(c, ticket(SPRINT['notes-only'])).legacy, true, 'a list of notes is no content signal')
  }
})

test('numbered action steps without a heading are the steps; a list of actions is not criteria', () => {
  const b = buildBrief(BE, ticket(SPRINT['bug-steps-env-checks'], { issuetype: 'Bug' }))
  assert.equal(b.signals.steps, true)
  assert.equal(b.signals.environment, true)
  assert.equal(b.signals.ac_present, true)
  assert.equal(hasActionSteps(v, '1. Open the invoice list\n2. Click Export CSV'), true)
  assert.equal(hasActionSteps(v, '1. Apri la lista ordini\n2. Clicca su Esporta'), true)
  assert.equal(hasActionSteps(v, '- Open the invoice list\n- Click Export CSV'), false, 'bullets are not numbered steps')
  assert.equal(hasActionSteps(v, '1. Open the invoice list'), false, 'one step is no list')
  assert.equal(hasActionSteps(v, '1. The total is 108.00\n2. Open the list again'), false, 'it must start with an action')
  assert.deepEqual(extractListCriteria(v, '1. Open the list\n2. Filter by code 22\n3. Click Export'), [], 'digits in an action are no result')
  assert.equal(namesObservable(v, 'Click Save: the toast reads "Saved"'), true, 'an action with its result')
  assert.equal(namesObservable(v, 'Delete is disabled for a shipped order'), true, 'a control named like an action')
})

test('a list under a named section or an AC heading is not read again as free criteria', () => {
  const steps = '## Steps to reproduce\n- The grid shows 5 rows for code 22\n- The counter reads 5 results after the filter'
  assert.deepEqual(extractListCriteria(v, steps), [])
  // With an AC section, the free list is not read: a vague free item does not undo good criteria.
  const both = `## Acceptance criteria\n- ${'The grid shows exactly 5 rows after filtering by code 22, and the counter above the grid reads 5 results. '.repeat(2)}\n\n## Notes\nFree list:\n\n- The export works correctly\n- The grid shows 5 rows`
  const b = buildBrief(BE, ticket(both))
  assert.equal(b.signals.ac_testable, true)
  // A heading the vocabulary does not name leaves the list readable.
  assert.equal(buildBrief(BE, ticket(`## Description\n${SPRINT['five-checks']}`)).signals.ac_present, true)
})

test('the environment is read from an Env: line or a named environment, never from a template hint', () => {
  for (const d of ['Env: staging', '- **Env:** production', 'Reproduced on staging with the sample data.', 'Seen in production since Monday.', 'Chrome 120 on Windows', 'Riprodotto in ambiente di collaudo.', 'Environment: staging']) {
    assert.equal(buildBrief(BE, ticket(d)).signals.environment, true, d)
  }
  for (const d of ['<!-- Env: staging or production -->', 'The product page is wrong.', 'The production of the report takes long.', '## Environment\n\n## Notes']) {
    assert.equal(buildBrief(BE, ticket(d)).signals.environment, false, d)
  }
})

test('the synthetic sprint tickets: scores after AGT-120', () => {
  const scores = Object.fromEntries(Object.entries(SPRINT).map(([k, d]) => {
    const fe = buildBrief(FE, ticket(d, { labels: ['Documents'] }))
    const be = buildBrief(BE, ticket(d, { labels: ['Documents'] }))
    return [k, [fe.score, fe.legacy, be.score, be.legacy]]
  }))
  // [playwright score, legacy, vitest score, legacy]; before AGT-120 every one was legacy, at 10 and 5.
  assert.deepEqual(scores, {
    'five-checks': [60, false, 60, false],
    'bug-steps-env-checks': [75, false, 75, false],
    'vague-checks': [45, false, 45, false],
    'italian-checks': [60, false, 60, false],
    'notes-only': [10, true, 5, true],
  })
})
