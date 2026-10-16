// Fullstack projects: one repo with Vitest (backend) and Playwright (frontend) tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig } from '../core/config.mjs'
import { buildBrief, formatReport } from '../core/score.mjs'
import { applyAnswer, fillMenu } from '../core/fill.mjs'
import { adapterOfSpec, adaptersOf, specsByAdapter, stackOf, ticketSide } from '../core/stack.mjs'
import { main } from '../core/cli.mjs'

const base = { version: 1, jira: { site: 'https://example.atlassian.net', projects: ['ABC'] }, features: [{ label: 'Orders', route: '/orders' }] }
const cfg = (extra = {}) => validateConfig({ ...base, adapter: 'fullstack', ...extra }).config
const DESC = '## Acceptance criteria\nScenario: total\nGiven an order of 3 items at 40.00 each\nWhen I open the order summary\nThen the total is 108.00\n## Context\nOrders get a volume discount.\n## Environment\nenv: staging'
const ticket = (summary, labels = ['Orders']) => ({ key: 'ABC-1', summary, issuetype: 'Story', labels, text: { description: DESC } })

test('the stack of a project: frontend, backend or fullstack', () => {
  assert.equal(stackOf(validateConfig({ ...base, adapter: 'playwright' }).config), 'frontend')
  assert.equal(stackOf(validateConfig({ ...base, adapter: 'vitest' }).config), 'backend')
  assert.equal(stackOf(cfg()), 'fullstack')
  assert.deepEqual(adaptersOf(cfg()), ['vitest', 'playwright'])
})

test('a ticket side from its title prefix or labels; FE and BE together are fullstack; unmarked is null', () => {
  const c = cfg()
  assert.equal(ticketSide(c, ticket('[FE] Orders total')), 'frontend')
  assert.equal(ticketSide(c, ticket('[be] Orders total')), 'backend')
  assert.equal(ticketSide(c, ticket('[FS] Orders total')), 'fullstack')
  assert.equal(ticketSide(c, ticket('Orders total', ['Orders', 'FE', 'BE'])), 'fullstack')
  assert.equal(ticketSide(c, ticket('Orders total')), null)
  const own = cfg({ sides: { frontend: ['web'], backend: ['api'] } })
  assert.equal(ticketSide(own, ticket('[api] Orders total')), 'backend')
  assert.equal(ticketSide(own, ticket('Orders total', ['web'])), 'frontend')
  assert.equal(ticketSide(own, ticket('[FE] Orders total')), null, 'configured sides replace the defaults')
})

test('a spec goes to Playwright in the e2e folder or under a Playwright config, else to Vitest', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-stack-'))
  const c = cfg({ playwright: { folder: 'e2e/tests/', configs: [{ match: 'apps/web/**', config: 'apps/web/pw.config.ts' }] } })
  assert.equal(adapterOfSpec(c, d, 'e2e/tests/orders.abc-1.spec.ts'), 'playwright')
  assert.equal(adapterOfSpec(c, d, 'apps/web/x.spec.ts'), 'playwright')
  assert.equal(adapterOfSpec(c, d, 'test/unit/pricing.abc-1.spec.ts'), 'vitest')
  assert.equal(adapterOfSpec(c, d, 'src/Orders.test.tsx'), 'vitest')
  assert.deepEqual(specsByAdapter(c, d, ['e2e/tests/a.spec.ts', 'test/b.spec.ts', 'test/c.spec.ts']), [['vitest', ['test/b.spec.ts', 'test/c.spec.ts']], ['playwright', ['e2e/tests/a.spec.ts']]])
  assert.deepEqual(specsByAdapter(c, d, ['test/b.spec.ts']), [['vitest', ['test/b.spec.ts']]], 'a side with no spec is left out')
  // With no folder set: the default e2e/.
  assert.equal(adapterOfSpec(cfg(), d, 'e2e/orders.spec.ts'), 'playwright')
  const single = validateConfig({ ...base, adapter: 'vitest' }).config
  assert.equal(adapterOfSpec(single, d, 'e2e/orders.spec.ts'), 'vitest', 'a one-adapter project never splits')
})

test('a frontend ticket is scored by the Playwright rubric, a backend one by Vitest, fullstack and unmarked by the lower', () => {
  const c = cfg({ titlePrefixes: ['FE', 'BE', 'FS'] })
  const fe = buildBrief(c, ticket('[FE] Orders total'))
  const be = buildBrief(c, ticket('[BE] Orders total'))
  assert.deepEqual([fe.rubric, fe.side, fe.sides], ['playwright', 'frontend', undefined])
  assert.deepEqual([be.rubric, be.side], ['vitest', 'backend'])
  const fs = buildBrief(c, ticket('[FS] Orders total'))
  assert.deepEqual(fs.sides, { backend: { score: be.score, gate: be.gate }, frontend: { score: fe.score, gate: fe.gate } })
  assert.equal(fs.score, Math.min(be.score, fe.score))
  assert.equal(buildBrief(c, ticket('Orders total')).side, null)
  // A side set on the ticket wins over its marks.
  assert.equal(buildBrief(c, { ...ticket('[FE] Orders total'), side: 'backend' }).rubric, 'vitest')
  assert.match(formatReport(fe), /\nSide: frontend: Playwright tests of a screen\n/)
  assert.match(formatReport(buildBrief(c, ticket('Orders total'))), /Side: not marked on the ticket, so scored for both/)
  // One-adapter projects keep their brief as it was.
  assert.ok(!('side' in buildBrief(validateConfig({ ...base, adapter: 'vitest' }).config, ticket('[BE] x'))))
})

test('fill-in on a fullstack ticket: the menu and the answer use the rubric that decided', () => {
  const c = cfg({ titlePrefixes: ['FE', 'BE', 'FS'] })
  // Backend side: Vitest rubric, so the context section is asked for and credited.
  const t = { key: 'ABC-2', summary: '[BE] Orders total', issuetype: 'Story', labels: [], text: { description: '## Acceptance criteria\nScenario: total\nGiven an order of 3 items\nWhen I open it\nThen the total is 108.00' } }
  const menu = fillMenu(c, buildBrief(c, t))
  assert.equal(menu.rubric, 'vitest')
  assert.ok(menu.items.some(i => i.key === 'context'))
  const r = applyAnswer(c, t, 'context', 'Orders of 100.00 or more get a 10% volume discount on the total.')
  assert.equal(r.ok, true, r.reason)
  // Unmarked: both sides; an answer the deciding rubric asks for is credited by that rubric.
  const u = { ...t, summary: 'Orders total' }
  const um = fillMenu(c, buildBrief(c, u))
  const key = um.items[0].key
  assert.ok(['vitest', 'playwright'].includes(um.rubric))
  assert.ok(key)
})

test('cli side: prints the side, saves a chosen one, refuses on a one-adapter project', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-side-'))
  mkdirSync(join(d, '.claude'))
  const write = adapter => writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ ...base, adapter }))
  write('fullstack')
  const file = join(d, 't.json')
  writeFileSync(file, JSON.stringify(ticket('[FE] Orders total')))
  const env = { CLAUDE_PROJECT_DIR: d, QC_NO_AUDIT: '1' }
  const lines = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = s => { lines.push(String(s)); return true }
  let codes
  try {
    codes = [main(['side', '--in', `@${file}`], env, d), main(['side', '--in', `@${file}`, 'fullstack'], env, d), main(['side', '--in', `@${file}`], env, d)]
  } finally { process.stdout.write = orig }
  assert.deepEqual(codes, [0, 0, 0])
  assert.ok(lines[0].includes('SIDE_JSON:{"side":"frontend","source":"ticket"}'), lines[0])
  assert.match(lines[1], /^ok: ABC-1 gets fullstack tests \(its title or labels say frontend\)/)
  assert.ok(lines[2].includes('SIDE_JSON:{"side":"fullstack","source":"set"}'))
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).side, 'fullstack')
  const errs = []
  const origErr = process.stderr.write.bind(process.stderr)
  process.stderr.write = s => { errs.push(String(s)); return true }
  try {
    assert.equal(main(['side', '--in', `@${file}`, 'mobile'], env, d), 2)
    write('vitest')
    assert.equal(main(['side', '--in', `@${file}`], env, d), 2)
  } finally { process.stderr.write = origErr }
  assert.match(errs.join(''), /side must be one of frontend, backend, fullstack/)
  assert.match(errs.join(''), /side is for fullstack projects: this one is vitest/)
})
