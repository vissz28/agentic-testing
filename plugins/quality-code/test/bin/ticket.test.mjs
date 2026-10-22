import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const proj = () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
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
  assert.match(r.stderr, /Run \/quality-code:setup/)
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
test('config check: a lowercase jira.projects key exits 2 naming jira.projects[0]', () => {
  const d = proj()
  const c = JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'))
  c.jira.projects = ['fic']
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(c))
  const r = run(d, 'config', 'check')
  assert.equal(r.status, 2)
  assert.match(r.stdout + r.stderr, /jira\.projects\[0\]/)
})
test('--no-audit is accepted; unknown flags exit 2', () => {
  const d = proj()
  assert.equal(run(d, 'score', '--in', '@t.json', '--no-audit').status, 1)
  assert.equal(run(d, 'score', '--in', '@t.json', '--bogus').status, 2)
})

const AUDIT = '.claude/quality-code/audit'
const auditLines = (d, kind) => readFileSync(join(d, AUDIT, `${kind}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const noAuditEnv = { ...process.env }
delete noAuditEnv.QC_NO_AUDIT
const runA = (d, env, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...noAuditEnv, CLAUDE_PROJECT_DIR: d, ...env }, encoding: 'utf8' })

test('score logs one gate line: key, type, score, gate, rubric, legacy, missing criteria keys, fill-ins; no ticket text', () => {
  const d = proj()
  assert.equal(runA(d, {}, 'score', '--in', '@t.json').status, 1)
  assert.equal(runA(d, {}, 'score', '--in', '@t.json', '--json').status, 1)
  const g = auditLines(d, 'gate')
  assert.equal(g.length, 2)
  assert.deepEqual(Object.keys(g[0]), ['key', 'issuetype', 'score', 'gate', 'rubric', 'legacy', 'missing', 'filled', 'date'])
  assert.equal(g[0].key, 'DEMO-1')
  assert.equal(g[0].issuetype, 'Bug')
  assert.equal(g[0].gate, 'refuse')
  assert.equal(g[0].rubric, 'vitest')
  assert.equal(g[0].filled, 0)
  assert.ok(Number.isInteger(g[0].score) && g[0].score < 70)
  assert.ok(g[0].missing.includes('ac_present'))
  assert.doesNotMatch(JSON.stringify(g), /Broken/)
})
test('a fill-in is counted on the next gate line', () => {
  const d = proj()
  assert.equal(runA(d, {}, 'add', '--in', '@t.json', 'environment', 'staging').status, 0)
  runA(d, {}, 'score', '--in', '@t.json')
  assert.equal(auditLines(d, 'gate')[0].filled, 1)
})
test('--no-audit and QC_NO_AUDIT=1 turn the gate log off; other commands log nothing', () => {
  const d = proj()
  runA(d, {}, 'score', '--in', '@t.json', '--no-audit')
  runA(d, { QC_NO_AUDIT: '1' }, 'score', '--in', '@t.json')
  runA(d, {}, 'refuse-comment', '--in', '@t.json')
  runA(d, {}, 'fill-menu', '--in', '@t.json')
  assert.equal(existsSync(join(d, AUDIT)), false)
})
test('a failed append never changes the result or the exit code', () => {
  const d = proj()
  mkdirSync(join(d, '.claude/quality-code'), { recursive: true })
  writeFileSync(join(d, AUDIT), 'a file, not a folder')
  const r = runA(d, {}, 'score', '--in', '@t.json')
  assert.equal(r.status, 1)
  assert.equal(r.stderr, '')
  assert.match(r.stdout, /^TICKET_EVAL_JSON:/m)
})
test('jira-posted <KEY> comment|update|risk logs what was sent to Jira (the key and the kind only)', () => {
  const d = proj()
  const a = runA(d, {}, 'jira-posted', 'DEMO-1', 'comment')
  assert.equal(a.status, 0, a.stderr)
  assert.equal(a.stdout, 'ok\n')
  assert.equal(runA(d, {}, 'jira-posted', 'DEMO-1', 'update').status, 0)
  assert.equal(runA(d, {}, 'jira-posted', 'DEMO-1', 'risk').status, 0)
  assert.deepEqual(auditLines(d, 'jira').map(x => [x.key, x.action]), [['DEMO-1', 'comment'], ['DEMO-1', 'update'], ['DEMO-1', 'risk']])
  for (const bad of [['jira-posted'], ['jira-posted', 'DEMO-1'], ['jira-posted', 'demo 1', 'comment'], ['jira-posted', 'DEMO-1', 'delete']]) {
    const r = runA(d, {}, ...bad)
    assert.equal(r.status, 2, bad.join(' '))
    assert.match(r.stderr, /usage: ticket\.mjs jira-posted <KEY> comment\|update\|risk/)
  }
  assert.equal(auditLines(d, 'jira').length, 3)
  const e = proj()
  assert.equal(runA(e, { QC_NO_AUDIT: '1' }, 'jira-posted', 'DEMO-1', 'comment').stdout, 'ok\n')
  assert.equal(existsSync(join(e, AUDIT)), false)
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
test('fill-menu, pick, jira-update, refuse-comment, risk-comment', () => {
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
  const r = run(d, 'risk-comment', '--in', '@t.json')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Tests were written for this ticket although it is not complete: it has \d+ of the 70 points it needs\.$/m)
  assert.match(r.stdout, /Logged by quality-code: tests were written on an incomplete ticket\.\n$/)
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
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'playwright', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
  const r = run(d, 'add', '--in', '@t.json', 'context', 'Order filter matches substrings')
  assert.equal(r.status, 1)
  assert.equal(r.stdout.split('\n')[0], 'Not accepted: There is no criterion called context that can be typed in.')
  assert.doesNotMatch(r.stdout, /^Example: /m)
})
test('sanitize with --out equal to --in keeps the sanitized file', () => {
  const d = proj()
  for (const out of ['t.json', './t.json', join(d, 't.json')]) {
    assert.equal(run(d, 'sanitize', '--in', '@t.json', '--out', out).status, 0, out)
    assert.equal(existsSync(join(d, 't.json')), true, out)
    assert.equal(JSON.parse(readFileSync(join(d, 't.json'), 'utf8')).key, 'DEMO-1', out)
  }
})
const oneLine = r => {
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr)
  assert.doesNotMatch(r.stderr, /^\s+at /m)
}
test('sanitize into a missing folder: one line, exit 2, input kept', () => {
  const d = proj()
  const r = run(d, 'sanitize', '--in', '@t.json', '--out', 'no/such/dir/clean.json')
  assert.equal(r.status, 2)
  oneLine(r)
  assert.equal(existsSync(join(d, 't.json')), true)
})
test('add on a read-only ticket file: one line, exit 2', () => {
  const d = proj()
  chmodSync(join(d, 't.json'), 0o444)
  const r = run(d, 'add', '--in', '@t.json', 'environment', 'staging')
  chmodSync(join(d, 't.json'), 0o644)
  assert.equal(r.status, 2)
  oneLine(r)
})
test('-- ends flag parsing, so an answer may start with --', () => {
  const d = proj()
  const r = run(d, 'add', '--in', '@t.json', '--', 'environment', '--staging')
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(join(d, 't.json'), 'utf8'), /Env: --staging/)
})
test('jira-update uses the configured fill marker', () => {
  const d = proj()
  const c = JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ ...c, messages: { jiraFillMark: '_Added by QA._' } }))
  assert.equal(run(d, 'add', '--in', '@t.json', 'environment', 'staging').status, 0)
  const line = run(d, 'jira-update', '--in', '@t.json').stdout.split('\n').find(l => l.startsWith('JIRA_UPDATE_JSON:'))
  assert.match(JSON.parse(line.slice('JIRA_UPDATE_JSON:'.length)).append, /^_Added by QA\._\n\n## Environment/)
})
