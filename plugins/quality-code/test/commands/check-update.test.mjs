// The check-update command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/check-update.md', import.meta.url), 'utf8')

test('frontmatter: the only tool is its own script, on Haiku', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: .+\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/check-update\.mjs":\*\)\nmodel: haiku\neffort: low\n---/)
})
test('runs the script with no arguments and never --json', () => {
  assert.ok(doc.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/check-update.mjs"`'))
  assert.match(doc, /do not pass `--json`/)
})
test('exit 3 and exit 2 are shown as they are, then stop', () => {
  assert.match(doc, /Exit 3: the latest version could not be read\. Show its lines as they are and stop/)
  assert.match(doc, /Exit 2: show its lines as they are and stop/)
})
test('the card is relayed verbatim without the machine line', () => {
  assert.ok(doc.includes('Show the card exactly as printed'))
  assert.match(doc, /Drop the `CHECK_UPDATE_JSON:` line/)
})
test('the model never installs, compares or invents', () => {
  assert.match(doc, /Never compare, guess or invent a version or a change yourself/)
  assert.match(doc, /You cannot install the update/)
  assert.match(doc, /never try to run them/)
  assert.match(doc, /Read-only/)
})
