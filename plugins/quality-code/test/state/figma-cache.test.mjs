import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearFigma, getDesign, MAX_DESIGNS, MAX_TEXT_BYTES, parseFigmaUrl, setDesign, setLimited } from '../../lib/state/figma-cache.mjs'
import { listCache } from '../../lib/state/cache-clean.mjs'
import { main } from '../../bin/figma.mjs'

const env = () => ({ CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-figma-')) })
const project = () => mkdtempSync(join(tmpdir(), 'qc-proj-'))
const URL1 = 'https://www.figma.com/design/AbC123/Orders?node-id=12-345&t=x'
const DAY = 86400000

test('parseFigmaUrl: file key and node, a branch link reads the branch', () => {
  assert.deepEqual(parseFigmaUrl(URL1), { fileKey: 'AbC123', nodeId: '12:345' })
  assert.deepEqual(parseFigmaUrl('https://figma.com/design/AbC123/branch/Br9/Orders?node-id=1%3A2'), { fileKey: 'Br9', nodeId: '1:2' })
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/file/AbC123/Orders'), { fileKey: 'AbC123', nodeId: null })
  for (const bad of ['https://evil.com/design/AbC123/x', 'https://www.figma.com/community/file/1', 'not a url']) assert.equal(parseFigmaUrl(bad), null, bad)
})
test('a saved read-out comes back for the same node, from any link to it', () => {
  const e = env(), r = project()
  assert.equal(getDesign(r, URL1, e).found, false)
  assert.equal(setDesign(r, URL1, 'Frame Orders: columns Code, Qty', e).ok, true)
  const g = getDesign(r, 'https://www.figma.com/design/AbC123/Other-name?node-id=12-345', e)
  assert.deepEqual([g.found, g.text, g.limited], [true, 'Frame Orders: columns Code, Qty', false])
  assert.equal(getDesign(r, 'https://www.figma.com/design/AbC123/Orders?node-id=12-346', e).found, false)
})
test('a read-out older than 7 days is read again', () => {
  const e = env(), r = project(), t0 = Date.parse('2026-11-01T08:00:00Z')
  setDesign(r, URL1, 'x', e, t0)
  assert.equal(getDesign(r, URL1, e, t0 + 6 * DAY).found, true)
  assert.equal(getDesign(r, URL1, e, t0 + 8 * DAY).found, false)
})
test('refused: empty, too big, a secret, not a figma link', () => {
  const e = env(), r = project()
  assert.equal(setDesign(r, URL1, '  ', e).ok, false)
  assert.equal(setDesign(r, URL1, 'x'.repeat(MAX_TEXT_BYTES + 1), e).ok, false)
  assert.equal(setDesign(r, URL1, 'token glpat-abcdefghijklmnopqrst', e).ok, false)
  assert.equal(setDesign(r, 'https://example.com/x', 'x', e).ok, false)
})
test('the oldest designs go past the cap', () => {
  const e = env(), r = project(), t0 = Date.parse('2026-11-01T08:00:00Z')
  for (let i = 0; i <= MAX_DESIGNS; i++) setDesign(r, `https://www.figma.com/design/K/x?node-id=1-${i}`, `n${i}`, e, t0 + i * 1000)
  assert.equal(getDesign(r, 'https://www.figma.com/design/K/x?node-id=1-0', e, t0 + DAY).found, false)
  assert.equal(getDesign(r, `https://www.figma.com/design/K/x?node-id=1-${MAX_DESIGNS}`, e, t0 + DAY).found, true)
})
test('the limit holds for its hours, then lifts; clear forgets everything', () => {
  const e = env(), r = project(), t0 = Date.parse('2026-11-01T08:00:00Z')
  assert.equal(setLimited(r, 24, e, t0).ok, true)
  assert.equal(getDesign(r, URL1, e, t0 + DAY - 1000).limited, true)
  assert.equal(getDesign(r, URL1, e, t0 + DAY + 1000).limited, false)
  assert.equal(setLimited(r, 0, e).ok, false)
  setDesign(r, URL1, 'x', e)
  clearFigma(r, e)
  assert.equal(getDesign(r, URL1, e).found, false)
})
test('the cache sits in the project folder /clean --cache deletes', () => {
  const e = env(), r = project()
  setDesign(r, URL1, 'x', e)
  assert.equal(listCache(r, { env: e }).files, 1)
})
test('cli: set reads the file and deletes it, get reuses it, limited and clear', async () => {
  const e = env(), r = project(), out = []
  const io = { env: e, cwd: r, stdout: s => out.push(s), stderr: s => out.push(s) }
  const file = join(r, 'figma.txt')
  writeFileSync(file, 'Frame Orders')
  assert.equal(await main(['set', URL1, `@${file}`], io), 0)
  assert.equal(existsSync(file), false)
  out.length = 0
  assert.equal(await main(['get', URL1], io), 0)
  assert.match(out.join(''), /Reusing the design read .* \(no Figma call\)/)
  assert.match(out.join(''), /FIGMA_JSON:.*"text":"Frame Orders"/)
  assert.equal(await main(['limited', '--hours', '2'], io), 0)
  assert.equal(await main(['limited', '--hours', 'x'], io), 2)
  assert.equal(await main(['clear'], io), 0)
  out.length = 0
  assert.equal(await main(['get', URL1], io), 0)
  assert.match(out.join(''), /"found":false/)
  assert.equal(await main(['get', 'https://example.com'], io), 2)
  assert.equal(await main([], io), 2)
})
