import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('guides/language.md states the rule, the read and the save', () => {
  const g = read('guides/language.md')
  assert.match(g, /Talk in the language of the person's last sentence/)
  assert.match(g, /a pick, a number, a click on an option, a slash command with no words, a script's output, a card/)
  assert.match(g, /the words of cards and script lines too, translated as you show them/)
  assert.match(g, /every text that goes to Jira or into a file/)
  assert.match(g, /the first of `languages` in the config/)
  assert.match(g, /the Done text/)
  assert.ok(g.includes('progress.mjs" get session'))
  assert.ok(g.includes(`progress.mjs" set session --step 0 --label language --data '{"language":"<code>"}'`))
  assert.match(g, /ISO 639-1/)
  assert.match(g, /ticket's language, else the first of `languages` in the config, else English/)
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
test('every command reaches the language guide, and nothing pins its words to English', () => {
  // check and report hand off to these guides, so the rule lives there.
  const guides = ['run', 'report-kpi', 'report-cost', 'ticket-eval', 'tickets-eval', 'clean-cache'].map(g => `guides/${g}.md`)
  const commands = readdirSync(new URL('../../commands/', import.meta.url)).filter(f => f.endsWith('.md') && !['check.md', 'report.md'].includes(f)).map(f => `commands/${f}`)
  for (const f of [...commands, ...guides]) {
    const doc = read(f)
    assert.ok(doc.includes('guides/language.md'), `${f} does not point to the language guide`)
    assert.doesNotMatch(doc, /Plain English|stay as printed|keep their fixed words/, f)
  }
  for (const [cmd, guide] of [['check', 'run'], ['report', 'report-kpi'], ['report', 'report-cost']]) assert.ok(read(`commands/${cmd}.md`).includes(`guides/${guide}.md`), `${cmd} hands off to ${guide}`)
})
