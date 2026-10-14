// The setup command is a prompt, not code: these pin the instructions that keep it usable on a
// large Jira project shared by many teams.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/setup.md', import.meta.url), 'utf8')
// Steps are "0." to "4." for the short setup and "A1." to "A5." for the advanced one.
const step = id => {
  const from = doc.indexOf(`\n${id}. **`)
  const rest = doc.slice(from + 1)
  const next = rest.slice(1).search(/\n(?:\d+|A\d+)\. \*\*/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

test('A2: the label search can be narrowed before counting', () => {
  const s = step('A2')
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
test('A2 (playwright): qaPlanSearch from the label, and the Confluence spaces offered', () => {
  const s = step('A2')
  assert.match(s, /`_` and `-` replaced by spaces/)
  assert.match(s, /searchConfluenceUsingCql/)
  assert.match(s, /distinct spaces/)
  assert.match(s, /key and name/)
  assert.ok(s.includes('<n>. All spaces'))
  assert.match(s, /`confluenceSpaces`/)
  assert.match(step('A5'), /confluenceSpaces/)
  assert.match(step('A5'), /qaPlanSearch/)
})
test('A2: every typed value is escaped for JQL; the title word keeps letters, digits and spaces', () => {
  const s = step('A2')
  assert.match(s, /escape `\\` as `\\\\` and `"` as `\\"`/)
  assert.match(s, /title word, a component name, a label/)
  assert.match(s, /letters, digits and spaces only/)
  assert.doesNotMatch(s, /drop any `"` from it/)
})
test('A2: the component card ends with a way to type a component name', () => {
  assert.ok(step('A2').includes('`<n>. Type a component name`'))
})
test('A2 (playwright): each feature\'s QA-plan search is tried once, and a title mismatch offers the hits', () => {
  const s = step('A2')
  assert.match(s, /ONE `searchConfluenceUsingCql` per feature/)
  assert.match(s, /scoped to the picked spaces/)
  assert.match(s, /no hit's title contains all the words/)
  assert.match(s, /up to 5 hit titles/)
  assert.ok(s.includes('`<n>. Type other search words`'))
  assert.ok(s.includes('`<n>. No QA plan for this feature`'))
  assert.match(s, /search words taken from that title/)
})

test('the short setup asks only for connectors, the project here and the Jira project', () => {
  const short = doc.slice(0, doc.indexOf('## Advanced'))
  assert.ok(step(0).includes('core/connectors.md'))
  assert.ok(step(1).includes('This project'))
  assert.ok(step(1).includes('here.gitlab'))
  assert.match(step(1), /check gitlab_api_url/)
  assert.ok(step(2).includes('getVisibleJiraProjects'))
  assert.match(step(2), /Ask nothing else/)
  for (const w of ['getJiraIssueTypeMetaWithFields', 'labels,summary', 'titlePrefixes', 'searchConfluenceUsingCql', 'Templates.']) assert.ok(!short.includes(w), w)
  assert.ok(step(3).includes('jira { site, projects }'))
  assert.match(step(3), /keep every other field of `existing` unchanged/)
  assert.ok(step(4).startsWith('4. **Done.**'))
  assert.match(step(4), /Do not read, score or comment on any ticket/)
  assert.doesNotMatch(step(4), /ticket-eval\.md|searchJiraIssuesUsingJql|getJiraIssue/)
  for (const c of ['/quality-code:start', '/quality-code:ticket-eval <KEY>', '/quality-code:setup advanced']) assert.ok(step(4).includes(c), c)
})
test('advanced keeps the full questions and needs a config', () => {
  assert.match(doc, /If `\$ARGUMENTS` contains `advanced`, go to \*\*Advanced\*\*/)
  assert.match(step('A1'), /trackingProjects/)
  assert.match(step('A3'), /Language and redaction/)
  assert.match(step('A4'), /Templates/)
  assert.match(doc.slice(doc.indexOf('## Advanced')), /without one, run steps 0 to 3 first/)
})

test('A4: the boundaries card (advanced setup; the short setup uses the defaults)', () => {
  const s = step('A4')
  assert.match(s, /Paths a test run must never change/)
  for (const o of ['1. Keep this list', '2. Add a path', '3. Remove a path']) assert.ok(s.includes(o), o)
  assert.match(s, /specsBesideCode/)
  assert.ok(s.includes('src/**/*.spec.ts'))
  assert.match(step('A5'), /boundaries/)
})
