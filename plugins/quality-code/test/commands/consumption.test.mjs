// The consumption command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/consumption.md', import.meta.url), 'utf8')
const RUN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs"'

test('frontmatter: description, argument hint, and the only tool is the script', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: \[--since 7d\|30d\|YYYY-MM-DD\] \[--until YYYY-MM-DD\] \[--by command\|ticket\|day\|model\] \[--prices file\.json\]\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/consumption\.mjs":\*\)\n(?:[a-z-]+: .+\n)*---/)
})
test('steps come in order: run, card', () => {
  const at = ['\n1. **Run.**', '\n2. **Card.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.ok(at[0] < at[1])
})
test('runs the script with the user arguments, never --json', () => {
  assert.ok(doc.includes(`${RUN} $ARGUMENTS`))
  assert.match(doc, /Do not pass `--json`/)
  assert.match(doc, /last 30 days by command/)
})
test('exit 3 and exit 2 are shown as they are, then stop', () => {
  assert.match(doc, /Exit 3: no transcripts were found\. Show its lines as they are/)
  assert.match(doc, /Exit 2: show its lines as they are and stop/)
})
test('the card is relayed verbatim without the machine line', () => {
  assert.ok(doc.includes('Show the card exactly as printed'))
  assert.match(doc, /Drop the `CONSUMPTION_JSON:` line/)
})
test('numbered options after each card, and the turn ends', () => {
  for (const t of ['1. By ticket', '2. By day', '3. By model', '4. Stop']) assert.ok(doc.includes(t), t)
  assert.match(doc, /End your turn after every card/)
  assert.ok(doc.includes('--by ticket') && doc.includes('--by day') && doc.includes('--by model'))
  assert.match(doc, /same `--since`, `--until` and `--prices`/)
})
test('read-only and local; no transcript text; the script does the sums', () => {
  assert.match(doc, /Never read the transcripts yourself/)
  assert.match(doc, /never show prompt or answer text/)
  assert.match(doc, /Nothing is sent anywhere/)
  assert.match(doc, /Never compute, round, change or add up a count or a cost yourself/)
})
test('the cost is an estimate, not a bill', () => {
  assert.match(doc, /estimate\*\* at API list prices/)
  assert.match(doc, /Subscription plans are not billed this way/)
})
test('no token in the chat; no mcp tools; neutral keys', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
  assert.doesNotMatch(doc, /AGT|FIC|warehouse/i)
})
