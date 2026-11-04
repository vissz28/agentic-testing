// The clean-cache command is a prompt, not code: these pin its flow, its safety rules and its wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const doc = read('commands/clean-cache.md')
const RUN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/clean-cache.mjs"'

test('frontmatter: argument hint and haiku', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: \[--all\] \[--yes\]\n/)
  assert.match(doc, /\nmodel: haiku\neffort: low\n---/)
})
test('flow: list, ask with the picker, delete; --yes skips the question', () => {
  const at = ['\n1. **List.**', '\n2. **Ask.**', '\n3. **Delete.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0) && at[0] < at[1] && at[1] < at[2], JSON.stringify(at))
  assert.ok(doc.includes(`${RUN} list`) && doc.includes(`${RUN} delete`))
  assert.match(doc, /AskUserQuestion/)
  assert.ok(doc.includes('`Delete` / `Cancel`'))
  assert.match(doc, /With `--yes` in `\$ARGUMENTS`, skip/)
  assert.match(doc, /--all/)
})
test('safety: only the cache, no rm, config and specs untouched, language kept', () => {
  assert.match(doc, /never use `rm`/)
  assert.match(doc, /Only the cache/)
  assert.match(doc, /config.+tickets.+specs/s)
  assert.ok(doc.includes('guides/language.md') && doc.includes('guides/display.md'))
  assert.match(doc, /Run each plugin script exactly as written/)
})
test('wiring: README, MCP README, progress guide', () => {
  assert.ok(read('README.md').includes('/quality-code:clean-cache'))
  assert.ok(read('mcp-server/README.md').includes('quality_code_clean_cache'))
  assert.ok(read('guides/progress.md').includes('/quality-code:clean-cache'))
})
