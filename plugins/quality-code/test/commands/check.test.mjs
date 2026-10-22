// The check command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/check.md', import.meta.url), 'utf8')

test('frontmatter has a description and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: \[spec…\] \[--key KEY\] \[--flaky N\] \| --evals\n(?:[a-z-]+: .+\n)*---/)
})
test('no specs: detect the branch and offer its test files', () => {
  assert.ok(doc.includes('bin/branch.mjs" --detect'))
  assert.ok(doc.includes('Check these <n> spec files?'))
  for (const t of ['1. Yes', '2. Pick some', '3. Stop']) assert.ok(doc.includes(t), t)
})
test('deleted test files are left out of the spec list', () => {
  assert.match(doc, /`status` is not `D`/)
})
test('the branch run passes the base as the honesty range and says what it covers', () => {
  assert.ok(doc.includes('--range <base>...HEAD'))
  assert.match(doc, /`base` from the `BRANCH_JSON:` line/)
  assert.match(doc, /committed on the branch/)
  assert.match(doc, /not committed yet/)
  assert.match(doc, /only when the specs came from the branch/)
})
test('spec paths are quoted in the shell command', () => {
  assert.match(doc, /Quote every spec path in single quotes/)
  assert.ok(doc.includes("'<spec>'"))
})
test('the key comes from the branch and is confirmed', () => {
  assert.match(doc, /keys\[0\]/)
  assert.match(doc, /confirm/i)
})
test('one line before the run, then the pipeline CLI', () => {
  assert.ok(doc.includes('Running the checks: tests, assertions, types and mutation; this can take a few minutes.'))
  assert.ok(doc.includes('bin/pipeline.mjs"'))
  assert.ok(doc.indexOf('Running the checks') < doc.indexOf('bin/pipeline.mjs"'))
})
test('the card is relayed verbatim without the machine line', () => {
  assert.ok(doc.includes('Show the card exactly as printed'))
  assert.ok(doc.includes('PIPELINE_JSON:'))
  assert.match(doc, /Drop the `PIPELINE_JSON:` line/)
})
test('commands never grade, edit tests or retry', () => {
  assert.match(doc, /Never edit tests/)
  assert.match(doc, /never retry/)
})
test('Vitest and Playwright projects run the same pipeline; Playwright gets the line about the app', () => {
  assert.doesNotMatch(doc, /part 3/)
  assert.doesNotMatch(doc, /Vitest projects only/)
  assert.match(doc, /^description: Check Vitest or Playwright spec files/m)
  assert.match(doc, /`vitest`, `playwright` and `fullstack` projects are checked the same way/)
  assert.match(doc, /on a fullstack project, per spec: the e2e folder's specs run under Playwright/)
  assert.match(doc, /for `fullstack` when a spec is in the e2e folder, add this second line/)
  assert.ok(doc.includes('The tests open the app: your Playwright config starts it (its webServer), or it must already be running.'))
  assert.ok(doc.indexOf('The tests open the app') < doc.indexOf('bin/pipeline.mjs"'))
})
test('no token in the chat; no mcp tools', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
})
test('examples use neutral keys', () => {
  assert.doesNotMatch(doc, /AGT|FIC|warehouse/i)
})

test('with a key, the saved ticket and target are passed, so the value check and Stryker run', () => {
  assert.ok(doc.includes("[--ticket @<ticketsDir>/<KEY>/ticket.json] [--expected @<ticketsDir>/<KEY>/expected.json] [--target '<target>']"))
  assert.match(doc, /and `--expected @<ticketsDir>\/<KEY>\/expected\.json` when that file is there/)
  assert.match(doc, /when `ticket\.json` is there, pass `--ticket @<ticketsDir>\/<KEY>\/ticket\.json`/)
  assert.match(doc, /when `target` is there and names an existing file that is not one of the specs, and the adapter is `vitest` or `fullstack`, pass `--target/)
  assert.match(doc, /Never pass `--target` on a `playwright` project/)
  assert.match(doc, /do not read the ticket from Jira here/)
})

test('--evals runs only the frozen evals script', () => {
  assert.match(doc, /argument-hint: \[spec…\] \[--key KEY\] \[--flaky N\] \| --evals/)
  assert.ok(doc.includes('run only `node "${CLAUDE_PLUGIN_ROOT}/bin/evals.mjs"`'))
})
