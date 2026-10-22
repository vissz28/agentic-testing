// The tickets-eval command is a prompt, not code: these pin the rules that keep it read-only and bounded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/tickets-eval.md', import.meta.url), 'utf8')
const evalDoc = readFileSync(new URL('../commands/ticket-eval.md', import.meta.url), 'utf8')

test('frontmatter', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: <PROJECT> \[--user <name>\] \[--status <status>\] \[--limit N\] \[--json\]\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/\*\)\nmodel: sonnet\n---\n/)
})
test('the run-scripts-as-written rule is copied word for word from ticket-eval', () => {
  const rule = l => l.startsWith('- **Run each plugin script exactly as written:**')
  assert.equal(doc.split('\n').find(rule), evalDoc.split('\n').find(rule))
})
test('it checks the config, needs a project key in jira.projects or jira.trackingProjects, and finds the criteria field', () => {
  assert.ok(doc.includes('config check'))
  assert.match(doc, /line starting with `ok`/)
  assert.ok(doc.includes('jira.projects') && doc.includes('jira.trackingProjects'))
  assert.ok(doc.includes('field get'))
})
test('one search with the spec JQL, markdown, a capped limit and paging', () => {
  assert.equal(doc.match(/ONE `searchJiraIssuesUsingJql`/g)?.length, 1)
  assert.ok(doc.includes('project = <PROJECT>'))
  assert.ok(doc.includes('AND assignee = "<user>"'))
  assert.ok(doc.includes('AND status = "<status>"'))
  assert.ok(doc.includes('ORDER BY updated DESC'))
  assert.match(doc, /`responseContentFormat` is `markdown`/)
  assert.match(doc, /default 50, cap 200/)
  assert.ok(doc.includes('nextPageToken'))
  assert.match(doc, /Escape `\\` as `\\\\` and `"` as `\\"`/)
})
test('it runs the batch and shows the card without the machine line', () => {
  assert.ok(doc.includes('ticket.mjs" tickets-eval --in @'))
  assert.ok(doc.includes('TICKETS_EVAL_JSON:'))
})
test('it is read-only on Jira and names tools by operation', () => {
  assert.match(doc, /Read-only/)
  assert.match(doc, /never (comment|edit)/i)
  assert.doesNotMatch(doc, /addCommentToJiraIssue|editJiraIssue|transitionJiraIssue/)
  assert.doesNotMatch(doc, /mcp__/)
})

test('attachments are a count only, and a linked issue becomes a browse link; web links only when there is none', () => {
  assert.ok(doc.includes('"attachments": 0, "links": [{ "url": "…", "title": "…" }]'))
  assert.match(doc, /Only the count: never a file name/)
  assert.ok(doc.includes('`url` = `<jira.site>/browse/<linked KEY>`'))
  assert.match(doc, /Only for a ticket with no linked issue, also read its web links/)
})
