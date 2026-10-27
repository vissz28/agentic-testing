import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const guide = read('guides/save-place.md')

test('every command that saves files asks once where they go, through the shared guide', () => {
  for (const p of ['commands/spec.md', 'commands/ticket-eval.md', 'commands/tickets-eval.md', 'commands/xray.md', 'commands/seed.md', 'commands/qa.md', 'guides/run.md']) {
    assert.ok(read(p).includes('follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`'), p)
  }
})

test('the commands take the tickets folder from config check, never a default of their own', () => {
  for (const p of ['commands/spec.md', 'commands/ticket-eval.md', 'commands/tickets-eval.md', 'commands/xray.md', 'commands/seed.md', 'guides/run.md']) {
    const s = read(p)
    assert.ok(s.includes('`tickets folder:` line'), p)
    assert.doesNotMatch(s, /`ticketsDir` \(default/, p)
  }
})

test('the card: asked once, the three places, chosen and moved by the script', () => {
  assert.ok(guide.includes('bin/ticket.mjs" save get`'))
  assert.match(guide, /When `asked` is `true`, say nothing and stop/)
  for (const l of ['1. In the project repo: <ticketsDir>/ (git-ignored)', '2. On this machine, outside the repo: <ticketsDir>/', '3. Only in this chat: nothing is kept']) assert.ok(guide.includes(l), l)
  assert.ok(guide.includes('bin/ticket.mjs" save set <repo|local|chat>`'))
  assert.match(guide, /A setup with no repo has only `local` and `chat`/)
  assert.match(guide, /With `--ci` or `--json`, never show the card/)
  assert.match(guide, /`\/quality-code:config`, item 7/)
})
