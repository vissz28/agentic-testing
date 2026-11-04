import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('guides/language.md states the rule, the read and the save', () => {
  const g = read('guides/language.md')
  assert.match(g, /Talk in the language of the person's last sentence/)
  assert.match(g, /a pick, a number, a click on an option, a slash command with no words, a script's output, a card/)
  assert.match(g, /Script lines and cards keep their fixed words/)
  assert.match(g, /the Done text/)
  assert.ok(g.includes('progress.mjs" get session'))
  assert.ok(g.includes(`progress.mjs" set session --step 0 --label language --data '{"language":"<code>"}'`))
  assert.match(g, /ISO 639-1/)
  assert.match(g, /ticket's language, else English/)
})
test('display.md ends with the Language section pointing to the guide', () => {
  const d = read('guides/display.md').trimEnd()
  const at = d.lastIndexOf('\n## Language\n')
  assert.ok(at > 0)
  assert.ok(!d.slice(at + 1).includes('\n## '), 'Language is the last section')
  assert.ok(d.endsWith('guides/language.md`.'))
})
test('every command with a Language rule points to the guide', () => {
  let n = 0
  for (const f of readdirSync(new URL('../../commands/', import.meta.url)).filter(x => x.endsWith('.md'))) {
    const rule = read(`commands/${f}`).split('\n').find(l => l.startsWith('- **Language.**'))
    if (!rule) continue
    n++
    assert.ok(rule.includes('${CLAUDE_PLUGIN_ROOT}/guides/language.md'), f)
    assert.doesNotMatch(rule, /English by default/i, f)
  }
  assert.ok(n >= 10, `found ${n} Language rules`)
})
