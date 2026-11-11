import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfig } from '../../lib/base/config.mjs'
import { checkStory, STORY_LIMITS, storyShape, draftTicket, storyPath, draftPath } from '../../lib/ticket/story.mjs'

const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const T = description => ({ key: 'DEMO-1', text: { description } })
const STRUCTURED = '## Goal\nAs a clerk, I want to filter orders by customer so that I find them fast.\n\n## Acceptance criteria\nGiven 8 orders\nWhen I filter by customer Rossi\nThen the grid shows exactly 5 rows\n\nThe filter keeps the customer after a reload of the page and the counter reads 5 results.'
const DRAFT = '## Goal\nFilter orders by customer.\n\n## What\nA customer filter on the orders grid.\n\n## Acceptance criteria\n- Given 8 orders, when I filter by customer Rossi, then the grid shows exactly 5 rows, one per matching order, and the counter above the grid reads 5 results.\n\n## Done when\nThe filter works for every customer and the tests pass.'

test('thresholds live in one block', () => {
  assert.deepEqual(Object.keys(STORY_LIMITS).sort(), ['maxProseParagraphs', 'maxWords', 'minWords'])
})
test('a structured story of normal length is not flagged', () => {
  const c = checkStory(T(STRUCTURED))
  assert.equal(c.flagged, false)
  assert.ok(c.hasGoal && c.hasCriteria)
})
test('too thin: under minWords', () => {
  const c = checkStory(T('Fix the delete button.'))
  assert.ok(c.flagged && c.reasons.includes('too_thin'))
  assert.ok(checkStory(T(words(STORY_LIMITS.minWords - 1))).reasons.includes('too_thin'))
  assert.ok(!checkStory(T(`${words(STORY_LIMITS.minWords)}\n\nGiven a b`)).reasons.includes('too_thin'))
})
test('too long: over maxWords, even when structured', () => {
  const c = checkStory(T(`${STRUCTURED}\n\n${words(STORY_LIMITS.maxWords)}`))
  assert.ok(c.flagged && c.reasons.includes('too_long'))
})
test('too long: many plain paragraphs with no heading', () => {
  const paras = Array.from({ length: STORY_LIMITS.maxProseParagraphs + 1 }, (_, i) => `Paragraph ${i} says something about the page in plain prose.`).join('\n\n')
  const c = checkStory(T(paras))
  assert.ok(c.reasons.includes('too_long'))
  assert.equal(c.proseParagraphs, STORY_LIMITS.maxProseParagraphs + 1)
  // the same paragraphs under a heading are structure, not a wall of text
  assert.ok(!checkStory(T(`## Goal\n${paras}\n\nGiven x`)).reasons.includes('too_long'))
})
test('no structure: enough words but no goal and no criteria; no criteria alone is flagged too', () => {
  const c = checkStory(T(`The orders page should be improved a lot. ${words(STORY_LIMITS.minWords)}`))
  assert.ok(c.reasons.includes('no_structure'))
  const g = checkStory(T(`As a clerk, I want to filter orders so that I find them. ${words(STORY_LIMITS.minWords)}`))
  assert.ok(g.reasons.includes('no_criteria') && g.hasGoal)
})
test('the criteria field counts as criteria; an Italian story is recognised', () => {
  const t = { key: 'DEMO-1', text: { description: `Come cassiere voglio filtrare gli ordini per cliente. ${words(STORY_LIMITS.minWords)}`, acField: 'Il filtro mostra 5 righe.' } }
  const c = checkStory(t)
  assert.ok(c.hasGoal && c.hasCriteria && !c.flagged)
})
test('storyShape names the project sections a draft has and lacks', () => {
  assert.deepEqual(storyShape(DRAFT).missing, [])
  assert.deepEqual(storyShape('## Goal\nx').missing, ['What', 'Acceptance criteria', 'Done when'])
})
test('a draft is scored as the ticket story: only its own text counts', () => {
  const t = { ...T('x'), scenarios: [{ name: 'a', gherkin: 'Given a When b Then c' }], text: { description: 'x', acField: 'old' } }
  const d = draftTicket(t, DRAFT)
  assert.equal(d.text.description, DRAFT)
  assert.equal(d.text.acField, '')
  assert.deepEqual(d.scenarios, [])
  assert.equal(t.text.acField, 'old', 'the input is not mutated')
})
test('story paths stay inside the key folder', () => {
  assert.equal(storyPath('/t', 'DEMO-1'), '/t/DEMO-1/story.md')
  assert.equal(draftPath('/t', 'DEMO-1'), '/t/DEMO-1/story-draft.md')
  assert.equal(storyPath('/t', '../x'), null)
  assert.equal(storyPath('/t', undefined), null)
})

// ----- the CLI -----
const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const proj = () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ticketsDir: 'tickets' }))
  writeFileSync(join(d, 't.json'), JSON.stringify({ key: 'DEMO-1', issuetype: 'Story', summary: 's', labels: [], text: { description: 'Broken.' } }))
  writeFileSync(join(d, 'draft.md'), DRAFT)
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d, QC_NO_AUDIT: '1' }, encoding: 'utf8' })

test('story-check: flags a thin ticket and prints the machine line', () => {
  const r = run(proj(), 'story-check', '--in', '@t.json')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /could be clearer/)
  const json = JSON.parse(r.stdout.match(/^STORY_JSON:(.*)$/m)[1])
  assert.equal(json.flagged, true)
})
test('story-check --draft: re-scores the draft and shows old and new score', () => {
  const r = run(proj(), 'story-check', '--in', '@t.json', '--draft', '@draft.md')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Score: \d+ before, \d+ with the new story \(needs 70\)\./m)
  const j = JSON.parse(r.stdout.match(/^STORY_SCORE_JSON:(.*)$/m)[1])
  assert.ok(j.after.score > j.before.score, 'the structured draft scores higher than the thin description')
  assert.deepEqual(j.shape.missing, [])
})
test('story-check --draft: a missing draft file is a usage error, not a crash', () => {
  const r = run(proj(), 'story-check', '--in', '@t.json', '--draft', '@nope.md')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /cannot read the draft/)
})
test('the draft is redacted before it is scored', () => {
  const d = proj()
  writeFileSync(join(d, 'draft.md'), `${DRAFT}\n\nContact fake.person@example.com about it.`)
  const r = run(d, 'story-check', '--in', '@t.json', '--draft', '@draft.md', '--json')
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.stdout, /fake\.person@example\.com/)
})
test('story-save: moves the draft to <ticketsDir>/<KEY>/story.md, and sends nothing anywhere', () => {
  const d = proj()
  const dir = resolve(d, loadConfig(d).config.ticketsDir, 'DEMO-1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'story-draft.md'), DRAFT)
  const r = run(d, "story-save", "--in", "@t.json")
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Saved the story at .*DEMO-1\/story\.md/)
  assert.equal(readFileSync(join(dir, 'story.md'), 'utf8'), DRAFT)
  assert.ok(!existsSync(join(dir, 'story-draft.md')))
})
test('story-save: no draft, or a key that could leave its folder, writes nothing', () => {
  const d = proj()
  assert.equal(run(d, 'story-save', '--in', '@t.json').status, 2)
  const r = run(d, 'story-save', '--in', JSON.stringify({ key: '../evil', text: {} }))
  assert.equal(r.status, 2)
  assert.ok(!existsSync(join(d, 'evil')))
})

// ----- the command text -----
const doc = readFileSync(new URL('../../guides/ticket-eval.md', import.meta.url), 'utf8')
const flow = doc.slice(doc.indexOf('## Rewrite the story'), doc.indexOf('## The refuse card'))
const step = doc.slice(doc.indexOf('5c. **Story check.**'), doc.indexOf('## Rewrite the story'))

test('command: the story check runs after the score, asks nothing with --ci, and the script decides', () => {
  assert.ok(doc.indexOf('5c. **Story check.**') > doc.indexOf('5b. **Read the screenshots'))
  assert.match(step, /Not with `--ci`: it asks nothing/)
  assert.match(step, /ticket\.mjs story-check/)
  assert.match(step, /The script decides/)
  assert.match(doc, /pass:\*\* say the ticket is ready, then step 5c/)
})
test('command: the source picker offers the five sources through AskUserQuestion, paged', () => {
  assert.match(flow, /AskUserQuestion picker/)
  for (const s of ['From the ticket description', 'From Figma', 'From Confluence', 'From another source', 'Not now']) assert.ok(flow.includes(s), s)
  assert.match(flow, /four options at most/)
  assert.match(flow, /More…/)
  assert.match(flow, /progress\.mjs" set ticket-eval --key <KEY>/)
})
test('command: never invents, asks about gaps, keeps the language, uses the project story shape', () => {
  assert.match(flow, /Never invent/)
  assert.match(flow, /ask the person about every gap/)
  assert.match(flow, /guides\/language\.md/)
  for (const h of ['## Goal', '## What', '## Acceptance criteria', '## Done when']) assert.ok(flow.includes(h), h)
  assert.match(flow, /story-check --in @<ticketsDir>\/<KEY>\/ticket\.json --draft/)
  assert.match(flow, /Still missing/)
})
test('command: destinations are Jira, local story.md, edit more, cancel; Jira only after preview and an explicit yes', () => {
  assert.match(flow, /1\. Post to Jira/)
  assert.match(flow, /2\. Save locally at <ticketsDir>\/<KEY>\/story\.md/)
  assert.match(flow, /3\. Edit more/)
  assert.match(flow, /4\. Cancel/)
  assert.match(flow, /nothing is written without the preview and a yes/)
  assert.match(flow, /Only on an explicit yes/)
  assert.match(flow, /Never with `--ci`, which never gets here/)
  assert.ok(flow.indexOf('Only on an explicit yes') < flow.indexOf('editJiraIssue'), 'the yes comes before the write')
  assert.match(flow, /story-save/)
  assert.match(flow, /Nothing is sent to Jira/)
})
test('tickets-eval only points at the feature', () => {
  const t = readFileSync(new URL('../../guides/tickets-eval.md', import.meta.url), 'utf8')
  assert.match(t, /offers to rewrite a story/)
})
