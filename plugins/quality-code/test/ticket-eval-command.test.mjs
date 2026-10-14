// The ticket-eval command is a prompt, not code: these pin the QA-plan search rules that keep it
// from crediting another team's Confluence page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/ticket-eval.md', import.meta.url), 'utf8')
const qa = doc.slice(doc.indexOf('**QA plan**'), doc.indexOf('\n', doc.indexOf('**QA plan**')))

test('the QA-plan search is limited to confluenceSpaces when set', () => {
  assert.ok(qa.includes('confluenceSpaces'))
  assert.ok(qa.includes('text ~ "<qaPlanSearch>" AND type = page AND space in ("<K1>","<K2>")'))
  assert.ok(qa.includes('text ~ "<qaPlanSearch>" AND type = page`'))
})
test('qaPlanSearch is escaped before it goes into the CQL', () => {
  assert.match(qa, /escape[^.]*`"`[^.]*`\\`|escape[^.]*`\\`[^.]*`"`/i)
})
test('the best match is a title match, never the first hit by rank', () => {
  assert.match(qa, /title contains the search words/)
  assert.match(qa, /ignoring case/)
  assert.match(qa, /Never credit a page only because it ranks first/)
  assert.match(qa, /Read at most one page/)
  assert.match(qa, /no Confluence QA plan found for <feature>/)
})
test('Jira and Confluence tools are named by operation, never by an mcp__ tool name', () => {
  assert.doesNotMatch(doc, /mcp__/)
})

test('step 1: the criteria field is looked up once per project: Story, all fields, a saved result searched, never read whole', () => {
  const s = doc.slice(doc.indexOf('**Criteria field.**'), doc.indexOf('\n2. **'))
  assert.match(s, /getJiraIssueTypeMetaWithFields/)
  assert.match(s, /Story/)
  assert.match(s, /`requiredFieldsOnly` `false`/)
  assert.match(s, /saved to a file/)
  assert.match(s, /never read (?:the|that) file whole/i)
  assert.ok(s.includes('/acceptance criteria|criteri di accettazione/i'))
  assert.match(s, /grep|node -e|jq/)
  assert.match(s, /[Mm]ore than one/)
  assert.match(s, /None/)
})
test('step 1: a stored or configured field skips the lookup; the answer is stored with field set', () => {
  const s = doc.slice(doc.indexOf('**Criteria field.**'), doc.indexOf('\n2. **'))
  assert.ok(s.includes('field get <PROJECT>'))
  assert.ok(s.includes('field set <PROJECT> <customfield_N|none>'))
  assert.match(s, /`source` `config` or `stored`: use its `field`/)
  assert.match(s, /with `--ci`, never ask/)
  assert.doesNotMatch(doc, /jira\.acceptanceCriteriaField/)
})
test('a posted comment and a pushed fill-in are logged by key for the KPI rollup', () => {
  assert.ok(doc.includes('`The comment has been posted. Work has not started.`, then run `cli.mjs jira-posted <KEY> comment`'))
  assert.ok(doc.includes('`The Jira ticket has been updated.`, and run `cli.mjs jira-posted <KEY> update`'))
})
