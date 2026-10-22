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
  assert.ok(s.includes('`node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" field find @<file>`'), 'the script finds the field, not a grep the command never pre-approved')
  assert.match(s, /FIELD_MATCHES_JSON:/)
  assert.doesNotMatch(s, /grep|node -e|jq/)
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
const write = readFileSync(new URL('../../commands/spec.md', import.meta.url), 'utf8')
const three = doc.slice(doc.indexOf('\n- **3:** developer override'), doc.indexOf('\n## Send-preview'))

test('option 3 is shown word for word with the red tag', () => {
  assert.ok(doc.includes('3. 🔴 **[RISK / NOT RECOMMENDED]** Continue anyway (developers only). The user story is not complete.'))
})
test('option 3 continues: on its own it goes straight on to writing the tests, marked incomplete', () => {
  assert.doesNotMatch(three, /then stop; callers that build on this command decide/)
  assert.ok(three.includes('${CLAUDE_PLUGIN_ROOT}/commands/spec.md'))
  assert.match(three, /incomplete score/)
  assert.match(three, /do not run the gate again/)
  assert.match(three, /When `spec` sent you here, go back to it/)
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
test('option 3 posts nothing itself: spec offers the risk note at its end', () => {
  assert.match(three, /Post nothing now \(`spec` offers the risk note at its end\)/)
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
test('the score is shown only as the script prints it; refuse-comment exit 1 is expected', () => {
  assert.ok(!doc.includes('Never say the score to the user'), 'it contradicted "Relay the report"')
  assert.match(doc, /\*\*The score is the script's\.\*\* Show it only as the script prints it/)
  assert.match(doc, /Never compute, estimate, round or restate a score of your own/)
  assert.match(doc, /it exits 1 for a refused ticket: that is expected, not an error/)
  assert.ok(doc.includes('"Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`'))
  assert.ok(doc.includes('as "Updating a comment" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` says'))
})

// The gate as /quality-code:spec uses it: the cheapest fix first, the fill-in in one reply, answers kept between runs.
test('step 5 scores with --next: the To pass line and the band', () => {
  assert.ok(doc.includes('`ticket.mjs score --in @<ticketsDir>/<KEY>/ticket.json --next`'))
  assert.match(doc, /`GATE_JSON:` \(`band`: `ready`, `borderline` or `refused`; `fix`: the fewest missing items that reach the bar\)/)
  assert.match(doc, /`\/quality-code:spec` goes on without it for a `borderline` band/)
  assert.match(doc, /`\/quality-code:spec <KEY> --gate-only` is the same command/)
})
test('the refuse card leads with the cheapest fix; fill in first, then comment, continue anyway, stop; --ci comments', () => {
  const card = doc.slice(doc.indexOf('## The refuse card'), doc.indexOf('## Send-preview'))
  assert.ok(card.includes('<the To pass: line, as the score printed it>\nThis ticket needs a bit more information. We cannot start yet.\n\n1. I will add the missing information here.\n2. Post a comment on Jira with what to add.\n3. 🔴'))
  assert.ok(card.includes('\n4. Stop\n```'))
  assert.match(card, /`--ci` takes 2: it skips the send-preview, posts the comment, and exits 1\. It never takes 3\./)
  const at = ['- **1:** the guided fill-in', '- **2:** do not post yet', '- **3:** developer override', '- **4:** stop'].map(s => card.indexOf(s))
  assert.ok(at.every(i => i > 0) && [...at].sort((a, b) => a - b).join() === at.join(), JSON.stringify(at))
})
test('step 1b: answers from an earlier run that never reached Jira are offered, never with --ci', () => {
  const s = doc.slice(doc.indexOf('1b. **Answers from last time.**'), doc.indexOf('2. **Read the ticket.**'))
  assert.ok(s.includes('bin/ticket.mjs" saved <KEY>'))
  assert.match(s, /Not with `--ci`/)
  assert.ok(s.includes('1. Use them: send them to Jira, then go on\n   2. Start over (they are dropped)'))
  assert.match(s, /skip steps 2 and 3 \(no new read, no new sanitize\)/)
  assert.match(doc, /coming from step 1b, go on at step 4 instead/)
})
test('the fill-in takes every picked item in one reply, ok takes the To pass items, add still decides each answer', () => {
  const f = doc.slice(doc.indexOf('## Guided fill-in'), doc.indexOf('After the last item'))
  assert.match(f, /or ok for <the numbers of the items in the To pass: line>/)
  assert.ok(f.includes('Answer in one message, one line per number. Type "skip" for one you leave out.'))
  assert.match(f, /one call each/)
  assert.match(f, /Items answered `Not accepted:` come back together in the same card/)
  assert.match(f, /Only `add` writes `ticket\.json`, and only when the answer counts/)
  assert.doesNotMatch(f, /One item at a time/)
})
test('a suggestion only quotes the merge request or the commits, never invents a value or a result', () => {
  const f = doc.slice(doc.indexOf('- **Suggested**'), doc.indexOf('- Then, for each line'))
  assert.match(f, /the merge request's description \(`mergeRequest\.description` in `ticket\.json`, redacted; never the text as the connector returned it\) or the branch's commit messages \(`subjects` in `BRANCH_JSON`\)/)
  assert.match(doc, /`mergeRequest`: when `spec` found the branch's merge request \(GitLab\) or pull request .* `sanitize` redacts it, whichever host it came from/)
  assert.match(f, /never add a value, a number or a result the source does not state, and never suggest an expected or actual result/)
  assert.match(f, /leave the line out when there is none/)
})
