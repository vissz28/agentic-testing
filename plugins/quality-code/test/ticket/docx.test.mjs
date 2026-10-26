// A ticket's .docx analysis read with node:zlib alone (AGT-117): the body's text, capped, and a clear
// error for anything that is not a Word file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import { docxText, unzipEntry } from '../../lib/ticket/docx.mjs'

const SAMPLE = new URL('../fixtures/analysis.docx', import.meta.url)
const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname

test('the sample analysis: paragraphs, a tab, a line break, table cells and entities; a tab stop is not a tab', () => {
  assert.deepEqual(docxText(readFileSync(SAMPLE)), {
    text: 'Analisi funzionale: Trova posizione\nIl pulsante apre il drawer & mostra il timbro.\nDefault\tx=0, y=0\nin alto a sinistra\nCampo\nValore\nCittà: é <ok>',
    truncated: false,
  })
})
test('long text is cut at maxChars and says so', () => {
  const r = docxText(readFileSync(SAMPLE), { maxChars: 10 })
  assert.deepEqual(r, { text: 'Analisi fu', truncated: true })
})
test('a stored entry is read as well as a deflated one; a missing entry is null', () => {
  const buf = readFileSync(SAMPLE)
  assert.match(unzipEntry(buf, '[Content_Types].xml').toString(), /^<\?xml/)
  assert.equal(unzipEntry(buf, 'word/nothing.xml'), null)
})
test('what is not a .docx says so and never throws a raw buffer error', () => {
  assert.throws(() => docxText(Buffer.from('PK not really a zip')), /not a \.docx/)
  assert.throws(() => docxText(Buffer.alloc(0)), /not a \.docx/)
  const buf = readFileSync(SAMPLE)
  assert.throws(() => docxText(buf.subarray(0, buf.length - 30)), /not a \.docx/)
})
test('an unzipped body over the cap is refused (a zip bomb)', () => {
  // One stored-in-a-zip document.xml whose deflated data expands past 20 MB.
  const data = deflateRawSync(Buffer.alloc(21 * 1024 * 1024, 0x20))
  const name = Buffer.from('word/document.xml')
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(name.length, 28)
  const dirAt = 30 + name.length + data.length
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(dirAt, 16)
  assert.throws(() => docxText(Buffer.concat([local, name, data, central, name, end])), /too large/)
})
test('cli: ticket.mjs docx prints the text of a file the user names; a missing file or no path exits 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-docx-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null } }))
  const run = (...argv) => spawnSync('node', [CLI, ...argv], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
  const ok = run('docx', SAMPLE.pathname)
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^DOCX_JSON:\{"text":"Analisi funzionale: Trova posizione\\n/m)
  const gone = run('docx', join(d, 'gone.docx'))
  assert.equal(gone.status, 2)
  assert.match(gone.stderr, /gone\.docx: no such file/)
  assert.equal(run('docx').status, 2)
})
test('an analysis added as ticket-eval says is redacted and scored like the description (AGT-117)', async () => {
  const { validateConfig } = await import('../../lib/base/config.mjs')
  const { sanitizeTicket } = await import('../../lib/ticket/sanitize.mjs')
  const { buildBrief } = await import('../../lib/ticket/score.mjs')
  const c = validateConfig({ version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null } }).config
  const id = 'U' + '123456'
  const analysis = `Scenario: stamp position\nGiven the stamp of customer ${id}\nWhen the user confirms the position\nThen the main page shows x=10 and y=20`
  const raw = { key: 'ABC-1', issuetype: 'Story', summary: 'Find position', text: { description: `Develop the prototype defined in the analysis.\n\n## Attached analysis 1\n${analysis}`, acField: '' } }
  const before = buildBrief(c, { ...raw, text: { description: 'Develop the prototype defined in the analysis.' } })
  const t = sanitizeTicket(c, raw)
  assert.ok(!t.text.description.includes(id))
  assert.match(t.text.description, /## Attached analysis 1\nScenario: stamp position/)
  const after = buildBrief(c, t)
  assert.equal(before.signals.ac_present, false)
  assert.equal(after.signals.ac_present, true)
  assert.ok(after.score > before.score)
})
