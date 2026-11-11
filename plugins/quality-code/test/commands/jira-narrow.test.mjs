// The Jira calls the commands and guides tell the agent to make stay small: narrow `fields`, small `maxResults`,
// and the issue-type metadata (148 fields) is saved and searched by name, never read whole.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const FILES = ['commands/ticket.md', 'commands/spec.md', 'commands/setup.md', 'guides/ticket-eval.md', 'guides/tickets-eval.md']

test('no ticket, spec, setup or eval step asks Jira for all fields', () => {
  for (const f of FILES) assert.doesNotMatch(read(f), /\*all/, f)
})
test('ticket: the key read leaves out comments and dates; the search keeps four small fields', () => {
  const d = read('commands/ticket.md')
  assert.match(d, /fields `summary,issuetype,status,labels,assignee,reporter,description,parent,subtasks,issuelinks`/)
  assert.doesNotMatch(d, /fields `[^`]*\bcomment\b/)
  assert.match(d, /`maxResults` 10, fields `summary,issuetype,status,assignee` and nothing else/)
})
test('tickets-eval: pages of 25 with an exact field list, at most two calls', () => {
  const d = read('guides/tickets-eval.md')
  assert.match(d, /`maxResults` is 25 per call/)
  assert.match(d, /`fields` are exactly `summary,issuetype,status,labels,components,description,<criteria field>,issuelinks,attachment`/)
})
test('setup: the project searches take 50 and only the fields they count', () => {
  const d = read('commands/setup.md')
  assert.doesNotMatch(d, /`maxResults` 100/)
  assert.match(d, /`maxResults` 50, fields `components` only/)
  assert.match(d, /`maxResults` 50, fields `labels,summary`/)
})
test('every search that lists tickets names its fields and a maxResults of 50 or less', () => {
  for (const f of FILES) for (const line of read(f).split('\n')) {
    if (!/searchJiraIssuesUsingJql/.test(line) || /searchResultMode|Read-only|\*\*One search/.test(line)) continue
    if (!/maxResults|fields/.test(line)) continue
    assert.match(line, /fields/, `${f}: ${line.slice(0, 80)}`)
    const m = line.match(/`maxResults` (?:is )?(\d+)/)
    assert.ok(m && Number(m[1]) <= 50, `${f}: maxResults <= 50: ${line.slice(0, 80)}`)
  }
})
test('issue-type metadata is saved and searched by name, never read whole; tickets-eval defers to that step', () => {
  const d = read('guides/ticket-eval.md')
  assert.match(d, /getJiraIssueTypeMetaWithFields/)
  assert.match(d, /Never read that file whole, and never read the result inline/)
  assert.ok(d.includes('field find @<file>'))
  assert.match(read('guides/tickets-eval.md'), /search the saved result, never read it whole/)
})
