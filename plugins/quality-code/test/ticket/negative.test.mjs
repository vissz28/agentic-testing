import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkNegative, formatNegativeCheck } from '../../lib/ticket/negative.mjs'
import { buildBrief } from '../../lib/ticket/score.mjs'

const T = description => ({ key: 'DEMO-1', text: { description } })
const spec = readFileSync(new URL('../../commands/spec.md', import.meta.url), 'utf8')
const step4 = spec.slice(spec.indexOf('\n4. **Plan.**'), spec.indexOf('\n5. **Write.**'))

test('a happy-path-only ticket has no negative criteria', () => {
  const c = checkNegative(T('Given 8 orders, when I filter by customer Rossi, then the grid shows 5 rows.'))
  assert.equal(c.covered, false)
  assert.deepEqual(c.kinds, [])
  assert.match(formatNegativeCheck(c), /says nothing about invalid input, errors or permission denied/)
  assert.match(formatNegativeCheck(c), /does not change the score/)
})
test('invalid input, error and permission denied are each detected', () => {
  assert.deepEqual(checkNegative(T('The name is required and at most 40 characters.')).kinds, ['invalid_input'])
  assert.deepEqual(checkNegative(T('When the call fails the page shows an error.')).kinds, ['error'])
  assert.deepEqual(checkNegative(T('A viewer gets 403 forbidden.')).kinds, ['permission'])
  assert.equal(checkNegative(T('Un utente non autorizzato vede un errore.')).covered, true)
})
test('scenario names count too', () => {
  assert.equal(checkNegative({ text: { description: 'x' }, scenarios: ['Empty name is rejected'] }).covered, true)
})
test('the check adds nothing to the brief, so the score and the gate are untouched', () => {
  const config = { adapter: 'vitest', languages: ['en'], features: [], jira: {} }
  const b = buildBrief(config, T('Given 8 orders, when I filter, then the grid shows 5 rows.'))
  assert.ok(!('negative' in b))
  assert.ok(!JSON.stringify(b.flags).includes('Negative'))
})

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
function proj(description) {
  const d = mkdtempSync(join(tmpdir(), 'neg-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ticketsDir: 'tickets' }))
  writeFileSync(join(d, 't.json'), JSON.stringify({ key: 'DEMO-1', issuetype: 'Story', summary: 's', labels: [], text: { description } }))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d, QC_NO_AUDIT: '1' }, encoding: 'utf8' })

test('negative-check: reports the gap and prints the machine line, exit 0', () => {
  const r = run(proj('Given 8 orders, then 5 rows.'), 'negative-check', '--in', '@t.json')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Negative cases: the ticket says nothing/m)
  assert.equal(JSON.parse(r.stdout.match(/^NEGATIVE_JSON:(.*)$/m)[1]).covered, false)
})
test('negative-check --json: covered when the ticket names an error', () => {
  const r = run(proj('When the save fails, then an error is shown.'), 'negative-check', '--in', '@t.json', '--json')
  assert.equal(JSON.parse(r.stdout).covered, true)
})
test('score output is untouched by the negative check', () => {
  const r = run(proj('Given 8 orders, then 5 rows.'), 'score', '--in', '@t.json')
  assert.doesNotMatch(r.stdout, /Negative cases/)
})

test('spec plan: negative tests on every ticket, a Negative: N cases line, removable, nothing invented', () => {
  assert.match(step4, /ticket\.mjs" negative-check/)
  assert.match(step4, /on every ticket/)
  assert.ok((step4.match(/Negative: <N> cases/g) ?? []).length >= 2, 'both plan cards carry the line')
  assert.match(step4, /The person can remove any case/)
  assert.match(step4, /never invent a limit, a message or a role/)
  assert.match(step4, /ask in one line/)
})
test('writing guides carry a short negative tests section', () => {
  for (const g of ['vitest-writing.md', 'playwright-writing.md']) {
    const t = readFileSync(new URL(`../../guides/${g}`, import.meta.url), 'utf8')
    assert.match(t, /## Negative tests/)
    assert.match(t, /gets no test; ask/)
  }
})
