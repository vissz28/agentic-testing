// The seed command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/seed.md', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../guides/seed-data.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? doc.indexOf('\n## Setting it up') : doc.indexOf(`\n${n + 1}. **`))
const SEED = 'node "${CLAUDE_PLUGIN_ROOT}/bin/seed.mjs"'

test('frontmatter has a description that says local, and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .*LOCAL database.+\nargument-hint: <KEY>\n(?:[a-z-]+: .+\n)*---/)
})
test('steps come in order: check, ticket and gate, schema, dataset, plan, write, load', () => {
  const at = ['\n1. **Check.**', '\n2. **Ticket and gate.**', '\n3. **Schema.**', '\n4. **Dataset.**', '\n5. **Plan.**', '\n6. **Write.**', '\n7. **Load.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('the rules: local only through the loader, never around a refusal, never application code, no tokens', () => {
  assert.match(doc, /\*\*Local database only\.\*\* Data reaches the database only through `seed\.mjs load`/)
  assert.match(doc, /Never run SQL yourself and never reach a database another way/)
  assert.match(doc, /Never change `seed\.target` or `seed\.apply`, and never work around a `refused:` line/)
  assert.match(doc, /never a real customer/)
  assert.match(doc, /\*\*Never edit application code\.\*\*/)
  assert.match(doc, /Never ask for a token/)
  assert.match(doc, /never show one or a connection string/)
  assert.doesNotMatch(doc, /mcp__/)
  assert.doesNotMatch(doc, /--path|builders|stubsFrom|page\.route/, 'the test-data printer is gone')
})
test('step 1: config check, then the target check before anything else, connectors with Jira', () => {
  const s = step(1)
  assert.ok(s.includes('ticket.mjs" config check'))
  assert.ok(s.includes(`${SEED} target`))
  assert.ok(s.indexOf('seed.mjs" target') < s.indexOf('connectors.md'), 'a refused target stops before Jira is read')
  assert.match(s, /Exit 1: show its `refused:` line, say `Nothing was loaded\.` and stop/)
  assert.match(s, /keep its `target:` line for the plan card/)
  assert.match(s, /Jira is required/)
})
test('step 2: the gate applies; only a passing ticket goes on', () => {
  const s = step(2)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md'))
  assert.match(s, /steps 1–5/)
  assert.match(s, /so the gate applies/)
  assert.ok(s.includes('Mock data needs a ticket that passes the gate.'))
  assert.match(s, /Option 3 \(continue anyway\)/)
  assert.ok(s.includes('<ticketsDir>/<KEY>/ticket.json'))
  assert.match(s, /never invent it/)
})
test('step 3: the guides, then the schema from the config or a numbered card', () => {
  const s = step(3)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/guides/seed-data.md'))
  assert.match(s, /then `seed\.guide` when it is set: the team's own rules, on top of it \(they win where they differ\)/)
  assert.ok(s.includes('Which file describes the database?\n     1. <path>\n     2. <path>\n     3. Another file\n     4. Stop'))
  assert.ok(s.includes('No database schema found. Name it in seed.schema in the config, then run this again.'))
  assert.match(s, /every table whose rows point at the ones you fill/)
})
test('step 4: one dataset per feature, reused; the ticket\'s case in its own file', () => {
  const s = step(4)
  assert.ok(s.includes('<ticketsDir>/seed/<feature>.sql'))
  assert.match(s, /Tickets of one feature share it/)
  assert.match(s, /reuse it as it is/)
  assert.ok(s.includes('<ticketsDir>/<KEY>/seed.sql'))
})
test('step 5: the plan card names the target and what the reset empties before anything is loaded', () => {
  const s = step(5)
  assert.ok(s.includes('Mock data for <KEY>'))
  assert.match(s, /Target {9}<the target: line/)
  assert.match(s, /Empties {8}<table>/)
  assert.match(s, /\(only <column> = <id>\)/)
  assert.ok(s.includes('1. Load it\n   2. Stop'))
  assert.ok(doc.indexOf('1. Load it') < doc.indexOf(`${SEED} load`))
})
test('step 7: the loader, a refusal stops, a stale dataset can be written again', () => {
  const s = step(7)
  assert.ok(s.includes(`${SEED} load <dataset path>`))
  assert.match(s, /never by changing the config/)
  assert.ok(s.includes('The saved dataset no longer fits the database.\n     1. Write the dataset again from the schema\n     2. Stop'))
})
test('setting it up: target, apply with {file}, tenant; never in CI', () => {
  const s = doc.slice(doc.indexOf('## Setting it up'))
  assert.match(s, /"apply": ".*\{file\}"/)
  assert.match(s, /Only `localhost`, `127\.x\.x\.x`, `::1` or a container name/)
  assert.match(s, /It never runs in CI/)
})
test('examples use neutral keys; no project values', () => {
  assert.doesNotMatch(doc, /AGT|FIC|Giacenza|Magazzino/)
  assert.doesNotMatch(doc, /warehouse|teamsystem/i)
})

test('the guide: realistic but fictional rows, the ticket\'s case findable, the cause seeded', () => {
  assert.match(guide, /\*\*About 25 rows per main table:\*\*/)
  assert.match(guide, /Never `Item 1` to `Item 25`/)
  assert.match(guide, /\*\*Fictional, not real:\*\*/)
  assert.match(guide, /\*\*The ticket's case\*\* uses the ticket's values exactly, on a row with a code or name QA can find/)
  assert.match(guide, /Seed the cause too/)
})
test('the guide: shapes from the schema, one transaction, reset child-first and kept to the tenant', () => {
  assert.match(guide, /\*\*Names as the database has them,\*\*/)
  assert.match(guide, /are not database defaults: give `id`, `created_at` and `updated_at`/)
  assert.match(guide, /One transaction, in this order:/)
  assert.match(guide, /child\n {3}tables first/)
  assert.match(guide, /every `DELETE` and `UPDATE` ends with `WHERE <column> = '<id>'`/)
  assert.match(guide, /`DROP`, `TRUNCATE` or `ALTER`/)
})
test('the guide carries no project values', () => {
  assert.doesNotMatch(guide, /AGT|FIC|Giacenza|Magazzino/)
  assert.doesNotMatch(guide, /warehouse|teamsystem/i)
})
