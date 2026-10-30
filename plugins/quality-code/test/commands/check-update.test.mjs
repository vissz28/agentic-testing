// The check-update command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/check-update.md', import.meta.url), 'utf8')

test('frontmatter: the only tool is its own script, on Haiku', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: .+\nallowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/check-update\.mjs":\*\), Bash\(claude plugin update quality-code@teamsystem\)\nmodel: haiku\neffort: low\n---/)
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
test('a menu follows the card, and it fits the case: update offers the update, the rest only check or stop', () => {
  assert.match(doc, /End your turn after every card/)
  assert.match(doc, /`update` \(a new version is out\):[\s\S]*1\. Update to the latest version\n\s*2\. Check the version again\n\s*3\. Stop/)
  assert.match(doc, /`reload`, `current` or `ahead`:[\s\S]*1\. Check the version again\n\s*2\. Stop/)
})
test('the update runs the one pre-approved command, exactly as written, only after option 1', () => {
  assert.ok(doc.includes('Run `claude plugin update quality-code@teamsystem`, exactly as written'))
  assert.match(doc, /after the user picks it/)
  assert.match(doc, /Not exit 0: show its last lines as they are/)
  assert.match(doc, /\/reload-plugins` is the user's/)
  assert.match(doc, /never try to run it/)
})
test('the model never compares or invents a version, and never edits the plugin folder', () => {
  assert.match(doc, /Never compare, guess or invent a version or a change yourself/)
  assert.match(doc, /never edit the plugin's folder or its cache/)
})
