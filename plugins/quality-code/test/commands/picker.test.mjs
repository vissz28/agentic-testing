// The picker rule: every question is asked with AskUserQuestion; the numbered text card is only the fallback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const guide = read('guides/display.md')

test('the picker is THE rule: paging, multiSelect, Other, and the text card only without the tool', () => {
  assert.match(guide, /Calling the picker \(the `AskUserQuestion` tool\) is THE rule for every card with options/)
  assert.match(guide, /A numbered text card is only the fallback, for a client where the tool is not available/)
  assert.match(guide, /More than four options: page them, never print text/)
  assert.match(guide, /3 options and a fourth option `More…`/)
  assert.match(guide, /stays reachable by typing `stop` or `cancel` in `Other`/)
  assert.match(guide, /set `multiSelect` to true/)
  assert.match(guide, /two or more numbers \(for example `1,3`\)/)
  assert.match(guide, /Only without the tool, show the numbered card as written/)
  assert.doesNotMatch(guide, /Still more than four: show the numbered card as written/)
})

test('every file that shows a numbered card references display.md and has the picker sentence', () => {
  const sentence = /Every question is asked with the AskUserQuestion picker as (`\$\{CLAUDE_PLUGIN_ROOT\}\/guides\/)?display\.md`? says, never as a numbered text card; the text card is only for a client without the tool\./
  const hasCard = s => {
    let fence = false
    for (const l of s.split('\n')) {
      if (/^\s*```/.test(l)) fence = !fence
      else if (fence && /^\s*\d\. /.test(l)) return true
    }
    return false
  }
  const commands = readdirSync(new URL('../../commands/', import.meta.url)).map(f => `commands/${f}`)
  const files = [...commands, 'guides/connectors.md', 'guides/save-place.md', 'guides/run.md']
  let found = 0
  for (const f of files) {
    const s = read(f)
    if (!hasCard(s)) continue
    found++
    assert.ok(s.includes('guides/display.md'), `${f} references display.md`)
    assert.match(s, sentence, `${f} has the picker sentence`)
  }
  assert.ok(found >= 10)
  for (const f of commands) {
    const s = read(f)
    if (s.includes('guides/run.md')) continue
    assert.match(s, sentence, `${f} has the picker sentence`)
  }
})
