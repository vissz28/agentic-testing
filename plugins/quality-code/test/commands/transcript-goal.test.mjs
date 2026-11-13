// The transcript-goal command is a prompt: these pin the rules that keep it honest, private and gated.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMMANDS, getProgress, setProgress } from '../../lib/state/progress.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const doc = read('commands/transcript-goal.md')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`))

test('the command is wired: file, front matter, progress name, save-place, MCP tool name, README', () => {
  assert.ok(readdirSync(new URL('../../commands/', import.meta.url)).includes('transcript-goal.md'))
  assert.match(doc, /^---\ndescription: .*\nargument-hint: .*--file.*--meeting/)
  assert.ok(COMMANDS.includes('transcript-goal'))
  assert.ok(read('guides/save-place.md').includes('`transcript-goal`'))
  assert.ok(read('mcp-server/README.md').includes('quality_code_transcript_goal'))
  assert.ok(read('../../README.md').includes('/quality-code:transcript-goal'))
  assert.ok(doc.includes('guides/progress.md') && doc.includes('guides/language.md') && doc.includes('guides/display.md'))
})
test('sources: file kinds, paste, Microsoft 365 by operation name, and how to export when there is none', () => {
  assert.match(doc, /`\.vtt`, `\.txt`, `\.md` or `\.docx`/)
  assert.match(doc, /--text/)
  for (const op of ['outlook_calendar_search', 'sharepoint_search', 'teams_list_chats']) assert.ok(doc.includes(`\`${op}\``), op)
  assert.doesNotMatch(doc, /mcp__/)
  assert.match(doc, /Only read operations: never send a message, create an event or write a file there/)
  assert.match(step(2), /To export the transcript from Teams/)
})
test('never invent: what was not said becomes a clarification, asked with the picker', () => {
  assert.match(doc, /\*\*Never invent\.\*\*/)
  assert.match(step(6), /Ask only what is missing, with the AskUserQuestion picker/)
  assert.match(step(6), /never filled with a guess/)
})
test('review cards: summary, tasks, open questions, then the four-way destination picker', () => {
  const s = step(7)
  for (const w of ['### 🎯 Summary', '### 📋 Tasks', '### ❓ Open questions']) assert.ok(s.includes(w), w)
  assert.match(s, /1\. Create in Jira.*2\. Save locally.*3\. Edit more.*4\. Cancel/)
  assert.match(s, /remove a task by its number, add a task/)
})
test('Jira is written only after a preview and an explicit yes; never with --ci or --yes; existing tickets are searched and linked', () => {
  const s = step(8)
  assert.ok(s.indexOf('searchJiraIssuesUsingJql') < s.indexOf('**Preview.**'))
  assert.ok(s.indexOf('**Preview.**') < s.indexOf('createJiraIssue'))
  assert.match(s, /\*\*Nothing is created yet\*\*/)
  assert.match(s, /Only on `1`/)
  assert.match(s, /do not create a second one/)
  assert.match(s, /Link to <KEY>/)
  assert.match(doc, /Never with `--ci` or `--yes`/)
  assert.match(doc, /takes no --ci or --yes/)
})
test('privacy: the transcript goes nowhere but redacted into the chat, the progress cache keeps choices only', () => {
  assert.match(doc, /personal data/)
  assert.match(doc, /never goes anywhere except the one Jira write/)
  assert.match(doc, /not the transcript/)
  assert.match(doc, /\*\*never\*\* transcript text/)
  assert.match(doc, /Never search other chats or e-mails/)
})
test('local save goes through the script, which checks the shape, redacts and writes under sprint/', () => {
  assert.ok(step(9).includes('transcript.mjs" save --in'))
  assert.match(step(9), /<ticketsDir>\/sprint\/<date>-goal\.md/)
  assert.match(step(7), /transcript\.mjs" validate --in/)
  assert.match(step(4), /transcript\.mjs" parse/)
})
test('the progress cache accepts the command without a key and keeps choices', () => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qcp-')) }
  assert.equal(setProgress('/tmp/proj', 'transcript-goal', { step: 3, label: 'tasks', data: { destination: 'local' } }, env).ok, true)
  assert.equal(getProgress('/tmp/proj', 'transcript-goal', null, env).data.destination, 'local')
})
