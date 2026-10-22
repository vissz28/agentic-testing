import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUDIT_DIR, KINDS, audit, auditOff, readAudit } from '../../lib/base/audit.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'qc-audit-'))
const NOW = new Date('2026-10-14T09:00:00.000Z')
const lines = (d, kind) => readFileSync(join(d, AUDIT_DIR, `${kind}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('the kinds and the folder', () => {
  assert.equal(AUDIT_DIR, '.claude/quality-code/audit')
  assert.deepEqual(KINDS, ['gate', 'pipeline', 'jira', 'override', 'fill'])
})
test('one line per event, appended, with the date', () => {
  const d = dir()
  assert.equal(audit(d, 'gate', { key: 'ABC-1', issuetype: 'Bug', score: 45, gate: 'refuse', rubric: 'vitest', legacy: false, missing: ['ac_present'], filled: 0 }, { env: {}, now: NOW }), true)
  audit(d, 'gate', { key: 'ABC-1', issuetype: 'Bug', score: 80, gate: 'pass', rubric: 'vitest', legacy: false, missing: [], filled: 2 }, { env: {}, now: NOW })
  assert.deepEqual(lines(d, 'gate'), [
    { key: 'ABC-1', issuetype: 'Bug', score: 45, gate: 'refuse', rubric: 'vitest', legacy: false, missing: ['ac_present'], filled: 0, date: '2026-10-14T09:00:00.000Z' },
    { key: 'ABC-1', issuetype: 'Bug', score: 80, gate: 'pass', rubric: 'vitest', legacy: false, missing: [], filled: 2, date: '2026-10-14T09:00:00.000Z' },
  ])
})
test('a fill line keeps the key, the item and the drafted mark only', () => {
  const d = dir()
  audit(d, 'fill', { key: 'ABC-1', item: 'ac_present', drafted: true, answer: 'Given a secret' }, { env: {}, now: NOW })
  audit(d, 'fill', { key: 'ABC-1', item: 'environment', drafted: 'yes' }, { env: {}, now: NOW })
  assert.deepEqual(lines(d, 'fill'), [
    { key: 'ABC-1', item: 'ac_present', drafted: true, date: '2026-10-14T09:00:00.000Z' },
    { key: 'ABC-1', item: 'environment', drafted: false, date: '2026-10-14T09:00:00.000Z' },
  ])
})
test('the audit folder ignores itself, also in a project set up before the setup line existed', () => {
  const d = dir()
  audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: {}, now: NOW })
  assert.equal(readFileSync(join(d, AUDIT_DIR, '.gitignore'), 'utf8'), '*\n')
  writeFileSync(join(d, AUDIT_DIR, '.gitignore'), '*\n# kept\n')
  audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: {}, now: NOW })
  assert.equal(readFileSync(join(d, AUDIT_DIR, '.gitignore'), 'utf8'), '*\n# kept\n', 'an existing file is left alone')
  spawnSync('git', ['init', '-q'], { cwd: d })
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: d, encoding: 'utf8' })
  assert.equal(r.stdout, '')
})
test('only keys, numbers and fixed words are kept: ticket text, paths and unknown fields are dropped', () => {
  const d = dir()
  audit(d, 'gate', { key: 'customer Mario Rossi', issuetype: 'Bug <script>', score: 'high', gate: 'maybe', rubric: '../x', legacy: 'yes', missing: ['ac_present', 'Then it works for user 12345'], filled: -1, summary: 'secret text', path: '/etc/passwd' }, { env: {}, now: NOW })
  assert.deepEqual(lines(d, 'gate'), [{ key: null, issuetype: null, score: null, gate: null, rubric: null, legacy: false, missing: ['ac_present'], filled: 0, date: '2026-10-14T09:00:00.000Z' }])
})
test('a pipeline entry: statuses, counts, each step\'s numbers and the run flags; never findings or paths', () => {
  const d = dir()
  audit(d, 'pipeline', {
    key: 'ABC-2', verdict: 'checks_failed', decidedBy: 'suite-honesty', adapter: 'vitest',
    steps: [
      { check: 'tests', status: 'pass', summary: 'x', findings: [{ file: '/home/u/a.spec.ts' }], data: { passed: 8, list: [{ title: 'secret' }], ran: true } },
      { check: 'suite-honesty', status: 'fail', data: { percent: 75, tests: 4, hollow: 1 } },
      { check: 'mutation', status: 'pass', data: { killed: 3, total: 3, score: 100, survivors: ['expect(x)'] } },
      { check: 'stryker', status: 'pass', data: { score: 83.33, threshold: 60, target: 'src/a.ts' } },
    ],
    counts: { specs: 2, passed: 8, failed: 0, skipped: 1, extra: 'no' },
    incompleteTicket: { score: 45, bar: 70 },
    flags: { ticket: true, target: 'yes', flaky: 3, extra: true },
  }, { env: {}, now: NOW })
  assert.deepEqual(lines(d, 'pipeline'), [{
    key: 'ABC-2', verdict: 'checks_failed', decidedBy: 'suite-honesty', adapter: 'vitest',
    steps: [
      { check: 'tests', status: 'pass', passed: 8 },
      { check: 'suite-honesty', status: 'fail', percent: 75, tests: 4, hollow: 1 },
      { check: 'mutation', status: 'pass', killed: 3, total: 3, score: 100 },
      { check: 'stryker', status: 'pass', score: 83, threshold: 60 },
    ],
    flags: { ticket: true, expected: false, target: false, range: false, flaky: 3 },
    counts: { specs: 2, passed: 8, failed: 0, skipped: 1 },
    incompleteTicket: { score: 45, bar: 70 },
    date: '2026-10-14T09:00:00.000Z',
  }])
})
test('jira and override entries', () => {
  const d = dir()
  audit(d, 'jira', { key: 'ABC-3', action: 'comment', body: 'text' }, { env: {}, now: NOW })
  audit(d, 'jira', { key: 'ABC-3', action: 'delete' }, { env: {}, now: NOW })
  audit(d, 'override', { key: 'ABC-3', score: 40, bar: 70 }, { env: {}, now: NOW })
  assert.deepEqual(lines(d, 'jira'), [{ key: 'ABC-3', action: 'comment', date: NOW.toISOString() }, { key: 'ABC-3', action: null, date: NOW.toISOString() }])
  assert.deepEqual(lines(d, 'override'), [{ key: 'ABC-3', score: 40, bar: 70, date: NOW.toISOString() }])
})
test('an unknown kind writes nothing', () => {
  const d = dir()
  assert.equal(audit(d, '../../x', { key: 'ABC-1' }, { env: {} }), false)
  assert.equal(existsSync(join(d, AUDIT_DIR)), false)
})
test('QC_NO_AUDIT=1 or off: true writes nothing', () => {
  const d = dir()
  assert.equal(audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: { QC_NO_AUDIT: '1' } }), false)
  assert.equal(audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: {}, off: true }), false)
  assert.equal(existsSync(join(d, AUDIT_DIR)), false)
  assert.equal(auditOff({ QC_NO_AUDIT: '1' }), true)
  assert.equal(auditOff({ QC_NO_AUDIT: '0' }), false)
  assert.equal(auditOff({}, true), true)
})
test('a failed append returns false and never throws', () => {
  const d = dir()
  writeFileSync(join(d, '.claude'), 'a file where the folder should be')
  assert.equal(audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: {} }), false)
})
test('a read-only audit folder: false, no throw', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, () => {
  const d = dir()
  mkdirSync(join(d, AUDIT_DIR), { recursive: true })
  chmodSync(join(d, AUDIT_DIR), 0o500)
  assert.equal(audit(d, 'jira', { key: 'ABC-1', action: 'comment' }, { env: {} }), false)
})
test('readAudit: entries in order, bad lines skipped, a missing file is empty', () => {
  const d = dir()
  assert.deepEqual(readAudit(d, 'gate'), [])
  mkdirSync(join(d, AUDIT_DIR), { recursive: true })
  writeFileSync(join(d, AUDIT_DIR, 'gate.jsonl'), '{"key":"ABC-1","date":"2026-10-01T00:00:00Z"}\nnot json\n\n[1]\n{"key":"ABC-2","date":"2026-10-02T00:00:00Z"}\n')
  assert.deepEqual(readAudit(d, 'gate').map(e => e.key), ['ABC-1', 'ABC-2'])
})
