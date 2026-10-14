// The start command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/start.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? undefined : doc.indexOf(`\n${n + 1}. **`))

test('steps come in order: config, connectors, repo, ticket, action', () => {
  const at = ['\n0. **Config.**', '\n1. **Connectors.**', '\n2. **Repo.**', '\n3. **Ticket.**', '\n4. **Action.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('step 0: no config offers setup, then continues at the repo card', () => {
  const s = step(0)
  assert.ok(s.includes('cli.mjs" config check'))
  assert.ok(s.includes('This repo is not set up yet.'))
  assert.ok(s.includes('1. Run setup now'))
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/setup.md'))
  assert.match(s, /continue at step 2/)
})
test('step 1 reads the shared connectors check', () => {
  assert.ok(step(1).includes('${CLAUDE_PLUGIN_ROOT}/core/connectors.md'))
})
test('step 2: branch script, merge-request base, and every git situation has its card', () => {
  const s = step(2)
  assert.ok(s.includes('core/branch.mjs" --detect'))
  assert.match(s, /target branch/)
  assert.match(s, /`--base` in `\$ARGUMENTS` wins/)
  for (const t of [
    'This folder is not a git repo.',
    'No branch is checked out',
    'No base branch found.',
    '`History is too short to compare. Run git fetch --unshallow, then start again.`',
    'Do not run it yourself.',
    'shares no history with',
    'No feature-branch changes against',
    'Work on this repo?',
    '1. Yes, use this',
    '2. Use a different base branch',
    '1. Evaluate a ticket by key',
  ]) assert.ok(s.includes(t), t)
})
test('step 3: key from the branch first, then the merge-request title, then commits; always confirmed', () => {
  const s = step(3)
  assert.match(s, /appears in the branch name/)
  assert.match(s, /merge request title/)
  assert.ok(s.includes('1. Use <KEY>'))
  assert.ok(s.includes('2. A different ticket'))
})
test('step 4: evaluate runs ticket-eval unchanged; the pipeline waits for part 4', () => {
  const s = step(4)
  assert.ok(s.includes('1. Evaluate the ticket'))
  assert.ok(s.includes('2. Run the full pipeline (available with part 4)'))
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md'))
  assert.match(s, /Writing and grading tests for any project comes with part 4/)
})
test('the change never feeds the score, and no diff content is shown', () => {
  assert.match(doc, /never changes the score/)
  assert.match(doc, /Never read or show diff contents/)
})
test('no token in the chat; tools by operation name', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
})
test('examples use neutral keys', () => {
  assert.doesNotMatch(doc, /FIC|warehouse/i)
})
