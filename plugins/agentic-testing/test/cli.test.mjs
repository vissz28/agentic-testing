import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = new URL('../core/cli.mjs', import.meta.url).pathname
const proj = () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/agentic-testing.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
  writeFileSync(join(d, 't.json'), JSON.stringify({ key: 'DEMO-1', issuetype: 'Bug', summary: 's', labels: [], text: { description: 'Broken.' } }))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

test('score: refuse exits 1 and prints the JSON line', () => {
  const r = run(proj(), 'score', '--in', '@t.json')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^TICKET_EVAL_JSON:/m)
})
test('relative @file resolves against the project, not cwd', () => {
  assert.equal(run(proj(), 'score', '--in', '@t.json').status, 1)
})
test('no config: exit 2 with the setup message', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  const r = run(d, 'score', '--in', '{}')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Run \/agentic-testing:setup/)
})
test('a key from another project is flagged; --ci stops', () => {
  const d = proj()
  writeFileSync(join(d, 'x.json'), JSON.stringify({ key: 'OTHER-1', text: {} }))
  assert.match(run(d, 'score', '--in', '@x.json').stdout, /^PROJECT_MISMATCH:/m)
  assert.equal(run(d, 'score', '--in', '@x.json', '--ci').status, 2)
})
test('add rewrites the file only when accepted', () => {
  const d = proj()
  const before = readFileSync(join(d, 't.json'), 'utf8')
  assert.equal(run(d, 'add', '--in', '@t.json', 'environment', ' ').status, 1)
  assert.equal(readFileSync(join(d, 't.json'), 'utf8'), before)
  assert.equal(run(d, 'add', '--in', '@t.json', 'environment', 'staging').status, 0)
  assert.match(readFileSync(join(d, 't.json'), 'utf8'), /Env: staging/)
})
test('config check', () => {
  assert.equal(run(proj(), 'config', 'check').stdout.trim(), 'ok')
})
test('--no-audit is accepted and ignored; unknown flags exit 2', () => {
  const d = proj()
  assert.equal(run(d, 'score', '--in', '@t.json', '--no-audit').status, 1)
  assert.equal(run(d, 'score', '--in', '@t.json', '--bogus').status, 2)
})
test('add rejection prints Not accepted and an Example line', () => {
  const r = run(proj(), 'add', '--in', '@t.json', 'ac_testable', 'it works as expected')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^Not accepted: /m)
  assert.match(r.stdout, /^Example: /m)
  assert.match(r.stdout, /^FILL_JSON:/m)
})
test('add with an inline ticket exits 2', () => {
  const r = run(proj(), 'add', '--in', '{"key":"DEMO-1"}', 'environment', 'x')
  assert.equal(r.status, 2)
})
test('fill-menu, pick, jira-update, refuse-comment', () => {
  const d = proj()
  const m = run(d, 'fill-menu', '--in', '@t.json')
  assert.equal(m.status, 0)
  assert.match(m.stdout, /^FILL_JSON:/m)
  assert.equal(run(d, 'pick', '--in', '@t.json', '1').stdout.includes('FILL_JSON:'), true)
  assert.equal(run(d, 'pick', '--in', '@t.json', '99').status, 2)
  const j = run(d, 'jira-update', '--in', '@t.json')
  assert.equal(j.status, 0)
  assert.match(j.stdout, /^JIRA_UPDATE_JSON:/m)
  assert.equal(run(d, 'refuse-comment', '--in', '@t.json').status, 1)
})
test('sanitize writes --out and deletes an @file input; missing --out exits 2', () => {
  const d = proj()
  assert.equal(run(d, 'sanitize', '--in', '@t.json').status, 2)
  assert.equal(existsSync(join(d, 't.json')), true)
  assert.equal(run(d, 'sanitize', '--in', '@t.json', '--out', 'clean.json').status, 0)
  assert.equal(existsSync(join(d, 't.json')), false)
  assert.equal(JSON.parse(readFileSync(join(d, 'clean.json'), 'utf8')).key, 'DEMO-1')
})
test('missing --in and unknown command exit 2', () => {
  const d = proj()
  assert.equal(run(d, 'score').status, 2)
  assert.equal(run(d, 'nope', '--in', '@t.json').status, 2)
})
test('add rejection: no Example line for a key the rubric does not score', () => {
  const d = proj()
  writeFileSync(join(d, '.claude/agentic-testing.json'), JSON.stringify({ version: 1, adapter: 'playwright', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
  const r = run(d, 'add', '--in', '@t.json', 'context', 'Order filter matches substrings')
  assert.equal(r.status, 1)
  assert.equal(r.stdout.split('\n')[0], 'Not accepted: There is no criterion called context that can be typed in.')
  assert.doesNotMatch(r.stdout, /^Example: /m)
})
