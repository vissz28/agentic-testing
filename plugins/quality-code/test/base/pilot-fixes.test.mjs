// Pilot report fixes: the expected-value check, env-gated skips, assertions through page objects, the mutation message,
// the anchor on the branch, the side default, the config blocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { ticketSide } from '../../lib/base/stack.mjs'
import { buildVocabulary } from '../../lib/ticket/languages/index.mjs'
import { envGatedSkip, scanDiff } from '../../lib/pipeline/checks/honesty.mjs'
import { countAssertions, anchorRange } from '../../lib/pipeline/checks/suite-honesty.mjs'
import { fieldTokensFrom, groundCandidates, outcomeOf, run as runExpected, tokensFrom } from '../../lib/pipeline/checks/expected.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const v = buildVocabulary(['en', 'it'])
const jira = { site: 'https://x.atlassian.net', projects: ['PFO'] }

test('the expected values of a one-line Given / When / Then are read after the Then, not from the When', () => {
  const line = 'Given a paid document in SENT status, when the user clicks "Rectify demographic data", then the dialog shows "Reinvio per variazione" and operation_type is "V".'
  assert.equal(outcomeOf(line, v), ' the dialog shows "Reinvio per variazione" and operation_type is "V".')
  const tokens = tokensFrom({ text: { description: `### Acceptance Criteria\n- ${line}` } }, v).map(t => t.token)
  assert.ok(tokens.includes('Reinvio per variazione'))
  assert.ok(!tokens.includes('Rectify demographic data'), 'the label the user clicks is an input')
  assert.equal(outcomeOf('Then the total is 80', v), 'Then the total is 80', 'a Then line alone is read whole')
  assert.deepEqual(fieldTokensFrom(['GIVEN x WHEN y THEN operation_type is "V"'], v).map(t => t.token), ['operation_type'])
})

test('--expected values are grounded in the whole ticket text, not only the Then lines', () => {
  const chunks = ['THEN the tab shows "Variations"']
  const full = `${chunks[0]}\n## Notes\nThe action is called "Reinvio per variazione" in the UI.`
  assert.deepEqual(groundCandidates(['Reinvio per variazione'], chunks, [], full).kept.map(k => k.token), ['Reinvio per variazione'])
  assert.deepEqual(groundCandidates(['Reinvio per variazione'], chunks, []).ignored, ['Reinvio per variazione'], 'without the full text it is still ignored')
  assert.deepEqual(groundCandidates(['not in the ticket'], chunks, [], full).ignored, ['not in the ticket'])
})

function project(spec, config = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qc-exp-'))
  mkdirSync(join(root, 'test'), { recursive: true })
  writeFileSync(join(root, 'test/a.spec.ts'), spec)
  writeFileSync(join(root, 'ticket.json'), JSON.stringify({ key: 'PFO-1', summary: 'S', text: { description: '### Acceptance Criteria\n- Given a paid document, when the user clicks "Rectify", then the dialog shows "Reinvio per variazione" and sts_submission is written.' } }))
  return { root, ctx: { root, config: { version: 1, adapter: 'vitest', jira, ...config }, dialect: dialectFor('vitest'), dialectOf: () => dialectFor('vitest') } }
}
const SPEC = "describe('PFO-1 dialog', () => { it('shows', () => { expect(screen.getByText('Reinvio per variazione')).toBeVisible() }) })\n"

test('expected: a name another package owns is ignored, a field check can be turned off, an alias counts', () => {
  let p = project(SPEC)
  let r = runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx)
  assert.equal(r.status, 'fail', 'sts_submission is a field the test cannot assert')
  assert.deepEqual(r.data.missing, ['sts_submission'])
  p = project(SPEC, { expected: { ignore: ['sts_submission'] } })
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx).status, 'pass')
  p = project(SPEC, { expected: { fields: false } })
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx).status, 'pass')
  // alias: the test asserts the UI's text for a word the ticket writes differently
  p = project("describe('PFO-1 d', () => { it('x', () => { expect(screen.getByText('Reinvia')).toBeVisible() }) })\n", { expected: { fields: false, aliases: { 'Reinvio per variazione': ['Reinvia'] } } })
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx).status, 'pass')
  p = project("describe('PFO-1 d', () => { it('x', () => { expect(screen.getByText('Reinvia')).toBeVisible() }) })\n", { expected: { fields: false } })
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx).status, 'fail')
})

test('expected: with ticketAnchor "branch" a spec with no block of the key is read whole', () => {
  const spec = "describe('Dialog', () => { it('shows', () => { expect(screen.getByText('Reinvio per variazione')).toBeVisible() }) })\n"
  const p = project(spec, { expected: { fields: false } })
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json' }, p.ctx).status, 'not_run')
  assert.equal(runExpected({ specs: ['test/a.spec.ts'], key: 'PFO-1', ticket: 'ticket.json', whole: true }, p.ctx).status, 'pass')
  const d = dialectFor('vitest')
  assert.equal(anchorRange(spec, 'PFO-1', d), null)
  assert.deepEqual(anchorRange(spec, 'PFO-1', d, { whole: true }), [0, spec.length])
})

test('honesty: a skip gated on the environment, or excused by a condition and the ticket, is honest; a bare skip is not', () => {
  assert.equal(envGatedSkip('test.skip(!ids, "PFO-2360: set STS_TAXPAYER_ID to run this")', 'PFO-2360'), true, 'names an env variable')
  assert.equal(envGatedSkip('test.skip(!process.env.TAXPAYER, "no data")', null), true, 'reads the environment')
  assert.equal(envGatedSkip('test.skip(!ids, "PFO-2360 needs seeded data")', 'PFO-2360'), true, 'names the ticket under test')
  assert.equal(envGatedSkip('test.skip(!ids, "needs seeded data")', 'PFO-2360'), false, 'a condition with no reason of that kind')
  assert.equal(envGatedSkip("test.skip('PFO-2360 later')", 'PFO-2360'), false, 'an unconditional skip is never excused')
  const diff = ['+++ b/e2e/a.spec.js', '+test.skip(!ids, "PFO-2360: set STS_TAXPAYER_ID")', '+test.skip("drops a test")'].join('\n')
  const out = scanDiff(diff, dialectFor('playwright'), '(?:PFO)-\\d+', { own: 'PFO-2360' })
  assert.deepEqual(out.map(x => x.line), ['test.skip("drops a test")'])
})

test('assertions through page objects: expect/assert/verify methods and the configured prefixes count', () => {
  const body = "test('x', async () => { await dashboard.expectDataGridVisible(); await page.goto('/') })"
  assert.equal(countAssertions(body), 1)
  assert.equal(countAssertions("test('x', async () => { await page.goto('/') })"), 0)
  assert.equal(countAssertions("test('x', async () => { await grid.checkRows(3) })"), 0)
  assert.equal(countAssertions("test('x', async () => { await grid.checkRows(3) })", { helpers: ['check'] }), 1)
  assert.equal(countAssertions("test('x', async () => { await page.verifyTitle('a'); await page.assertUrl('b') })"), 2)
  assert.equal(countAssertions("test('x', async () => { const expectation = 1 })"), 0, 'a name that only starts with expect is not a call')
})

test('config: expected, assertionHelpers, ticketAnchor, roots and sides.default are checked', () => {
  const base = { version: 1, adapter: 'fullstack', jira }
  assert.equal(validateConfig({ ...base, expected: { aliases: { A: 'B', C: ['D'] }, ignore: ['x'], fields: false }, assertionHelpers: ['check'], ticketAnchor: 'branch', roots: ['app', 'be'], sides: { default: 'fullstack' } }).ok, true)
  const bad = validateConfig({ ...base, expected: { aliases: { A: 5 }, ignore: 'x', fields: 'no', other: 1 }, assertionHelpers: ['a b'], ticketAnchor: 'x', roots: ['../x'], sides: { default: 'mobile' } }).errors
  for (const m of [/expected\.aliases\.A/, /expected\.ignore/, /expected\.fields/, /expected\.other/, /assertionHelpers/, /ticketAnchor/, /roots/, /sides\.default/]) assert.ok(bad.some(x => m.test(x)), String(m))
})

test('a ticket with no mark takes the configured side; marked tickets keep theirs', () => {
  const cfg = { adapter: 'fullstack', sides: { default: 'backend' } }
  assert.equal(ticketSide(cfg, { summary: 'No prefix', labels: [] }), 'backend')
  assert.equal(ticketSide(cfg, { summary: '[FE] Screen', labels: [] }), 'frontend')
  assert.equal(ticketSide({ adapter: 'fullstack' }, { summary: 'No prefix' }), null)
})

import { colocatedProposal, write as writeSetup } from '../../bin/setup.mjs'
import { readFileSync } from 'node:fs'
import { main as ticketMain } from '../../bin/ticket.mjs'
import { rootsOf } from '../../lib/base/config.mjs'
import { introSignal } from '../../lib/ticket/rubrics/shared.mjs'
import vitestRubric from '../../lib/ticket/rubrics/vitest.mjs'
import { scoreTicket } from '../../lib/ticket/score.mjs'

function tree(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-pilot-'))
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return d
}

test('setup: tests beside the code are proposed, and the write wires the layer and the allowed names in one step', () => {
  const d = tree({ 'package.json': '{"devDependencies":{"vitest":"1"}}', 'src/a/A.unit.test.jsx': 'x', 'src/b/B.unit.test.jsx': 'x', 'src/c.js': 'x' })
  const p = colocatedProposal(d)
  assert.deepEqual(p.layer, { name: 'unit', folder: 'src/' })
  assert.deepEqual(p.allow, ['src/**/*.unit.test.jsx'])
  assert.equal(colocatedProposal(tree({ 'test/a.spec.ts': 'x', 'src/a.ts': 'x' })), null)
  const r = writeSetup(d, { version: 1, adapter: 'vitest', jira }, { colocated: true })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const cfg = JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'))
  assert.deepEqual(cfg.vitest.layers, [{ name: 'unit', folder: 'src/' }])
  assert.deepEqual(cfg.boundaries.allow, ['src/**/*.unit.test.jsx'])
  assert.equal(writeSetup(tree({ 'test/a.spec.ts': 'x' }), { version: 1, adapter: 'vitest', jira }, { colocated: true }).ok, false)
})

test('the top of a workspaces monorepo proposes a workspace as the root, not adapter vitest with runner node', async () => {
  const { detect } = await import('../../bin/setup.mjs')
  const d = tree({ 'package.json': '{"workspaces":["app","be"]}', 'app/package.json': '{"devDependencies":{"vitest":"1"}}', 'be/package.json': '{}' })
  assert.equal(detect(d).root.proposed, 'app')
  const plain = tree({ 'package.json': '{"devDependencies":{"vitest":"1"}}', 'app/package.json': '{}' })
  assert.equal(detect(plain).root.proposed, null)
})

test('roots: one config, several projects; the active one is picked per person, and only a listed folder counts', () => {
  const home = tree({ '.claude/quality-code.json': JSON.stringify({ version: 1, root: 'app', roots: ['app', 'be'], adapter: 'vitest', jira }), 'app/x': '1', 'be/x': '1' })
  const claude = mkdtempSync(join(tmpdir(), 'qc-claude-'))
  const env = { CLAUDE_PROJECT_DIR: home, CLAUDE_CONFIG_DIR: claude }
  const run = (...argv) => { let out = '', err = ''; const logs = []; const o = process.stdout.write.bind(process.stdout); const e = process.stderr.write.bind(process.stderr); process.stdout.write = s => { out += s; return true }; process.stderr.write = s => { err += s; return true }; let code; try { code = ticketMain(argv, env, home) } finally { process.stdout.write = o; process.stderr.write = e } return { code, out, err } }
  assert.equal(rootsOf(home, env).active, 'app')
  const set = run('root', 'set', 'be')
  assert.equal(set.code, 0, set.err)
  assert.equal(rootsOf(home, env).active, 'be')
  assert.equal(run('root', 'set', 'other').code, 2, 'a folder the config does not list')
  assert.match(run('root', 'get').out, /ROOT_JSON:.*"active":"be"/)
  assert.equal(run('root', 'set', 'app').code, 0)
  assert.equal(rootsOf(home, env).active, 'app')
  const none = tree({ '.claude/quality-code.json': JSON.stringify({ version: 1, adapter: 'vitest', jira }) })
  assert.deepEqual(rootsOf(none, env).roots, [])
})

test('gate: items a project omits never count against a ticket, and the intro paragraph can be the Context', () => {
  const v = buildVocabulary(['en', 'it'])
  const intro = 'This story lets the accounting team send a variation file for a document that was already submitted with a wrong tax id, so that the tax authority receives the corrected data.\n\n## Acceptance Criteria\n- Given a paid document, when the user rectifies it, then the dialog shows "Reinvio".'
  assert.equal(introSignal(intro), true)
  assert.equal(introSignal('## Acceptance Criteria\n- x'), false)
  assert.equal(introSignal('Short.\n\n## AC'), false)
  const ticket = { summary: 'S', issuetype: 'Story', labels: [], text: { description: intro }, attachments: 0, links: [] }
  const base = { version: 1, adapter: 'vitest', jira }
  const sig = (config) => vitestRubric.deriveSignals(v, config, ticket)
  assert.equal(sig(base).context, false)
  assert.equal(sig({ ...base, gate: { contextFromIntro: true } }).context, true)
  const omitted = c => vitestRubric.omitted(c)
  assert.equal(omitted(base).has('attachments'), false)
  assert.equal(omitted({ ...base, gate: { omit: ['attachments'] } }).has('attachments'), true)
  const signals = { ac_present: true, ac_testable: true, expected_defined: true, steps: true, links: true, context: true }
  const s0 = scoreTicket(vitestRubric, signals, omitted(base))
  const s1 = scoreTicket(vitestRubric, signals, omitted({ ...base, gate: { omit: ['attachments'] } }))
  assert.ok(s1.score > s0.score, `${s1.score} > ${s0.score}`)
  assert.ok(!s1.missing.some(m => m.key === 'attachments'))
  assert.equal(validateConfig({ ...base, gate: { omit: ['title_prefix'] } }).ok, false)
  assert.equal(validateConfig({ ...base, gate: { omit: ['attachments'], contextFromIntro: true } }).ok, true)
})
