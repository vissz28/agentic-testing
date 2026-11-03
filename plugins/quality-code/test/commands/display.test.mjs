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
  assert.match(guide, /every time it is read the reader sees it, right then, as a completed step: the `Read from Central Context` item/)
  assert.match(guide, /Without the checklist, the line `rules\.mjs` prints, on its own, as printed\. Never skip it or fold it into another step, and never list the rules/)
  assert.match(read('commands/spec.md'), /Every read from Central Context, by `rules\.mjs` or by the connector, is shown to the person as a completed step/)
})

test('a card is never a code block, and a card with options is the picker, not a printed list', () => {
  assert.match(guide, /In the chat a card is never in a code block/)
  assert.match(guide, /Calling the tool is how the card is shown: never print its numbered options as well/)
  assert.match(guide, /Wherever a command says "show this card and end the turn", call the picker instead/)
})

test('progress is a live checklist, Central Context one of its steps, and no narration', () => {
  assert.match(guide, /shows its progress as a live checklist, with the to-do list tool \(`TodoWrite`, or `TaskCreate` and `TaskUpdate`/)
  assert.match(guide, /`Readiness gate`, `Search Central Context`, `Read from Central Context`, `Find the code to test`/)
  assert.match(guide, /\*\*No narration\.\*\* Never write a sentence that says what you are about to do or what just worked/)
  assert.match(guide, /Where a command says to "say" such a line, update the checklist instead/)
  assert.match(guide, /or `update_plan` in the desktop app\), not with sentences\. Its items are the steps named below, never your own/)
})

test('the report output style: keeps the coding instructions, is never forced, and shows a finished run', () => {
  const style = read('output-styles/report.md')
  const front = style.split('---')[1]
  assert.match(front, /^name: report$/m)
  assert.match(front, /^keep-coding-instructions: true$/m)
  assert.doesNotMatch(front, /force-for-plugin/)
  assert.match(style, /It never changes the content: every score, verdict, count, rule, path, test name and option is exactly what the scripts and the commands give you/)
  assert.match(style, /## A finished run, as it should look/)
  assert.match(style, /A choice is the question picker \(`AskUserQuestion`\), never a numbered list in the text/)
})

test('clear words, nothing obvious, files behind HERE links, and a wrap-up of at most 400 words', () => {
  assert.match(guide, /\*\*Never state the obvious\.\*\* No line for what the command always does or never does/)
  assert.match(guide, /\*\*Files are links\.\*\* A file is never shown as its path: name it in plain words and link the word `HERE` to it/)
  assert.match(guide, /\*\*at most 400 words\*\*, the card above it not counted/)
  assert.match(guide, /Never cut a step from \*\*Needs you\*\*, a ❌ or a 🔴 line/)
  const example = guide.split('## The wrap-up')[1].split('\n---\n')[1]
  assert.ok(example.replace(/\([^)]*\)/g, '').split(/\s+/).filter(Boolean).length <= 400)
  assert.doesNotMatch(example, /^### \p{Extended_Pictographic}/mu, 'no emoji in the wrap-up headings')
  assert.doesNotMatch(example, /`[^`]*\/[^`]*\.\w+`/, 'no file path in code in the example')
  assert.match(read('output-styles/report.md'), /link the word `HERE` to its full path/)
})

test('a long step is its to-do item, never an italic line, and spec ends with the wrap-up', () => {
  const style = read('output-styles/report.md')
  assert.match(style, /A step that takes long is its to-do item in progress, never a line of its own, not even in italics/)
  assert.doesNotMatch(style, /^\*[^*\n]+…\*$/m)
  assert.match(read('commands/spec.md'), /Then the wrap-up, as the display guide lays it out:[^\n]*whatever this run changed on the way \(a rewrite of the tests, a re-run, and why\) goes in its `Notes`/)
})

test('a "user has not heard from you" reminder is answered with the checklist, not a sentence', () => {
  assert.match(guide, /When Claude Code reminds you that the user has not heard from you in a while, the checklist is the update/)
  assert.match(read('output-styles/report.md'), /When Claude Code reminds you that the user has not heard from you in a while, update the to-do list instead/)
})

test('the central-context connector: one search on the ticket\'s topic every run, dropped when nothing fits, shown, checked with the connectors', () => {
  const spec = read('commands/spec.md')
  assert.match(spec, /Step 4 always starts with that search: `search_knowledge` with what the code under test does in a few English words[^\n]*no `domain`, `max_results` 5, and `client_context` the project folder's name and the key/)
  assert.match(spec, /A second search only for a topic the ticket touches that the first missed[^\n]*never more\./)
  assert.match(spec, /a hit that does not, or no hit at all, is dropped, and the run goes on with the rules `rules\.mjs` reads/)
  assert.match(spec, /Those rules are candidates the same way, and the team's own rules still win\. Without the connector, the search is skipped and said so\./)
  assert.match(spec, /4\. \*\*Plan\.\*\* First search Central Context with the connector, as the Rules section says, and show it as a completed step/)
  assert.match(guide, /Each search with the `central-context` connector is its own item too, with what was searched: `Searched Central Context · "access token check" · 3 rules, 1 applies ✅`/)
  const c = read('guides/connectors.md')
  assert.match(c, /\| Central Context \| find the tools of the `central-context` connector; call `search_knowledge` with the query `test` and `max_results` 1 \|/)
  assert.match(c, /It is optional, like GitHub: not ✅ is `⚠️ Central Context not connected` in the line, never a card, and the run goes on/)
})
