// The display guide: how every command lays out its cards. It changes the look, never the content.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const guide = read('guides/display.md')

test('every command follows the display guide, directly or through guides/run.md', () => {
  for (const f of readdirSync(new URL('../../commands/', import.meta.url))) {
    const s = read(`commands/${f}`)
    const via = s.includes('guides/run.md') ? read('guides/run.md') : s
    assert.ok(via.includes('`${CLAUDE_PLUGIN_ROOT}/guides/display.md`'), f)
  }
})

test('the guide keeps every word, number and verdict; questions use the picker with a numbered fallback', () => {
  assert.match(guide, /never the content: every number, score, verdict, rule id, path, test name and option stays exactly as/)
  assert.match(guide, /that holds for its words, numbers and order; how it is laid out is this guide's/)
  assert.match(guide, /A `🔴 \[RISK \/ NOT RECOMMENDED\]` line stays as it is, on its own line, never softened/)
  assert.match(guide, /the picker \(the `AskUserQuestion` tool\) when that tool is available/)
  assert.match(guide, /`--ci`, `--yes` and every rule that says not to ask stay as they are: no picker either\. Without the tool, show the numbered card as written and end the turn\./)
})

test('every read of Central Context is shown as a completed step, and rules.mjs is the only way spec reads it', () => {
  assert.match(guide, /every time it is read the reader sees it, right then, as a completed step: the line `rules\.mjs` prints/)
  assert.match(guide, /Never skip it or fold it into another section, and never list the rules under it/)
  assert.match(read('commands/spec.md'), /`rules\.mjs` is the only way this command reads Central Context, and every time it runs its line is shown to the person as a completed step/)
})
