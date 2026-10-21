// start is an alias of spec with no key: the branch flow it used to hold is tested in spec.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/start.md', import.meta.url), 'utf8')

test('start runs spec with no key, passing only --base', () => {
  assert.match(doc, /^---\ndescription: Start from your feature branch\. The same as \/quality-code:spec with no key, kept so the old name works\.\nargument-hint: \[--base <branch>\]\n/)
  assert.ok(doc.includes('Read `${CLAUDE_PLUGIN_ROOT}/commands/spec.md` and follow it with `$ARGUMENTS` (only `--base <branch>`; never a key)'))
})
