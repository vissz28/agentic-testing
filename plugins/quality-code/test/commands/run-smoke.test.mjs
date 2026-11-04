// /quality-code:run-smoke is a prompt over the shared run guide; these pin it, the smoke guide and the spec and ci wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const cmd = read('commands/run-smoke.md')
const run = read('guides/run.md')
const smoke = read('guides/smoke.md')

test('the command: its own suite, the url option, read-only, the shared guides', () => {
  assert.match(cmd, /^---\ndescription: .+\nargument-hint: \[--url URL\]\n/)
  assert.ok(cmd.includes('with the suite `smoke`'))
  assert.ok(cmd.includes('${CLAUDE_PLUGIN_ROOT}/guides/run.md'))
  assert.ok(cmd.includes('${CLAUDE_PLUGIN_ROOT}/guides/smoke.md'))
  assert.match(cmd, /allowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/\*\)/)
  assert.match(cmd, /^model: haiku$/m)
})

test('the run guide: smoke runs the script with --smoke, passes --url quoted, asks no key, never edits', () => {
  assert.ok(run.includes('`/quality-code:run-smoke`'))
  assert.ok(run.includes('bin/pipeline.mjs" --smoke [--url \'<URL>\']'))
  assert.match(run, /No @smoke tests found/)
  assert.match(run, /never put a user name or password in it/)
  assert.match(run, /Read-only: never tag, edit or add a test here/)
})

test('the smoke guide: the person picks at the plan card, tags go on the test line, no backend tag', () => {
  assert.match(smoke, /Which of these are critical enough to run on every deploy \(@smoke\)\?/)
  assert.match(smoke, /AskUserQuestion picker, multi-select/)
  assert.match(smoke, /\{ tag: '@smoke' \}/)
  assert.match(smoke, /Never suggest an `Extra:` probe/)
  assert.match(smoke, /Backend specs have no smoke tag yet/)
  assert.match(smoke, /--grep @smoke/)
})

test('spec points at the smoke guide, and ci documents the optional job', () => {
  assert.ok(read('commands/spec.md').includes('${CLAUDE_PLUGIN_ROOT}/guides/smoke.md'))
  const ci = read('commands/ci.md')
  assert.match(ci, /argument-hint: \[github\|gitlab\] \[--smoke\] \[--print\]/)
  assert.match(ci, /smoke_post_deploy/)
  assert.match(ci, /`SMOKE_URL`/)
})

test('listed in the docs and the MCP server readme', () => {
  assert.ok(read('README.md').includes('/quality-code:run-smoke'))
  assert.ok(read('mcp-server/README.md').includes('`quality_code_run_smoke`'))
})
