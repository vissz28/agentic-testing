// The attachments and links signals (spec 2026-10-22 §3): weights, scoring, sanitize, fill-in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig } from '../../lib/base/config.mjs'
import { buildBrief } from '../../lib/ticket/score.mjs'
import { sanitizeTicket } from '../../lib/ticket/sanitize.mjs'
import { applyAnswer, fillMenu, formatFillMenu } from '../../lib/ticket/fill.mjs'
import playwright from '../../lib/ticket/rubrics/playwright.mjs'
import vitest from '../../lib/ticket/rubrics/vitest.mjs'

const raw = (adapter, extra = {}) => ({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en', 'it'],
  features: [{ label: 'Orders', route: '/orders', qaPlanSearch: 'orders' }],
  titlePrefixes: ['FE', 'BE', 'FS'],
  ...extra,
})
const cfg = (adapter, extra) => validateConfig(raw(adapter, extra)).config
const FE = cfg('playwright')
const BE = cfg('vitest')
const total = r => Object.values(r.weights).reduce((n, [w]) => n + w, 0)
const bare = { key: 'DEMO-1', summary: 'order filter wrong', issuetype: 'Bug', labels: [], text: { description: 'The order filter is wrong.' } }
const id = 'U' + '123456'
const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname

test('each rubric sums to 100 and carries the new weights', () => {
  assert.equal(total(playwright), 100)
  assert.equal(total(vitest), 100)
  assert.deepEqual([playwright.weights.attachments[0], playwright.weights.links[0]], [10, 5])
  assert.deepEqual([vitest.weights.attachments[0], vitest.weights.links[0]], [10, 5])
  assert.deepEqual(Object.entries(playwright.weights).map(([k, [w]]) => `${k}:${w}`),
    ['ac_present:25', 'ac_testable:15', 'steps:10', 'expected_defined:10', 'attachments:10', 'links:5', 'feature_label:10', 'qa_plan_found:10', 'environment:5'])
  assert.deepEqual(Object.entries(vitest.weights).map(([k, [w]]) => `${k}:${w}`),
    ['ac_present:25', 'ac_testable:15', 'steps:10', 'expected_defined:15', 'attachments:10', 'links:5', 'context:5', 'title_prefix:5', 'feature_label:5', 'environment:5'])
})

test('omitted keys still drop out of the missing list', () => {
  const b = buildBrief(cfg('vitest', { features: [], titlePrefixes: [] }), bare)
  assert.ok(!b.missing.some(m => ['feature_label', 'title_prefix'].includes(m.key)))
  assert.equal(b.missing.reduce((n, m) => n + m.weight, 0), 100 - 5 - 5, 'the unreachable 10 are not asked for')
  const p = buildBrief(cfg('playwright', { features: [] }), bare)
  assert.ok(!p.missing.some(m => ['feature_label', 'qa_plan_found'].includes(m.key)))
  assert.equal(p.missing.reduce((n, m) => n + m.weight, 0), 100 - 10 - 10, 'no feature means no QA-plan search either')
})

test('attachments: credited with at least one attachment, on both rubrics', () => {
  for (const c of [FE, BE]) {
    const none = buildBrief(c, bare)
    assert.equal(none.signals.attachments, false)
    assert.ok(none.missing.some(m => m.key === 'attachments' && m.weight === 10))
    for (const n of [0, '0', null, undefined, -1, 'x']) assert.equal(buildBrief(c, { ...bare, attachments: n }).signals.attachments, false, String(n))
    const one = buildBrief(c, { ...bare, attachments: 1 })
    assert.equal(one.signals.attachments, true)
    assert.equal(one.score - none.score, 10)
    assert.ok(!one.missing.some(m => m.key === 'attachments'))
  }
})

test('links: a linked issue or a web link credits 5; none does not', () => {
  for (const c of [FE, BE]) {
    const none = buildBrief(c, bare)
    assert.equal(none.signals.links, false)
    assert.equal(buildBrief(c, { ...bare, links: [] }).signals.links, false)
    const one = buildBrief(c, { ...bare, links: [{ url: 'https://example.atlassian.net/browse/DEMO-2', title: 'DEMO-2' }] })
    assert.equal(one.signals.links, true)
    assert.equal(one.score - none.score, 5)
  }
})

test('links: a ## Links line with a URL in the description counts, a bare word does not', () => {
  const withLine = { ...bare, text: { description: 'x\n\n## Links\nhttps://www.figma.com/design/abc/Orders' } }
  assert.equal(buildBrief(BE, withLine).signals.links, true)
  assert.equal(buildBrief(BE, { ...bare, text: { description: '## Links\nnone yet' } }).signals.links, false)
  assert.equal(buildBrief(BE, { ...bare, text: { description: 'see https://x.test/a' } }).signals.links, false, 'a URL elsewhere is not a Links section')
})

test('sanitize keeps the attachment count and the links (url and title), redacted', () => {
  const c = cfg('vitest', { redact: { customerId: 'U\\d{6}' } })
  const t = sanitizeTicket(c, {
    key: 'DEMO-1', summary: 's', text: {},
    attachments: [{ filename: 'secret.png', content: 'https://x.test/secure/attachment/1/secret.png', size: 3 }, { filename: 'b.mp4' }],
    links: [
      { url: 'https://example.atlassian.net/browse/DEMO-2', title: `DEMO-2 for ${id} mail a.b@example.org` },
      { url: 'https://www.figma.com/design/abc/Orders', title: 'Orders design', extra: 'dropped' },
      { url: 'javascript:alert(1)', title: 'no' },
      { title: 'no url' },
      'https://confluence.test/wiki/x',
    ],
  })
  assert.equal(t.attachments, 2)
  assert.deepEqual(t.links, [
    { url: 'https://example.atlassian.net/browse/DEMO-2', title: 'DEMO-2 for U###### mail user@example.test' },
    { url: 'https://www.figma.com/design/abc/Orders', title: 'Orders design' },
    { url: 'https://confluence.test/wiki/x', title: '' },
  ])
  assert.ok(!JSON.stringify(t).includes('secret.png'), 'no file names or attachment URLs')
  assert.equal(sanitizeTicket(c, { attachments: 3 }).attachments, 3)
  assert.equal(sanitizeTicket(c, { attachments: 'many' }).attachments, 0)
  assert.ok(!('attachments' in sanitizeTicket(c, { key: 'DEMO-1' })), 'absent stays absent')
  assert.ok(!('links' in sanitizeTicket(c, { key: 'DEMO-1' })))
})

test('fill menu offers attachments and links with their gains', () => {
  for (const c of [FE, BE]) {
    const menu = fillMenu(c, buildBrief(c, bare))
    const a = menu.items.find(i => i.key === 'attachments')
    const l = menu.items.find(i => i.key === 'links')
    assert.equal(a.gain, 10)
    assert.equal(l.gain, 5)
    assert.match(a.question, /Attach a screenshot, a video or a file on the Jira ticket/)
    assert.match(a.question, /done/)
    assert.match(l.question, /web address/)
    assert.match(formatFillMenu(menu), /Attachment\s+\+10/)
    assert.match(formatFillMenu(menu), /Link\s+\+5/)
  }
})

test('fill-in links: a valid http(s) URL is appended as a ## Links line and credited', () => {
  for (const c of [FE, BE]) {
    const r = applyAnswer(c, bare, 'links', 'https://www.figma.com/design/abc/Orders')
    assert.ok(r.ok, r.reason)
    assert.ok(r.input.text.description.endsWith('## Links\nhttps://www.figma.com/design/abc/Orders'))
    assert.deepEqual(r.input.filled, [{ key: 'links', section: '## Links\nhttps://www.figma.com/design/abc/Orders' }])
    assert.equal(r.brief.signals.links, true)
    assert.equal(r.brief.score, buildBrief(c, bare).score + 5)
  }
})

test('fill-in links: anything that is not one http(s) URL is rejected and nothing is written', () => {
  for (const bad of ['figma', 'ftp://x.test/a', 'javascript:alert(1)', 'https://', 'see https://x.test/a', 'https://a.test\nhttps://b.test', 'www.figma.com/x']) {
    const r = applyAnswer(BE, bare, 'links', bad)
    assert.equal(r.ok, false, bad)
    assert.equal(r.input, bare)
  }
})

test('fill-in attachments: "done" is never credited by itself; it waits for the ticket to be read again', () => {
  for (const c of [FE, BE]) {
    for (const answer of ['done', 'Done', 'fatto', 'ok']) {
      const r = applyAnswer(c, bare, 'attachments', answer)
      assert.equal(r.ok, false)
      assert.equal(r.input, bare, 'ticket untouched')
      assert.equal(!!r.pending, answer !== 'ok')
    }
    assert.match(applyAnswer(c, bare, 'attachments', 'done').reason, /read again/)
    assert.match(applyAnswer(c, bare, 'attachments', 'x').reason, /Attach a screenshot, a video or a file on the Jira ticket/)
  }
})

test('cli: add attachments done is pending; attachments <count> saves the count and re-scores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-att-'))
  try {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/quality-code.json'), JSON.stringify(raw('vitest')))
    writeFileSync(join(dir, 'ticket.json'), JSON.stringify(bare))
    const run = argv => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, QC_NO_AUDIT: '1' }, encoding: 'utf8' })
    const add = run(['add', '--in', '@ticket.json', 'attachments', 'done'])
    assert.equal(add.status, 1)
    assert.match(add.stdout, /Not counted yet/)
    assert.doesNotMatch(add.stdout, /Not accepted/)
    assert.match(add.stdout, /FILL_JSON:.*"pending":true/)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'ticket.json'), 'utf8')), bare)
    const before = JSON.parse(run(['score', '--in', '@ticket.json', '--json']).stdout).score
    const re = run(['attachments', '--in', '@ticket.json', '2'])
    assert.equal(re.status, 0)
    assert.match(re.stdout, /The ticket has 2 attachments: /)
    assert.equal(JSON.parse(readFileSync(join(dir, 'ticket.json'), 'utf8')).attachments, 2)
    assert.equal(JSON.parse(run(['score', '--in', '@ticket.json', '--json']).stdout).score, before + 10)
    assert.equal(run(['attachments', '--in', '@ticket.json', 'x']).status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
