// jira-file.mjs: a ticket attachment from the connector's short-lived link. What it downloads from,
// what it reads, and where it saves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, MAX_IMAGES, MEDIA_HOST } from '../../bin/jira-file.mjs'

const DOCX = readFileSync(new URL('../fixtures/analysis.docx', import.meta.url))
const LINK = `https://${MEDIA_HOST}/file/abc/binary?token=t`
const proj = () => {
  const d = mkdtempSync(join(tmpdir(), 'jf-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify({ version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'] } }))
  return d
}
const serve = (body, { status = 200, length } = {}) => async () => ({ ok: status === 200, status, headers: new Headers(length ? { 'content-length': String(length) } : {}), arrayBuffer: async () => body })
async function run(d, argv, fetchImpl = serve(Buffer.from('png'))) {
  const lines = { out: [], err: [] }
  const code = await main(argv, { ...process.env, CLAUDE_PROJECT_DIR: d, QUALITY_CODE_PLACE: 'repo' }, '/', { fetchImpl, out: s => lines.out.push(s), err: s => lines.err.push(s) })
  return { code, out: lines.out.join('\n'), err: lines.err.join('\n') }
}

test('only a link to Atlassian\'s media address is downloaded, for a real key, and only images and .docx', async () => {
  const d = proj()
  let called = 0
  const spy = async () => { called++; return serve(Buffer.from('x'))() }
  for (const link of ['https://evil.example/file', `http://${MEDIA_HOST}/file`, `https://${MEDIA_HOST}.evil.example/file`, 'not a url']) {
    const r = await run(d, ['DEMO-1', link, 'a.png'], spy)
    assert.equal(r.code, 2, link)
    assert.match(r.err, /only a link to https:\/\/api\.media\.atlassian\.com is downloaded/)
  }
  assert.equal((await run(d, ['../x', LINK, 'a.png'], spy)).code, 2)
  assert.match((await run(d, ['DEMO-1', LINK, 'report.pdf'], spy)).err, /report\.pdf: only images and \.docx files are read/)
  assert.equal(called, 0, 'nothing was fetched')
})

test('an image is saved in the ticket\'s files folder, by number; the fourth is refused; done deletes the folder', async () => {
  const d = proj()
  const r = await run(d, ['DEMO-1', LINK, '../../Screenshot 1.PNG'])
  assert.equal(r.code, 0)
  const f = JSON.parse(r.out.slice('FILE_JSON:'.length))
  assert.equal(f.name, 'Screenshot 1.PNG')
  assert.equal(f.bytes, 3)
  assert.ok(f.path.endsWith(join('DEMO-1', 'files', '1.png')), f.path)
  assert.equal(readFileSync(f.path, 'utf8'), 'png')
  for (let i = 1; i < MAX_IMAGES; i++) assert.equal((await run(d, ['DEMO-1', LINK, 'b.jpg'])).code, 0)
  const more = await run(d, ['DEMO-1', LINK, 'c.png'])
  assert.equal(more.code, 2)
  assert.match(more.err, /3 images of DEMO-1 are read already/)
  assert.equal((await run(d, ['done', 'DEMO-1'])).out, 'ok')
  assert.ok(!existsSync(join(f.path, '..')))
})

test('a .docx is read as text and not saved; a file over 5 MB or a failed download is not read', async () => {
  const d = proj()
  const r = await run(d, ['DEMO-2', LINK, 'analysis.docx'], serve(DOCX))
  assert.equal(r.code, 0)
  assert.ok(JSON.parse(r.out.slice('DOCX_JSON:'.length)).text.length > 0)
  const big = await run(d, ['DEMO-2', LINK, 'a.png'], serve(Buffer.from('x'), { length: 6 * 1024 * 1024 }))
  assert.equal(big.code, 2)
  assert.match(big.err, /a\.png: over 5 MB, not read/)
  assert.match((await run(d, ['DEMO-2', LINK, 'a.png'], serve(Buffer.from(''), { status: 403 }))).err, /a\.png: HTTP 403/)
  assert.match((await run(d, ['DEMO-2', LINK, 'bad.docx'], serve(Buffer.from('not a zip')))).err, /bad\.docx: not a \.docx/)
})
