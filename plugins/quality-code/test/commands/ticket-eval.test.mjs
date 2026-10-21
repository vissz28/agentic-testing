// The ticket-eval command is a prompt, not code: these pin the QA-plan search rules that keep it
// from crediting another team's Confluence page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/ticket-eval.md', import.meta.url), 'utf8')
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
// Real shape (FIC-13453): { relationship: 'Wiki Page', object: { url: '<site>/wiki/pages/viewpage.action?pageId=…', title: 'Wiki Page' } }
test('a Confluence page attached to the ticket comes from its remote links, before the search', () => {
  assert.ok(qa.includes('`listJiraIssueRemoteIssueLinks` (`getJiraIssueRemoteIssueLinks` on an older connection)'))
  assert.ok(qa.includes('never in `issuelinks`'))
  assert.ok(qa.includes('`object.url` starts with `<jira.site>/wiki/`'))
  assert.match(qa, /at most 3/)
  assert.match(qa, /`confluenceSpaces` limits only the search/)
  assert.ok(qa.indexOf('RemoteIssueLinks') < qa.indexOf('searchConfluenceUsingCql'), 'attached pages come first')
  assert.match(qa, /no attached page holds scenarios: the search/)
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
  assert.ok(doc.includes('`The comment has been posted. Work has not started.`, then run `ticket.mjs jira-posted <KEY> comment`'))
  assert.ok(doc.includes('`The Jira ticket has been updated.`, and run `ticket.mjs jira-posted <KEY> update`'))
})

// The refuse card's option 3, the developer override.
const write = readFileSync(new URL('../../commands/write.md', import.meta.url), 'utf8')
const three = doc.slice(doc.indexOf('\n- **3:** developer override'), doc.indexOf('\n## Send-preview'))

test('option 3 is shown word for word with the red tag', () => {
  assert.ok(doc.includes('3. 🔴 **[RISK / NOT RECOMMENDED]** Continue anyway (developers only). The user story is not complete.'))
})
test('option 3 continues: on its own it goes straight on to writing the tests, marked incomplete', () => {
  assert.doesNotMatch(three, /then stop; callers that build on this command decide/)
  assert.ok(three.includes('${CLAUDE_PLUGIN_ROOT}/commands/write.md'))
  assert.match(three, /incomplete score/)
  assert.match(three, /do not run the gate again/)
  assert.match(three, /When `write` sent you here, go back to it/)
})
test('option 3 still needs something to check, and --ci never takes it', () => {
  assert.ok(three.includes('There is nothing to check yet — paste what should happen, or stop.'))
  assert.match(doc, /It never takes 3/)
})
test('write accepts the hand-off from ticket-eval option 3 without scoring again', () => {
  assert.match(write, /Coming from ticket-eval's option 3/)
  assert.match(write, /skip this step/)
})
test('option 2: a fill-in that passes goes straight to the Jira update preview, still behind a yes', () => {
  const end = doc.slice(doc.indexOf('After the last item, re-run'), doc.indexOf('\n## Examples'))
  assert.match(end, /`pass` with at least one answer accepted: what was typed goes to Jira next/)
  assert.ok(end.indexOf('ticket.mjs jira-update') < end.indexOf('1. Update the Jira ticket'), 'the preview comes before the card')
  assert.match(end, /\*\*1:\*\* only now write to Jira/)
  assert.doesNotMatch(doc, /Also add what you typed/)
})
test('option 3 posts nothing itself: write offers the risk note at its end', () => {
  assert.match(three, /Post nothing now \(`write` offers the risk note at its end\)/)
})

test('fullstack: step 4b finds the side, asks only when the ticket does not say, never with --ci', () => {
  const b = doc.slice(doc.indexOf('4b. **Side**'), doc.indexOf('5. **Score.**'))
  assert.ok(b.includes('(only for `adapter: fullstack`)'))
  assert.ok(b.includes('`ticket.mjs side --in @<ticketsDir>/<KEY>/ticket.json`'))
  assert.ok(b.includes('1. The frontend: a screen (Playwright tests)\n   2. The backend: the code behind it (Vitest tests)\n   3. Both (fullstack)'))
  assert.match(b, /`--ci` never asks: it goes on, and the ticket is scored for both sides/)
  assert.ok(b.includes('`ticket.mjs side --in @<ticketsDir>/<KEY>/ticket.json <frontend|backend|fullstack>`'))
  assert.match(qa, /or `adapter: fullstack` and the ticket is not marked backend/)
  assert.ok(doc.includes('`SIDE_JSON:`'), 'the machine line is dropped')
})
