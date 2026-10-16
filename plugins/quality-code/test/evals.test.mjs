// Frozen evals: committed specs checked against what they must keep saying (both old fixture shapes).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main, runEvals } from '../core/evals.mjs'

const cfg = { version: 1, adapter: 'fullstack', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-evals-'))
  const all = { '.claude/quality-code.json': JSON.stringify(cfg), ...files }
  for (const [p, s] of Object.entries(all)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), typeof s === 'string' ? s : JSON.stringify(s)) }
  return d
}
const BE = "describe(`ABC-1 Stock`, () => {\n  it('rebuilds', () => { const s = new MovementService(); expect(s.stock()).toBeCloseTo(58.86, 2) })\n})\n"
const FE = "test.describe('ABC-2 Empty', () => {\n  test('ABC-2-1 shows the message', async ({ page }) => { await expect(page.getByText('Nessun dato')).toBeVisible() })\n})\n"
const TICKET = { summary: 'Stock', text: { description: '## Acceptance criteria\nGiven movements\nWhen rebuilt\nThen the stock ends at 58.86' } }

test('the old backend shape (regexes, minSpecs, a frozen ticket) and the old frontend shape (spec, tests) hold', () => {
  const d = project({
    'test/unit/stock.abc-1.spec.ts': BE,
    'e2e/empty.spec.ts': FE,
    '.claude/quality-code/evals/ABC-1/expected.json': { key: 'ABC-1', minSpecs: 1, specMustMatch: ['MovementService'], specMustNotMatch: ['new TradeItemRepository'] },
    '.claude/quality-code/evals/ABC-1/input.json': { ticket: JSON.stringify(TICKET), candidates: ['58.86'] },
    '.claude/quality-code/evals/ABC-2/expected.json': { spec: 'e2e/empty.spec.ts', tests: [{ key: 'ABC-2-1', mustContain: ['Nessun dato'] }] },
  })
  assert.deepEqual(runEvals(d, cfg), [{ key: 'ABC-1', problems: [] }, { key: 'ABC-2', problems: [] }])
})

test('drift: a softened assertion, a forbidden pattern, a lost value, a gone test or spec', () => {
  const d = project({
    'test/unit/stock.abc-1.spec.ts': BE.replace('toBeCloseTo(58.86, 2)', 'toBeDefined()').replace('new MovementService()', 'new TradeItemRepository()'),
    'e2e/empty.spec.ts': FE.replace("'Nessun dato'", "/dato/"),
    '.claude/quality-code/evals/ABC-1/expected.json': { specMustMatch: ['MovementService'], specMustNotMatch: ['new TradeItemRepository'], minSpecs: 2 },
    '.claude/quality-code/evals/ABC-1/input.json': { ticket: TICKET },
    '.claude/quality-code/evals/ABC-2/expected.json': { spec: 'e2e/empty.spec.ts', tests: [{ key: 'ABC-2-1', mustContain: ['Nessun dato'] }, { key: 'ABC-2-9' }] },
    '.claude/quality-code/evals/ABC-3/expected.json': { spec: 'e2e/gone.spec.ts' },
  })
  const r = Object.fromEntries(runEvals(d, cfg).map(x => [x.key, x.problems]))
  assert.deepEqual(r['ABC-1'], [
    '1 spec file(s) name ABC-1, at least 2 expected',
    'no spec matches /MovementService/',
    'a spec matches /new TradeItemRepository/, which it must not',
    'expected values: 1 of 1 expected value(s) from the ticket not asserted',
  ])
  assert.deepEqual(r['ABC-2'], ['ABC-2-1 no longer says "Nessun dato"', 'test ABC-2-9 is gone'])
  assert.deepEqual(r['ABC-3'], ['the spec e2e/gone.spec.ts is gone'])
})

test('cli: exit 0 when every fixture holds, 1 on drift, 3 with none', () => {
  const quiet = (d, args = []) => { let out = ''; const code = main(args, { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: () => {} }); return { code, out } }
  const ok = project({ 'test/unit/stock.abc-1.spec.ts': BE, '.claude/quality-code/evals/ABC-1/expected.json': { specMustMatch: ['MovementService'] } })
  assert.deepEqual(quiet(ok), { code: 0, out: '✓ ABC-1\n\nevals ok (1 fixture(s))\n' })
  const bad = project({ 'test/unit/stock.abc-1.spec.ts': BE, '.claude/quality-code/evals/ABC-1/expected.json': { specMustMatch: ['Nope'] } })
  const r = quiet(bad)
  assert.equal(r.code, 1)
  assert.match(r.out, /EVAL DRIFT: 1 of 1 fixture\(s\) failed/)
  assert.equal(quiet(project({})).code, 3)
})
