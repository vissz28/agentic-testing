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

test('attachments and links: step 2 reads them as a count and a list, the fill-in re-reads for an attachment', () => {
  const s2 = doc.slice(doc.indexOf('2. **Read the ticket.**'), doc.indexOf('3. **Save and sanitize.**'))
  assert.match(s2, /issuelinks,attachment`/)
  assert.match(s2, /Only the count: never a file name, never an attachment URL/)
  assert.match(s2, /`listJiraIssueRemoteIssueLinks`/)
  assert.match(doc, /"attachments": 0, "links": \[\{ "url"/)
  const fill = doc.slice(doc.indexOf('**Two items are different.**'), doc.indexOf('After the last item, re-run'))
  assert.match(fill, /valid `http:\/\/` or `https:\/\/` address/)
  assert.match(fill, /attach a screenshot, video or file on the Jira ticket itself/)
  assert.match(fill, /read the ticket again: `getJiraIssue` with fields `attachment` only/)
  assert.match(fill, /ticket\.mjs attachments --in @<ticketsDir>\/<KEY>\/ticket\.json <count>/)
  assert.match(fill, /The script re-scores and is the only decider/)
})

// Figma fill-in: the list line, the drafts, and the limits on them.
const fig = doc.slice(doc.indexOf('## Draft from Figma and my changes'), doc.indexOf('After the last item, re-run'))
test('Figma: the list card gets the draft line only with Figma links and a connected connector', () => {
  const list = doc.slice(doc.indexOf('1. **The list.**'), doc.indexOf('2. **The pick.**'))
  assert.match(list, /`figma` list is not empty/)
  assert.match(list, /`figma` or `figma-token`/)
  assert.match(list, /no tools, no line/)
  assert.ok(fig.includes('<n>. Draft from Figma and my changes (<the titles of the items marked design: true>)'))
  assert.match(fig, /acceptance criteria, expected behaviour, steps or user story, and nothing else/)
  assert.match(fig, /never given to `pick` as it is/)
})
test('Figma: reads the design with the connector and loads its own skills', () => {
  assert.match(fig, /`get_metadata`, or `get_design_context`/)
  assert.match(fig, /screenshot only if the text is not enough/)
  assert.match(fig, /\/figma-design-to-code/)
  assert.match(fig, /frames, texts, labels and states/)
  assert.match(fig, /never change the Figma file/)
})
test('Figma: the branch changes come from branch.mjs --detect, code files not deleted, a short diff', () => {
  assert.ok(fig.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect'))
  assert.match(fig, /files of kind `code` whose status is not `D`/)
  assert.ok(fig.includes('git diff <base>...HEAD -- <those files>'))
  assert.match(fig, /kept short/)
})
test('Figma: a personal config or no git repo uses the design only', () => {
  assert.ok(fig.includes('`ok (personal:`'))
  assert.match(fig, /no git repo, use the design only and do not run git/)
})
test('Figma: drafts use only what is shown, never invent values, and open questions block sending', () => {
  assert.match(fig, /Gherkin[^.]*preferred for acceptance criteria/)
  assert.match(fig, /ticket's language/)
  assert.match(fig, /Never invent values/)
  assert.ok(fig.includes('`<which total?>`'))
  assert.match(fig, /never sent as it is/)
})
test('Figma: the draft is shown as it would be added, with Use it / Edit / Skip, and the turn ends', () => {
  assert.ok(fig.includes('1. Use it\n  2. Edit\n  3. Skip'))
  assert.match(fig, /exactly as it would be added, then end the turn/)
})
test('Figma: Use it goes through add like a typed answer, Edit sends their text, Skip moves on; the script decides', () => {
  assert.ok(fig.includes('ticket.mjs add --in @<ticketsDir>/<KEY>/ticket.json <key> --drafted -- "<the draft, verbatim>"'))
  assert.match(fig, /exactly like a typed answer/)
  assert.match(fig, /The script decides whether it counts/)
  assert.match(fig, /\*\*2:\*\* ask for their edited text, and send that through `add`/)
  assert.match(fig, /\*\*3:\*\* move on/)
  assert.match(fig, /the model never grades/)
})
test('Figma: no Jira write without the preview and a yes, append only, nothing sent elsewhere; the usual flow continues', () => {
  assert.match(fig, /never write to Jira without the preview and a yes/)
  assert.match(fig, /it appends/)
  assert.match(fig, /never send code or design content anywhere else/)
  assert.match(fig, /re-score, the preview and the push card/)
})
// AGT-116: criteria drafted from the ticket's own text; the author confirms, the script scores.
const draft = doc.slice(doc.indexOf('## Draft the criteria from the ticket'), doc.indexOf('## Draft from Figma and my changes'))
test('ticket draft: only for the criteria items, only from the ticket\'s own text, Figma first', () => {
  assert.ok(draft.length > 0)
  assert.match(draft, /The model drafts, the author confirms, the script scores/)
  assert.ok(draft.includes('(`ac_present`, `ac_testable`)'))
  assert.match(draft, /only when Figma is not drafting them/)
  assert.ok(draft.includes('`text.description`, `text.acField`'))
  assert.match(draft, /`scenarios`, or XRay tests among its `links`/)
  assert.match(draft, /Nothing of that: no draft/)
  assert.match(draft, /Attachments are never opened/)
  const step3 = doc.slice(doc.indexOf('3. **All at once.**'), doc.indexOf('\n', doc.indexOf('3. **All at once.**')))
  assert.match(step3, /draft them first \(see \*\*Draft the criteria from the ticket\*\*\)/)
})
test('ticket draft: Given / When / Then in the ticket\'s language, never invented values, a question blocks sending', () => {
  assert.match(draft, /in the ticket's language, as Given \/ When \/ Then steps/)
  assert.match(draft, /Never invent values/)
  assert.ok(draft.includes('`<which message?>`'))
  assert.match(draft, /never sent as it is/)
  assert.match(draft, /do not send it: ask for the values first/)
})
test('ticket draft: the card is Use it / Edit / Skip and the turn ends', () => {
  assert.ok(draft.includes('Drafted from the ticket. Check it before it counts.\n\n  <the draft>\n\n  1. Use it\n  2. Edit\n  3. Skip'))
  assert.match(draft, /exactly as it would be added, then end the turn/)
})
test('ticket draft: Use it and Edit go through add --drafted; the script scores, a rejection shows its reason', () => {
  assert.ok(draft.includes('ticket.mjs add --in @<ticketsDir>/<KEY>/ticket.json <key> --drafted -- "<the draft, verbatim>"'))
  assert.match(draft, /marks the answer as drafted in `ticket.json` and in the local audit log \(for `\/quality-code:kpi`\); it never changes the score/)
  assert.match(draft, /\*\*2:\*\* ask for their edited text, and send that through `add` the same way, with `--drafted`\. The script scores the edited text/)
  assert.match(draft, /\*\*3:\*\* the item goes on the card with the other items, typed by hand/)
  assert.match(draft, /\*\*Not accepted:\*\* show the line with the script's reason as printed/)
  assert.match(draft, /rejected twice, the item goes on the card/)
  assert.match(draft, /the model never grades/)
})
test('ticket draft: Jira only through the update preview and option 1; Do not update sends nothing', () => {
  assert.match(draft, /through the re-score, the `jira-update` preview and option 1 of its card/)
  assert.match(draft, /On `2\. Do not update, just continue` or `3\. Cancel` nothing is sent to Jira/)
  assert.match(draft, /Never write a draft to Jira without that preview and a yes/)
  assert.ok(doc.includes('1. Update the Jira ticket\n2. Do not update, just continue\n3. Cancel'))
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
test('the fill-in list is never empty: with no items, the card says what is missing and the refuse card follows without option 1', () => {
  const list = doc.slice(doc.indexOf('1. **The list.**'), doc.indexOf('\n', doc.indexOf('1. **The list.**')))
  assert.match(list, /When `FILL_JSON` has no `items`, there is nothing to type in: show the card's lines as printed, then the refuse card without its option 1/)
})
