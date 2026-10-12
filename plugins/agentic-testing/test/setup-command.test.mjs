// The setup command is a prompt, not code: these pin the instructions that keep it usable on a
// large Jira project shared by many teams.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/setup.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`))

test('step 2: the field lookup is for Story, all fields, and a saved result is searched, never read whole', () => {
  const s = step(2)
  assert.match(s, /getJiraIssueTypeMetaWithFields/)
  assert.match(s, /Story/)
  assert.match(s, /`requiredFieldsOnly` `false`/)
  assert.match(s, /saved to a file/)
  assert.match(s, /never read (?:the|that) file whole/i)
  assert.ok(s.includes('/acceptance criteria|criteri di accettazione/i'))
  assert.match(s, /grep|node -e|jq/)
  assert.match(s, /more than one/)
  assert.match(s, /None/)
})
test('step 3: the label search can be narrowed before counting', () => {
  const s = step(3)
  for (const option of ['1. All recent tickets of the project', '2. Only tickets with a word in the title', '3. Only one component', "4. I'll type my labels"]) {
    assert.ok(s.includes(option), option)
  }
  assert.ok(s.includes('summary ~ "<word>"'))
  assert.ok(s.includes('component = "<component>"'))
  assert.ok(s.includes('labels = "<label>"'))
  assert.match(s, /searchResultMode`? `?count/)
  assert.match(s, /fields `labels,summary`/)
  assert.match(s, /`maxResults` 100/)
  assert.match(s, /unknown/i)
  assert.match(s, /Title prefixes[\s\S]*narrowed/)
})
test('Jira tools are named by operation, never by an mcp__ tool name', () => {
  assert.doesNotMatch(doc, /mcp__/)
})
test('step 3 (playwright): qaPlanSearch from the label, and the Confluence spaces offered', () => {
  const s = step(3)
  assert.match(s, /`_` and `-` replaced by spaces/)
  assert.match(s, /searchConfluenceUsingCql/)
  assert.match(s, /distinct spaces/)
  assert.match(s, /key and name/)
  assert.ok(s.includes('<n>. All spaces'))
  assert.match(s, /`confluenceSpaces`/)
  assert.match(step(6), /confluenceSpaces/)
  assert.match(step(6), /qaPlanSearch/)
})
