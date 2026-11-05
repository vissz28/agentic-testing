// The qa command is a prompt, not code: these pin what keeps a QA run safe on a watched Jira board:
// the tester decides every verdict, and every Jira write waits for a preview and a yes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/qa.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? doc.indexOf('\n## Examples') : doc.indexOf(`\n${n + 1}. **`))
const TICKET = 'node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs"'

test('frontmatter has a description and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: <KEY> \[--app <url>\] \[--resume\] \[--auto-pass\] \[--dry-run\] \| --watch \| --watch-check\n(?:[a-z-]+: .+\n)*---/)
})
test('steps come in order: check, pick, context, run, defect, retest, close', () => {
  const at = ['Check', 'The run', 'Context', 'Run, one test at a time', 'Defect', 'Retest', 'Close'].map((s, i) => doc.indexOf(`\n${i + 1}. **${s}`))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('the tester decides: a browser problem is Not verified, never KO, and an unseen step is never ✅', () => {
  assert.match(doc, /\*\*The tester decides\.\*\*/)
  assert.match(doc, /A browser problem is never a KO/)
  assert.match(doc, /a step you did not see is never ✅/)
  assert.match(step(4), /never start the next test before an answer/)
})
test('Jira writes go through the connector after a yes; the browser only reads Jira; --dry-run sends nothing', () => {
  assert.match(doc, /Each write \(defect, link, attachment, comment, status, Xray run status\) is shown first, and sent only when the tester answers `1`/)
  assert.match(doc, /never click, type or change anything on a Jira page/)
  assert.ok(doc.includes('`Not sent (--dry-run): copy it if you want it.`'))
})
test('no passwords: the tester signs in; none in a defect, a comment or the chat', () => {
  assert.match(doc, /Never ask for a password, never type one, and never put a password, token or cookie in a defect, a comment or the chat/)
})
test('step 1: config check (repo or personal), Jira only from the connectors guide, and the no-browser card', () => {
  const s = step(1)
  assert.ok(s.includes(`${TICKET} config check`))
  assert.ok(s.includes('guides/connectors.md'))
  assert.match(s, /Leave GitLab, GitHub and Figma out/)
  assert.ok(s.includes('1. I test by hand and tell you what I saw'))
})
test('step 2: the key is mandatory and must be a test execution', () => {
  const s = step(2)
  assert.ok(s.includes('The key is mandatory'))
  assert.ok(s.includes('pass the test execution to run: /quality-code:qa <KEY>'))
  assert.match(s, /qa\.executionTypes/)
  assert.ok(!s.includes('--first'))
})
test('step 3: the sources in order: the Xray API, an attached export (no flag), the browser, then attach or paste', () => {
  const s = step(3)
  const at = ['First from the Xray API', 'Next, from an Xray export', 'read the Xray tests panel', 'Attach this run'].map(x => s.indexOf(x))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
  assert.match(s, /`get_test_run` with the run's key/)
  assert.ok(s.includes('`Xray API: <the error>. Reading the tests another way.`'), 'an API error falls back, it never stops the run')
  assert.match(s, /when the user's message carries one: a file attached in the app, or a file path in the message/)
  assert.ok(s.includes('`Save it as CSV (in Excel: File, Save as, CSV UTF-8) and attach that.`'))
  assert.match(s, /Only read these pages/)
  assert.ok(s.includes('`Attach this run\'s Xray export (CSV), or paste the test cases (key, steps and expected results), then send.`'))
  assert.doesNotMatch(doc, /--cases/)
})
test('step 5: the defect goes under the epic, in the active sprint, to the story\'s developer, linked by Defect', () => {
  const s = step(5)
  assert.match(s, /the story's parent \(its epic\)/)
  assert.match(s, /sprint whose state is `active`/)
  assert.match(s, /\*\*Assignee:\*\* the story's assignee/)
  assert.match(s, /type named `Defect`/)
  assert.match(s, /reporter = currentUser\(\)/)
  assert.ok(s.includes(`${TICKET} jira-posted <DEFECT KEY> defect`))
})
test('steps 6 and 7: retest comment and status moves are logged; Xray statuses by hand, or by the API after a yes', () => {
  assert.ok(step(6).includes(`${TICKET} jira-posted <BUG KEY> retest`))
  const s = step(7)
  assert.ok(s.includes(`${TICKET} jira-posted <KEY> status`))
  assert.match(s, /In Xray, set these by hand/)
  assert.match(s, /the story is not changed/)
  assert.ok(s.indexOf('1. Set them') < s.indexOf('`set_test_run_status`'), 'the card comes before the write')
  assert.match(s, /it gives one name, or `ask` with the candidates: then ask the tester once/)
  assert.ok(s.includes(`${TICKET} jira-posted <TEST KEY> status`))
})
test('Xray API: step 1 says when it is on; step 5 adds the defect to the test\'s run', () => {
  assert.ok(step(1).includes('`· ✅ Xray API`'))
  assert.match(step(5), /With the Xray API: `add_defect_to_test_run` with the test's run id and the defect key/)
  assert.ok(step(5).indexOf('It is also added to the run') < step(5).indexOf('1. Create it'), 'the preview says so before the yes')
})
test('Jira tools are named by operation, never by an mcp__ tool name (only the allowed-tools line has them)', () => {
  assert.doesNotMatch(doc.slice(doc.indexOf('\n---\n', 4)), /mcp__/)
  assert.ok(doc.includes('"Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`'))
})

test('step 3: a Done run or someone else\'s offers a dry run first, and a missing Jira sign-in is waited for', () => {
  const s = step(3)
  assert.ok(s.includes('A run that is not yours to run.'))
  assert.ok(s.includes('Dry run: show every verdict and defect, send nothing'))
  assert.ok(s.includes('Jira is not signed in in the browser pane.'))
  assert.ok(s.includes('Tip: with the Xray API key set'))
})

test('step 3: the run is read with all its fields, attachments and web links included', () => {
  const s = step(3)
  assert.ok(s.includes('`fields` `["*all"]`'))
  assert.ok(s.includes('getJiraIssueRemoteIssueLinks'))
  assert.match(s, /An attached `\.csv` is the run's Xray export/)
  assert.ok(s.includes('Nothing more on the run.'))
})

test('step 3: the story flow lists every run of the story, as the template for every task', () => {
  const s = step(3)
  assert.ok(s.includes('**The story\'s flow:**'))
  assert.ok(s.includes('Story flow (<R> runs)'))
  assert.ok(s.includes('NON RISOLVIBILE'), 'a not-fixable bug is shown, not retested')
  assert.match(doc, /Next in this story:/)
})
test('step 2: a key that is not a test execution starts the task flow: subtasks, one item at a time, merge requests, an e2e plan', () => {
  const s = step(2)
  assert.ok(s.includes('The task flow'))
  assert.match(s, /parent = <KEY>/)
  assert.match(s, /Pick which to test/)
  assert.match(s, /Merge requests/)
  assert.match(s, /end-to-end plan by best practice/)
  assert.match(s, /Nothing is written to Jira unless/)
})
test('task flow: merge request links need the source code connector; not connected points to /mcp and setup, never skipped silently', () => {
  const s = step(2)
  assert.match(s, /Merge requests found in a ticket/)
  assert.match(s, /Continue without the code/)
  assert.match(s, /\/quality-code:setup/)
  const g = readFileSync(new URL('../../guides/connectors.md', import.meta.url), 'utf8')
  assert.match(g, /Merge requests found in a ticket/)
  assert.match(g, /Signed in: read the merge requests/)
  assert.match(g, /do not skip it silently/)
})
