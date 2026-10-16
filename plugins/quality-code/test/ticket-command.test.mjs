// /quality-code:ticket: find and show a ticket, read-only, with suggestions never written to Jira.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/ticket.md', import.meta.url), 'utf8')

test('read-only on Jira: only the read tools; never a score', () => {
  assert.match(doc, /Only `getJiraIssue`, `searchJiraIssuesUsingJql` and `lookupJiraAccountId`/)
  assert.match(doc, /Never edit, comment or transition a ticket here/)
  assert.match(doc, /never say a score here/)
  for (const tool of ['editJiraIssue', 'addCommentToJiraIssue', 'transitionJiraIssue']) assert.ok(!doc.includes(tool), tool)
})
test('find: key, digits, filters scoped to the configured projects, else words; 10 newest', () => {
  assert.match(doc, /Only digits: the key is `<first of jira\.projects>-<digits>`/)
  assert.match(doc, /inside `project in \(<jira\.projects>\)`/)
  assert.match(doc, /`assignee:me` and `reporter:me` are `currentUser\(\)`/)
  assert.match(doc, /`epic:<KEY>` is `parent = <KEY>`/)
  assert.match(doc, /Escape `\\` as `\\\\` and `"` as `\\"` in every value first/)
  assert.match(doc, /`ORDER BY updated DESC`, `maxResults` 10/)
})
test('suggestions: only what the ticket shows, a skeleton never filled in, nothing written', () => {
  assert.ok(doc.includes('Suggestions for the ticket (nothing is written to Jira; copy what you agree with):'))
  assert.match(doc, /an empty `Scenario:` \/ `Given` \/ `When` \/ `Then` block, never with invented content/)
  assert.match(doc, /skip when the status is Done, Closed or Resolved/)
  assert.ok(doc.includes('`To check it is ready for tests: /quality-code:ticket-eval <KEY>`'))
  assert.match(doc, /Redact customer ids/)
})
