// The start command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/start.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? undefined : doc.indexOf(`\n${n + 1}. **`))

test('steps come in order: config, connectors, repo, ticket, pipeline', () => {
  const at = ['\n0. **Config.**', '\n1. **Connectors.**', '\n2. **Repo.**', '\n3. **Ticket.**', '\n4. **Pipeline.**'].map(s => doc.indexOf(s))
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
test('step 3: key from the branch first, then the merge-request title, then commits; confirmed only when not in the branch name', () => {
  const s = step(3)
  assert.match(s, /in the branch name, use it without a card/)
  assert.match(s, /appears in the branch name/)
  assert.match(s, /merge request title/)
  assert.ok(s.includes('1. Use <KEY>'))
  assert.ok(s.includes('2. A different ticket'))
})
test('step 4: runs the pipeline with no card: gate, then check the changed tests or write them', () => {
  const s = step(4)
  const run = s.slice(0, s.indexOf('**`--ask` in `$ARGUMENTS`:**'))
  assert.match(run, /with no card: the readiness gate, then the test pipeline/)
  assert.ok(run.includes('Running the pipeline for <KEY>: readiness gate, then tests.'))
  assert.match(run, /`kind` `test` and `status` other than `D`/)
  const changed = run.slice(run.indexOf('**The branch has changed tests:**'), run.indexOf('**No changed tests:**'))
  assert.ok(changed.indexOf('commands/ticket-eval.md') > 0)
  assert.ok(changed.indexOf('commands/check.md') > changed.indexOf('commands/ticket-eval.md'), 'gate before check')
  assert.match(changed, /ends with the ticket passing/)
  assert.match(changed, /`--key <KEY>` with the confirmed key/)
  assert.ok(changed.includes('The tests run once the ticket passes the gate.'))
  const none = run.slice(run.indexOf('**No changed tests:**'))
  assert.ok(none.includes('${CLAUDE_PLUGIN_ROOT}/commands/write.md'))
  assert.match(none, /confirmed key `<KEY>`/)
  assert.match(none, /gates the ticket, writes the tests and checks them/)
  assert.match(run, /do not ask again/)
  assert.match(run, /every adapter, `vitest`, `playwright` and `fullstack`/)
  assert.match(run, /unit tests for Vitest, e2e tests for Playwright, and both for a fullstack ticket/)
  assert.doesNotMatch(run, /End the turn/i)
  assert.doesNotMatch(doc, /not available yet|part 3|part 4b/)
})
test('step 4: --ask brings back the action card', () => {
  const s = step(4)
  const ask = s.slice(s.indexOf('**`--ask` in `$ARGUMENTS`:**'))
  for (const t of ['1. Evaluate the ticket', '2. Check the tests on this branch', '3. Write and check tests\n', '4. Stop', '2. Write and check tests / 3. Stop'])
    assert.ok(ask.includes(t), t)
  assert.match(ask, /number the rest in order/)
  assert.match(ask, /leaving out deleted ones \(status `D`\)/)
  assert.ok(ask.includes('commands/ticket-eval.md') && ask.includes('commands/check.md') && ask.includes('commands/write.md'))
  assert.match(doc, /argument-hint: \[--base <branch>\] \[--ask\]/)
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
