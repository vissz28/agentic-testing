// The xray command is a prompt, not code: these pin its flow and its rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/xray.md', import.meta.url), 'utf8')
const write = readFileSync(new URL('../commands/write.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? doc.indexOf('\n## Examples') : doc.indexOf(`\n${n + 1}. **`))
const XRAY = 'node "${CLAUDE_PLUGIN_ROOT}/core/xray.mjs"'

test('frontmatter has a description and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: <KEY> \[--route PATH\] \[--no-extras\] \[--dry-run\] \[--ci\] \| --sync \[KEY\]\n---/)
})
test('steps come in order: check, ticket and gate, screen, plan, write, report', () => {
  const at = ['\n1. **Check.**', '\n2. **Ticket and gate.**', '\n3. **Screen.**', '\n4. **Plan.**', '\n5. **Write.**', '\n6. **Report.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('the rules: the script writes the files, never invent, no tokens, no spec and no checks', () => {
  assert.match(doc, /\*\*The script writes\.\*\*/)
  assert.match(doc, /Never edit those files yourself/)
  assert.match(doc, /\*\*Never invent\.\*\*/)
  assert.match(doc, /Never ask for a token/)
  assert.match(doc, /no spec file, no test run, no check/)
  assert.doesNotMatch(doc, /mcp__/)
  assert.doesNotMatch(doc, /core\/pipeline\/cli\.mjs/)
  assert.doesNotMatch(doc, /run start/)
})
test('step 1: --sync runs only the script; config check; no xray block stops; connectors with Jira', () => {
  const s = step(1)
  assert.ok(s.includes(`${XRAY} sync`))
  assert.ok(s.includes('`XRay test cases are off in this project: add an "xray" block to .claude/quality-code.json (README, "XRay test cases").`'))
  assert.ok(s.includes('config check'))
  assert.ok(s.includes('core/connectors.md'))
  assert.match(s, /Jira is required/)
})
test('step 2: the gate is ticket-eval steps 1-5; option 3 and a backend ticket stop', () => {
  const s = step(2)
  assert.match(s, /commands\/ticket-eval\.md` and follow its steps 1–5/)
  assert.ok(s.includes('`XRay test cases need a ticket that passes the gate.`'))
  assert.match(s, /Option 3/)
  assert.ok(s.includes('`XRay test cases are written for frontend tickets (Playwright tests).`'))
  assert.match(s, /the ticket's wins/)
})
test('step 4: the extras come from the Playwright guide, at most 3, and the card is shown', () => {
  const s = step(4)
  assert.ok(s.includes('core/guides/playwright-writing.md'))
  assert.match(s, /at most 3 extra probes/)
  assert.ok(s.includes('1. Write these test cases'))
  assert.ok(s.includes('ac_present'))
})
test('step 5: one case per test, named as write names the tests, then the script on the saved list', () => {
  const s = step(5)
  assert.ok(s.includes('`<ticketsDir>/<KEY>/xray.json`'))
  assert.ok(s.includes('`Extra: <what it probes>`'))
  assert.ok(s.includes(`${XRAY} add @<ticketsDir>/<KEY>/xray.json`))
  assert.match(s, /Leave out\*\* what you do not know/)
})
test('write adds the cases for the Playwright tests it wrote, by this command\'s step 5, and is never stopped by it', () => {
  assert.match(write, /\*\*XRay test cases\*\* \(Playwright tests, only when the config has an `xray` block\): read `\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/xray\.md` step 5/)
  assert.match(write, /XRay is not a check/)
  assert.match(write, /the lines `xray\.mjs add` printed in step 5/)
  assert.match(write, /Read `playwright\.guide`, `features` and `xray` too/)
})
test('examples use neutral keys', () => {
  const ex = doc.slice(doc.indexOf('## Examples'))
  assert.doesNotMatch(ex, /FIC-|AGT-/)
})
