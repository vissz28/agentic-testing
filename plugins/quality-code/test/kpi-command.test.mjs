// The kpi command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/kpi.md', import.meta.url), 'utf8')
const RUN = 'node "${CLAUDE_PLUGIN_ROOT}/core/kpi.mjs"'

test('frontmatter: description, argument hint, and the only tool is the script', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: \[--since 7d\|30d\|YYYY-MM-DD\] \[--until YYYY-MM-DD\]\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/core\/kpi\.mjs":\*\)\n---/)
})
test('steps come in order: run, card', () => {
  const at = ['\n1. **Run.**', '\n2. **Card.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.ok(at[0] < at[1])
})
test('runs the script with the user arguments, never --json', () => {
  assert.ok(doc.includes(`${RUN} $ARGUMENTS`))
  assert.match(doc, /Do not pass `--json`/)
  assert.match(doc, /the last 30 days/)
})
test('exit 3 and exit 2 are shown as they are, then stop', () => {
  assert.match(doc, /Exit 3: no audit data yet\. Show its lines as they are/)
  assert.match(doc, /Exit 2: show its lines as they are and stop/)
})
test('the card is relayed verbatim without the machine line', () => {
  assert.ok(doc.includes('Show the card exactly as printed'))
  assert.match(doc, /Drop the `KPI_JSON:` line/)
})
test('numbered options after the card point to consumption for cost, and the turn ends', () => {
  for (const t of ['1. The AI cost of the same days', '2. Another period', '3. Stop']) assert.ok(doc.includes(t), t)
  assert.ok(doc.includes('/quality-code:consumption'))
  assert.match(doc, /End your turn after every card/)
})
test('read-only and local; the script does the sums; no grading', () => {
  assert.match(doc, /Never read the log files yourself/)
  assert.match(doc, /Nothing is sent anywhere/)
  assert.match(doc, /git-ignored/)
  assert.match(doc, /Never compute, round, change or add up a count yourself/)
  assert.match(doc, /never grade a team or a ticket/)
})
test('no token in the chat; no mcp tools; neutral keys', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
  assert.doesNotMatch(doc, /AGT|FIC|warehouse/i)
})
