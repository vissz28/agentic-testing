// The seed command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/seed.md', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../guides/seed-data.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? doc.indexOf('\n## Examples') : doc.indexOf(`\n${n + 1}. **`))
const RUN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run'

test('frontmatter has a description and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: <KEY> \[--path <spec>\]\n(?:[a-z-]+: .+\n)*---/)
})
test('steps come in order: check, ticket, dataset, source, plan, write, output', () => {
  const at = ['\n1. **Check.**', '\n2. **Ticket.**', '\n3. **Dataset.**', '\n4. **Source.**', '\n5. **Plan.**', '\n6. **Write.**', '\n7. **Output.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('the rules: data only, never invent, never a database, never application code, no tokens', () => {
  assert.match(doc, /\*\*Data only\.\*\* No `it`, `test`, `describe` or `expect`, no pipeline run, no score/)
  assert.match(doc, /\*\*Never invent\.\*\*/)
  assert.match(doc, /\*\*Never write to a database\.\*\*/)
  assert.match(doc, /least of all a developer's own/)
  assert.match(doc, /\*\*Never edit application code\.\*\*/)
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
  assert.doesNotMatch(doc, /bin\/pipeline\.mjs/)
})
test('step 1: config check, the seed block per adapter, --path must be an existing spec, connectors with Jira', () => {
  const s = step(1)
  assert.ok(s.includes('ticket.mjs" config check'))
  for (const f of ['`seed.builders`', '`seed.stubsFrom`', '`seed.dataset`']) assert.ok(s.includes(f), f)
  assert.match(s, /`vitest` seeds with builder calls, `playwright` with route stubs/)
  assert.ok(s.includes('`.spec.` or `.test.`'))
  assert.ok(s.includes('<path> is not a spec file. Give a spec, or leave out --path to print the block.'))
  assert.ok(s.includes('<path> does not exist, so the block will be printed instead.'))
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/guides/connectors.md'))
  assert.match(s, /Jira is required/)
})
test('step 2: ticket-eval steps 1–3 by reference, no score, and why there is no gate', () => {
  const s = step(2)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md'))
  assert.match(s, /steps 1–3/)
  assert.match(s, /read, save and sanitize/)
  assert.match(s, /Skip step 5, the score: there is no gate here/)
  assert.match(s, /Nothing is asserted, nothing is graded, and no database is touched/)
  assert.match(s, /PROJECT_MISMATCH:/)
  assert.ok(s.includes('<ticketsDir>/<KEY>/ticket.json'))
  assert.match(s, /\*\*data facts\*\*/)
  assert.match(s, /gap/)
  assert.doesNotMatch(s, /steps 1–5/)
})
test('step 3: the dataset document is preferred and never changed', () => {
  const s = step(3)
  assert.ok(s.includes('`seed.dataset`'))
  assert.match(s, /use that row's id and values instead of a new row/)
  assert.match(s, /Never change the dataset file/)
})
test('step 4 vitest: only exported builders; the numbered card when none is configured; never write a builder', () => {
  const s = step(4)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/guides/seed-data.md'))
  assert.match(s, /Use only those/)
  assert.ok(s.includes('Which file holds the seed builders?\n     1. <path>\n     2. <path>\n     3. Another file\n     4. Stop'))
  assert.match(s, /One candidate still gets the card/)
  assert.match(s, /Never write a builder yourself/)
  assert.match(s, /foreign-key order/)
  assert.ok(s.includes('The builder file <path> does not exist. Fix seed.builders in the config.'))
})
test('step 4 playwright: shapes copied from an existing stub, never guessed; stop when there is none', () => {
  const s = step(4)
  assert.ok(s.includes('No route stubs found in <folder>. Write one stub by hand first; I copy response shapes, I never guess them.'))
  assert.ok(s.includes('No existing stub for <endpoint>. Write one stub by hand first; I copy response shapes, I never guess them.'))
  assert.match(s, /copy its response shape/)
  assert.match(s, /already stubs are not stubbed again/)
})
test('step 5: the plan card names the gaps and the source', () => {
  const s = step(5)
  assert.ok(s.includes('Data for <KEY>'))
  assert.ok(s.includes('Not in the ticket: <gap>, <gap>'))
  assert.ok(s.includes('From: <builder file, or the spec the shapes come from>'))
  assert.ok(s.includes('1. Write the data\n   2. Stop'))
})
test('step 6: FK order for builders, broad routes before specific ones for stubs', () => {
  const s = step(6)
  assert.match(s, /foreign-key order, parents first, one call per row/)
  assert.match(s, /broad routes first and specific ones after/)
  assert.ok(s.includes('route.fulfill({ json: … })'))
})
test('step 7: print by default; --path inserts into the setup only, inside a run marker', () => {
  const s = step(7)
  assert.match(s, /Write no file/)
  assert.ok(s.includes(`${RUN} start --key <KEY>`))
  assert.ok(s.includes(`${RUN} stop`))
  assert.ok(s.indexOf('run start') < s.indexOf('insert the block'))
  assert.ok(s.includes('1. Stop the other run and start this one\n     2. Print the block instead'))
  assert.match(s, /touch nothing else: no test, no `expect` and no other line changes/)
  assert.match(s, /`beforeEach`/)
  assert.ok(s.includes('Added to <path>: <n> rows.'))
})
test('run stop on every exit path, and it is safe twice', () => {
  assert.match(doc, /every way out of this command runs `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/checks\.mjs" run stop` first/)
  assert.match(doc, /safe to run twice/)
})
test('examples use neutral keys; no project values', () => {
  assert.doesNotMatch(doc, /AGT|FIC|Giacenza|Magazzino/)
  assert.doesNotMatch(doc, /warehouse|teamsystem/i)
})

test('the guide: one row per fact, every named field, exact values, seed the cause', () => {
  assert.match(guide, /\*\*One row per named fact\.\*\*/)
  assert.match(guide, /\*\*Every field the ticket names\*\*/)
  assert.match(guide, /\*\*Exact values from the ticket\*\*/)
  assert.match(guide, /\*\*Seed the cause, not only the result\.\*\*/)
})
test('the guide: decimals as the API returns them, placeholders for tenant ids, no production data', () => {
  assert.match(guide, /\*\*Decimals\*\* exactly as the API returns them/)
  assert.match(guide, /\*\*Tenant, workspace or account ids are placeholders\*\*/)
  assert.match(guide, /\*\*No production ids, no customer data\.\*\*/)
  assert.match(guide, /\*\*Never write to a developer's own database\.\*\*/)
})
test('the guide: FK order, idempotency, the known dataset, last-registered route wins', () => {
  assert.match(guide, /\*\*Foreign-key order:\*\* parents before children/)
  assert.match(guide, /\*\*Idempotent:\*\*/)
  assert.match(guide, /\*\*Prefer the known dataset\.\*\*/)
  assert.match(guide, /registered \*\*last\*\*/)
  assert.match(guide, /\*\*Shape copied, never guessed\.\*\*/)
  assert.match(guide, /\*\*Shared endpoints are already stubbed\.\*\*/)
})
test('the guide carries no project values', () => {
  assert.doesNotMatch(guide, /AGT|FIC|Giacenza|Magazzino/)
  assert.doesNotMatch(guide, /warehouse|teamsystem/i)
})

test('fullstack: the ticket side picks builders, stubs or both', () => {
  assert.match(step(1), /`fullstack` with either or both, by the ticket's side/)
  assert.match(step(4), /On a `fullstack` project, first find the ticket's side as ticket-eval's step 4b does/)
  assert.match(step(4), /`backend` takes the `vitest` parts below, `frontend` the `playwright` parts, `fullstack` both, builders first/)
})

test('step 4 reads seed.guide on top of the plugin guide', () => {
  assert.match(step(4), /then `seed\.guide` when it is set: the team's own seeding rules, on top of it \(they win where they differ\)/)
})
