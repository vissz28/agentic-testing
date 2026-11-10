// The newer commands follow guides/display.md: no code-block card, a Next line, and their own safety rules kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const names = ['transcript-goal', 'clean', 'clean-cache', 'config', 'check']
const file = n => (n === 'clean-cache' ? `guides/${n}.md` : `commands/${n}.md`)
const body = n => read(file(n)).replace(/^---\n[\s\S]*?\n---\n/, '')
const step5c = () => read('guides/ticket-eval.md').split('\n').filter(l => l.startsWith('5c. ')).join('\n')

test('each command references the display guide and the Next line', () => {
  for (const n of names) {
    const s = read(file(n))
    assert.ok(s.includes('guides/display.md'), n)
    assert.match(s, /Next line/, n)
  }
  assert.match(step5c(), /Next line/)
  assert.match(step5c(), /display\.md/)
})

test('transcript-goal, clean, clean-cache and check have no code block at all', () => {
  for (const n of ['transcript-goal', 'clean', 'clean-cache', 'check']) assert.ok(!body(n).includes('```'), n)
})

test('config set/get shows a headline and an old -> new table', () => {
  const s = read('commands/config.md')
  assert.match(s, /\| Setting \| Old \| New \|/)
  assert.match(s, /`\*\*<key>: <value>\*\*`/)
  assert.match(s, /without `--yes`/)
})

test('transcript-goal: sections, tables, wrap-up, Jira only after preview and yes, transcript never sent', () => {
  const s = body('transcript-goal')
  for (const h of ['### 🎯 Summary', '### 📋 Tasks', '### ❓ Open questions', '### 📝 Jira preview']) assert.ok(s.includes(h), h)
  assert.match(s, /`### What we made`/)
  assert.match(s, /Jira is written to only in step 8, after the preview and an explicit yes/)
  assert.match(s, /Never with `--ci` or `--yes`/)
  assert.match(s, /It never goes anywhere except the one Jira write the person confirms in step 8/)
})

test('clean keeps one explicit yes, never skipped; clean-cache keeps --yes and local-only; config never shows a token', () => {
  const c = body('clean')
  assert.match(c, /One explicit yes, never skipped\.\*\* `--yes`, `--ci`/)
  assert.match(c, /Only a `Yes, delete` from the person in this turn counts/)
  assert.match(c, /Tracked by git/)
  assert.match(c, /\| Group \| Items \| Files \| What \|/)
  const k = body('clean-cache')
  assert.match(k, /With `--yes` in `\$ARGUMENTS`, skip to step 3/)
  assert.match(k, /Nothing is sent anywhere/)
  assert.match(body('config'), /never show one/)
})

test('ticket-eval 5c stays inside its step and keeps the Jira preview-and-yes rule', () => {
  const s = step5c()
  assert.match(s, /Jira is written only after the preview and an explicit yes/)
  assert.match(s, /never a code-block card/)
})
