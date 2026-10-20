import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildKpi, formatKpiCard, loadEvents, main } from '../core/kpi.mjs'

const CLI = new URL('../core/kpi.mjs', import.meta.url).pathname
const NOW = Date.parse('2026-10-14T12:00:00Z')
const day = (d, h = 9) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
const gate = (key, d, score, more = {}) => ({ key, issuetype: 'Story', score, gate: score >= 70 ? 'pass' : 'refuse', rubric: 'vitest', legacy: false, missing: [], filled: 0, date: day(d), ...more })
const pipe = (key, d, verdict, decidedBy, more = {}) => ({ key, verdict, decidedBy, adapter: 'vitest', steps: [], counts: {}, incompleteTicket: null, date: day(d), ...more })

function project(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qc-kpi-'))
  for (const [p, rows] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), typeof rows === 'string' ? rows : jsonl(rows))
  }
  return root
}
const A = '.claude/quality-code/audit/'
const FULL = {
  [`${A}gate.jsonl`]: [
    gate('ABC-1', 2, 40, { missing: ['ac_present', 'ac_testable', 'steps'] }),
    gate('ABC-1', 2, 85, { filled: 2 }), // refused, filled in here, passed
    gate('ABC-2', 3, 55, { missing: ['ac_present', 'environment'] }),
    gate('ABC-3', 4, 92),
    gate('ABC-4', 5, 20, { missing: ['ac_present', 'steps'] }),
    gate('ABC-5', 6, 30, { missing: ['steps'] }),
    gate('ABC-5', 7, 75), // passed after an edit on Jira, not a fill-in here
    gate('OLD-1', 1, 10, { date: '2026-08-01T00:00:00.000Z' }), // outside the period
  ],
  [`${A}pipeline.jsonl`]: [
    pipe('ABC-1', 2, 'green', null),
    pipe('ABC-3', 4, 'checks_failed', 'mutation'),
    pipe('ABC-3', 4, 'checks_failed', 'mutation'),
    pipe('ABC-3', 5, 'tests_red', 'tests'),
    pipe('ABC-4', 6, 'not_verified', 'types', { incompleteTicket: { score: 20, bar: 70 } }),
    pipe('ABC-2', 7, 'green', null, { incompleteTicket: { score: 55, bar: 70 } }),
  ],
  [`${A}jira.jsonl`]: [{ key: 'ABC-2', action: 'comment', date: day(3) }, { key: 'ABC-4', action: 'comment', date: day(5) }, { key: 'ABC-1', action: 'update', date: day(2) }, { key: 'ABC-2', action: 'risk', date: day(7) }],
  [`${A}override.jsonl`]: [{ key: 'ABC-4', score: 20, bar: 70, date: day(6) }, { key: 'ABC-2', score: 55, bar: 70, date: day(7) }],
  '.claude/quality-code/boundary.jsonl': [{ ts: day(4), path: 'src/a.ts' }, { ts: day(6), path: 'src/b.ts' }, { ts: '2026-01-01T00:00:00.000Z', path: 'x' }],
}

async function run(args, root, env = {}) {
  let out = ''
  let err = ''
  const code = await main(args, { CLAUDE_PROJECT_DIR: root, ...env }, '/', { now: NOW, stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}
const kpiJson = out => JSON.parse(out.trim().split('\n').at(-1).replace(/^KPI_JSON:/, ''))

test('the card, exactly', async () => {
  const root = project(FULL)
  const r = await run([], root)
  assert.equal(r.code, 0, r.err)
  const lines = r.out.trim().split('\n')
  assert.deepEqual(lines.slice(0, -1), [
    `quality-code KPI · last 30 days · ${root.split('/').at(-1)}`,
    '',
    'Gate        5 tickets · 3 passed · 2 refused · 7 evaluations',
    'Scores      0-29: 1 · 30-49: 0 · 50-69: 1 · 70-89: 2 · 90-100: 1',
    'Missing     acceptance criteria 3 · steps to reproduce 3 · testable AC 1',
    'Filled in   1 refused ticket filled in here, then passed',
    'Jira        2 comments posted · 1 ticket updated · 1 risk note',
    'Forced      2 runs past the gate (continue anyway): ABC-2, ABC-4',
    'Pipeline    6 runs · 2 green · 2 checks failed · 1 tests red · 1 not verified',
    'Decided by  mutation 2 · tests 1 · types 1',
    'Boundary    2 writes blocked',
    '',
    'Quality (the Quality Program numbers this repo can show)',
    '  —  Traceability    no data  target 100%  no project config to find the specs',
    '  ⚠️ Completeness    65       target 95    mean readiness score of 5 ticket(s)',
    '  —  Suite honesty   no data  target 100%  no project config to find the specs',
    '  —  Gate integrity  no data  target 100%  no run logged with its gates yet',
    '  —  Adoption        67%                   2 of 3 ready ticket(s) have a pipeline run (few tickets: a fact, not yet a rate)',
    '  —  Coverage        no data  target 80%   no coverage/coverage-summary.json (the suite is never run here)',
    '  —  Mutation kill   no data               no run had assertions to mutate yet',
    '',
    'AI cost: /quality-code:consumption --since 2026-09-15 --until 2026-10-14',
  ])
  assert.match(lines.at(-1), /^KPI_JSON:\{/)
})
test('the report object behind the card', async () => {
  const j = kpiJson((await run([], project(FULL))).out)
  assert.deepEqual(j.period, { since: '2026-09-15', until: '2026-10-14', label: 'last 30 days' })
  assert.deepEqual(j.gate, {
    evaluations: 7, tickets: 5, passed: 3, refused: 2,
    scores: { '0-29': 1, '30-49': 0, '50-69': 1, '70-89': 2, '90-100': 1 },
    missing: [{ key: 'ac_present', label: 'acceptance criteria', tickets: 3 }, { key: 'steps', label: 'steps to reproduce', tickets: 3 }, { key: 'ac_testable', label: 'testable AC', tickets: 1 }],
    filledThenPassed: 1,
  })
  assert.deepEqual(j.jira, { comments: 2, updates: 1, risks: 1 })
  assert.deepEqual(j.forced, { runs: 2, tickets: ['ABC-2', 'ABC-4'] })
  assert.deepEqual(j.pipeline, { runs: 6, verdicts: { green: 2, checks_failed: 2, tests_red: 1, not_verified: 1 }, decidedBy: [{ check: 'mutation', runs: 2 }, { check: 'tests', runs: 1 }, { check: 'types', runs: 1 }] })
  assert.deepEqual(j.boundary, { blocked: 2 })
  assert.equal(j.consumption, '/quality-code:consumption --since 2026-09-15 --until 2026-10-14')
})
test('--since and --until narrow the period; --json prints the report only', async () => {
  const r = await run(['--since', '2026-10-04', '--until', '2026-10-05', '--json'], project(FULL))
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out.trim().split('\n').length, 1)
  const j = JSON.parse(r.out)
  assert.deepEqual(j.period, { since: '2026-10-04', until: '2026-10-05', label: '2026-10-04 to 2026-10-05' })
  assert.equal(j.gate.tickets, 2)
  assert.equal(j.pipeline.runs, 3)
  assert.equal(j.boundary.blocked, 1)
  assert.equal((await run(['--since', '7d', '--json'], project(FULL))).code, 0)
})
test('an empty period: the card says so per line, exit 0', async () => {
  const r = await run(['--since', '2026-09-01', '--until', '2026-09-02'], project(FULL))
  assert.equal(r.code, 0)
  assert.match(r.out, /^Gate {8}no ticket gated$/m)
  assert.match(r.out, /^Pipeline {4}no run$/m)
  assert.match(r.out, /^Jira {8}nothing posted$/m)
  assert.match(r.out, /^Forced {6}none$/m)
  assert.match(r.out, /^Boundary {4}no write blocked$/m)
  assert.doesNotMatch(r.out, /^(Scores|Missing|Filled in|Decided by)/m)
})
test('no audit data yet: exit 3, says where it looked', async () => {
  const root = project()
  const r = await run([], root)
  assert.equal(r.code, 3)
  assert.equal(r.out, `No quality-code audit data yet for ${root}.\nLooked in:\n  ${join(root, '.claude/quality-code/audit')}/\n  ${join(root, '.claude/quality-code/boundary.jsonl')}\nThe log fills as tickets are gated and checks run.\n`)
  assert.equal((await run([], project({ [`${A}gate.jsonl`]: 'not json\n' }))).code, 3, 'unreadable lines are no data')
})
test('the boundary log alone is data', async () => {
  const r = await run([], project({ '.claude/quality-code/boundary.jsonl': [{ ts: day(4), path: 'src/a.ts' }] }))
  assert.equal(r.code, 0)
  assert.match(r.out, /^Boundary {4}1 write blocked$/m)
})
test('usage errors: exit 2 with the usage line', async () => {
  for (const args of [['--since'], ['--since', 'yesterday'], ['--until', '14/10/2026'], ['--by', 'day'], ['--since', '2026-10-10', '--until', '2026-10-01']]) {
    const r = await run(args, project(FULL))
    assert.equal(r.code, 2, args.join(' '))
    assert.match(r.err, /usage: kpi\.mjs \[--since 7d\|30d\|YYYY-MM-DD\] \[--until YYYY-MM-DD\] \[--json\]/)
  }
})
test('a gate without a key counts as its own ticket; unknown criteria keep their key', () => {
  const r = buildKpi({ gate: [gate(null, 2, 40, { missing: ['zz_new'] }), gate(null, 3, 50)], pipeline: [], jira: [], override: [], boundary: [] }, { period: { since: Date.parse(day(1)), until: NOW, label: 'x' }, project: 'p' })
  assert.equal(r.gate.tickets, 2)
  assert.deepEqual(r.gate.missing, [{ key: 'zz_new', label: 'zz_new', tickets: 1 }])
  assert.match(formatKpiCard(r), /^Missing {5}zz_new 1$/m)
})
test('loadEvents reads every kind and the boundary log, and says where it looked', () => {
  const root = project(FULL)
  const e = loadEvents(root)
  assert.deepEqual([e.gate.length, e.pipeline.length, e.jira.length, e.override.length, e.boundary.length], [8, 6, 4, 2, 3])
  assert.deepEqual(e.looked, [`${join(root, '.claude/quality-code/audit')}/`, join(root, '.claude/quality-code/boundary.jsonl')])
})
test('the script runs from the command line', () => {
  const root = project(FULL)
  const r = spawnSync(process.execPath, [CLI, '--json'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(JSON.parse(r.stdout).gate)
  const none = spawnSync(process.execPath, [CLI], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: project() }, encoding: 'utf8' })
  assert.equal(none.status, 3)
  assert.equal(spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status, 2)
})

test('quality: traceability and suite honesty from the specs, gate integrity, mutation mean and coverage', async () => {
  const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } }
  const root = project({
    '.claude/quality-code.json': JSON.stringify(cfg),
    'test/a.abc-1.spec.ts': "describe('ABC-1 Pricing', () => {\n  it('adds', () => { expect(1).toBe(1) })\n})\n",
    'test/b.spec.ts': "describe('helpers', () => {\n  it('hollow', () => { run() })\n})\n",
    'test/abc-7.spec.ts': "it('ABC-7-1 adds', () => { expect(1).toBe(1) })\n",
    'coverage/coverage-summary.json': JSON.stringify({ total: { lines: { pct: 83.4 } } }),
    [`${A}gate.jsonl`]: [gate('ABC-1', 2, 90)],
    [`${A}pipeline.jsonl`]: [
      pipe('ABC-1', 3, 'green', null, { flags: { ticket: true }, steps: [{ check: 'mutation', status: 'pass', killed: 4, total: 4, score: 100 }] }),
      pipe('ABC-1', 4, 'green', null, { flags: { ticket: false }, steps: [{ check: 'mutation', status: 'fail', killed: 1, total: 2, score: 50 }] }),
      pipe('ABC-1', 5, 'green', null),
    ],
  })
  const q = kpiJson((await run([], root)).out).quality
  // The key in a describe, in a test title or in the file name links a spec to its ticket.
  assert.deepEqual(q.traceability, { pct: 67, traced: 2, specs: 3 })
  assert.deepEqual(q.suiteHonesty, { pct: 67, honest: 2, tests: 3 })
  assert.deepEqual(q.gateIntegrity, { pct: 50, full: 1, runs: 2, relaxed: 1 }, 'a run logged before flags existed is left out')
  assert.deepEqual(q.mutation, { mean: 75, runs: 2 })
  assert.deepEqual(q.coverage, { pct: 83, file: 'coverage/coverage-summary.json' })
  assert.deepEqual(q.adoption, { pct: 100, checked: 1, ready: 1 })
  assert.match((await run([], root)).out, /\n  ✅ Coverage        83%      target 80%   lines, from coverage\/coverage-summary\.json\n/)
})

test('mutation kill rate: from the logged counts, as the pipeline writes them (no score field)', async () => {
  const { qualityKpi } = await import('../core/quality-kpi.mjs')
  const q = qualityKpi({ finals: [], runs: [{ steps: [{ check: 'mutation', status: 'pass', killed: 6, survived: 0, errors: 0, total: 6 }] }, { steps: [{ check: 'mutation', status: 'fail', killed: 1, total: 2 }] }, { steps: [{ check: 'mutation', status: 'not_run' }] }], scan: null, coverage: null })
  assert.deepEqual(q.mutation, { mean: 75, runs: 2 })
})
