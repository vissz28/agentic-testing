// The Figma fill-in: the script finds the links and marks what a design can answer; the command drafts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESIGN_ITEMS, figmaLinks } from '../lib/ticket/fill.mjs'
import playwright from '../lib/ticket/rubrics/playwright.mjs'
import vitest from '../lib/ticket/rubrics/vitest.mjs'

const CLI = new URL('../bin/ticket.mjs', import.meta.url).pathname
const F = 'https://www.figma.com'

test('figmaLinks: every shape (design, file, proto, board), with a node id', () => {
  const t = { links: [
    { url: `${F}/design/abc/Orders?node-id=1-2`, title: 'd' },
    { url: `${F}/file/def/Old` }, { url: `${F}/proto/ghi/P?node-id=3-4`, title: '' }, { url: `${F}/board/jkl/Jam`, title: '' },
  ] }
  assert.deepEqual(figmaLinks(t), [`${F}/design/abc/Orders?node-id=1-2`, `${F}/file/def/Old`, `${F}/proto/ghi/P?node-id=3-4`, `${F}/board/jkl/Jam`])
})
test('figmaLinks: found in the description, the criteria field and the figma field', () => {
  const t = { text: { description: `See [the design](${F}/design/abc/A). Also ${F}/file/def/B.`, acField: `${F}/board/x/C` }, figma: `${F}/proto/p/D` }
  assert.deepEqual(figmaLinks(t), [`${F}/design/abc/A`, `${F}/file/def/B`, `${F}/board/x/C`, `${F}/proto/p/D`])
})
test('figmaLinks: trailing punctuation is not part of the URL', () => {
  assert.deepEqual(figmaLinks({ text: { description: `Design: ${F}/design/abc/A, and more.` } }), [`${F}/design/abc/A`])
})
test('figmaLinks: other links and other Figma pages are ignored', () => {
  const t = { links: [
    { url: 'https://example.atlassian.net/browse/DEMO-2' }, { url: 'https://acme.atlassian.net/wiki/spaces/X' },
    { url: `${F}/community/file/1` }, { url: 'https://notfigma.com/design/abc' }, { url: 'https://figma.com.evil.io/design/abc' },
    { url: `ftp://www.figma.com/design/abc/A` }, { url: 'javascript:figma.com/design/abc' },
  ], text: { description: 'no design here' } }
  assert.deepEqual(figmaLinks(t), [])
})
test('figmaLinks: http and https both pass; a bare host without a scheme does not', () => {
  assert.deepEqual(figmaLinks({ links: [{ url: 'http://figma.com/design/a/B' }, { url: 'figma.com/design/c/D' }] }), ['http://figma.com/design/a/B'])
})
test('figmaLinks: duplicates are listed once, across sources', () => {
  const u = `${F}/design/abc/A`
  assert.deepEqual(figmaLinks({ links: [{ url: u }, { url: u }], text: { description: u }, figma: u }), [u])
})
test('figmaLinks: at most 5', () => {
  const links = Array.from({ length: 8 }, (_, i) => ({ url: `${F}/design/k${i}/N` }))
  assert.deepEqual(figmaLinks({ links }), links.slice(0, 5).map(l => l.url))
})
test('figmaLinks: none, and odd input', () => {
  for (const t of [{}, null, undefined, { links: 'x', text: null, figma: 5 }, { links: [null, 3, {}] }]) assert.deepEqual(figmaLinks(t), [])
})

test('the design items are exactly acceptance criteria, expected behaviour and steps, and are real rubric keys', () => {
  assert.deepEqual([...DESIGN_ITEMS].sort(), ['ac_present', 'ac_testable', 'expected_defined', 'steps'])
  for (const r of [playwright, vitest]) for (const k of DESIGN_ITEMS) assert.ok(Object.hasOwn(r.weights, k), `${r.id} has ${k}`)
})

function menu(ticket, adapter = 'vitest') {
  const d = mkdtempSync(join(tmpdir(), 'fg-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter, jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [{ label: 'Orders', route: '/orders' }] }))
  writeFileSync(join(d, 't.json'), JSON.stringify(ticket))
  const r = spawnSync('node', [CLI, 'fill-menu', '--in', '@t.json'], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.match(/^FILL_JSON:(.*)$/m)[1])
}
const bare = { key: 'DEMO-1', issuetype: 'Story', summary: 's', labels: [], text: { description: 'Orders screen.' } }

test('FILL_JSON carries the figma list, empty when the ticket has none', () => {
  assert.deepEqual(menu(bare).figma, [])
  const j = menu({ ...bare, links: [{ url: `${F}/design/abc/A?node-id=1-2`, title: '' }], text: { description: `x ${F}/file/z/Z` } })
  assert.deepEqual(j.figma, [`${F}/design/abc/A?node-id=1-2`, `${F}/file/z/Z`])
})
test('FILL_JSON marks only the design-answerable items', () => {
  for (const adapter of ['vitest', 'playwright']) {
    const j = menu(bare, adapter)
    assert.ok(j.items.some(i => i.design), `${adapter}: some item is marked`)
    for (const i of j.items) assert.equal(Boolean(i.design), DESIGN_ITEMS.includes(i.key), `${adapter} ${i.key}`)
    for (const k of ['attachments', 'links', 'context']) {
      const it = j.items.find(i => i.key === k)
      if (it) assert.equal(it.design, undefined)
    }
  }
})
