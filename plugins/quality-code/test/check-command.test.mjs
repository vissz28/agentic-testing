// The check command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/check.md', import.meta.url), 'utf8')

test('frontmatter has a description and the argument hint', () => {
  assert.match(doc, /^---\ndescription: .+\nargument-hint: \[spec…\] \[--key KEY\] \[--flaky N\]\n---/)
})
test('no specs: detect the branch and offer its test files', () => {
  assert.ok(doc.includes('core/branch.mjs" --detect'))
  assert.ok(doc.includes('Check these <n> spec files?'))
  for (const t of ['1. Yes', '2. Pick some', '3. Stop']) assert.ok(doc.includes(t), t)
})
test('the key comes from the branch and is confirmed', () => {
  assert.match(doc, /keys\[0\]/)
  assert.match(doc, /confirm/i)
})
test('one line before the run, then the pipeline CLI', () => {
  assert.ok(doc.includes('Running the checks: tests, assertions, types and mutation; this can take a few minutes.'))
  assert.ok(doc.includes('core/pipeline/cli.mjs"'))
  assert.ok(doc.indexOf('Running the checks') < doc.indexOf('core/pipeline/cli.mjs"'))
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
test('Playwright projects wait for part 3', () => {
  assert.ok(doc.includes('the Playwright pipeline comes with part 3'))
})
test('no token in the chat; no mcp tools', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
})
test('examples use neutral keys', () => {
  assert.doesNotMatch(doc, /AGT|FIC|warehouse/i)
})
