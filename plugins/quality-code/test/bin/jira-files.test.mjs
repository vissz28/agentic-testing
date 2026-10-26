// The Jira files connector (AGT-117, AGT-121): the only sites the token goes to, what it reads and
// skips, its limits, and the MCP tool. A fake fetch stands in for Jira Cloud.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handler, jiraClient, jiraOrigin, toContent, TOOLS } from '../../bin/jira-files.mjs'

const SITE = 'https://example.atlassian.net'
const DOCX = readFileSync(new URL('../fixtures/analysis.docx', import.meta.url))
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const att = (id, filename, mimeType, size = 100) => ({ id: String(id), filename, mimeType, size })

/** A fake Jira: the ticket's attachment list, and each attachment's bytes by id. */
function fakeJira(attachments, bytes = {}, { status = 200 } = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization })
    if (status !== 200) return { ok: false, status }
    const m = url.match(/\/attachment\/content\/(\d+)$/)
    const body = m ? bytes[m[1]] : null
    return { ok: true, status: 200, json: async () => ({ fields: { attachment: attachments } }), arrayBuffer: async () => body }
  }
  return { fetch, calls }
}
const client = fake => jiraClient({ email: 'me@example.com', token: 'tok', fetch: fake.fetch })

test('jiraOrigin: an https *.atlassian.net site only, path and trailing slash dropped', () => {
  for (const s of [SITE, `${SITE}/`, `${SITE}/jira/software`, ` ${SITE} `]) assert.equal(jiraOrigin(s), SITE, s)
  for (const bad of ['http://example.atlassian.net', 'https://example.atlassian.net.evil.com', 'https://evil.com/example.atlassian.net', 'https://u:p@example.atlassian.net', 'https://example.atlassian.net:8443', 'https://atlassian.net', 'example.atlassian.net', '', null])
    assert.equal(jiraOrigin(bad), null, String(bad))
})
test('a bad site, key or kind is refused before anything is sent: the token never leaves', async () => {
  const fake = fakeJira([])
  await assert.rejects(client(fake).ticketFiles('https://evil.com', 'ABC-1', 'docx'), /site must be your Jira Cloud address/)
  await assert.rejects(client(fake).ticketFiles(SITE, 'abc', 'docx'), /not a Jira key/)
  await assert.rejects(client(fake).ticketFiles(SITE, 'ABC-1', 'pdf'), /kind must be/)
  await assert.rejects(jiraClient({ email: '', token: 'tok', fetch: fake.fetch }).ticketFiles(SITE, 'ABC-1', 'docx'), /set jira_email/)
  assert.equal(fake.calls.length, 0)
})
test('docx: the Word files as text, with Basic sign-in on the site; other files skipped by name, images left out', async () => {
  const fake = fakeJira([att(1, 'analisi.docx', 'application/octet-stream'), att(2, 'logs.zip', 'application/zip'), att(3, 'shot.png', 'image/png')], { 1: DOCX })
  const r = await client(fake).ticketFiles(SITE, 'ABC-1', 'docx')
  assert.equal(r.read.length, 1)
  assert.match(r.read[0].text, /^Analisi funzionale: Trova posizione\n/)
  assert.deepEqual(r.skipped, [{ name: 'logs.zip', why: 'not a .docx' }])
  assert.deepEqual(fake.calls.map(c => c.url), [`${SITE}/rest/api/3/issue/ABC-1?fields=attachment`, `${SITE}/rest/api/3/attachment/content/1`])
  assert.ok(fake.calls.every(c => c.auth === `Basic ${Buffer.from('me@example.com:tok').toString('base64')}`))
})
test('images: at most 3, each over 5 MB skipped without a download; a broken .docx is skipped with why', async () => {
  const imgs = [1, 2, 3, 4].map(i => att(i, `s${i}.png`, 'image/png'))
  const fake = fakeJira([att(9, 'big.jpg', 'image/jpeg', 6 * 1024 * 1024), ...imgs], { 1: PNG, 2: PNG, 3: PNG, 4: PNG })
  const r = await client(fake).ticketFiles(SITE, 'ABC-1', 'images')
  assert.equal(r.read.length, 3)
  assert.deepEqual(r.skipped, [{ name: 'big.jpg', why: 'over 5 MB' }, { name: 's4.png', why: 'more than 3 files' }])
  assert.ok(!fake.calls.some(c => c.url.endsWith('/content/9')), 'the big file is never downloaded')
  const bad = fakeJira([att(5, 'x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], { 5: Buffer.from('not a zip') })
  assert.deepEqual((await client(bad).ticketFiles(SITE, 'ABC-1', 'docx')).skipped, [{ name: 'x.docx', why: 'not a .docx (no zip directory)' }])
})
test('Jira errors: a 401 names the settings to check; a 404 says the ticket is missing or hidden', async () => {
  await assert.rejects(client(fakeJira([], {}, { status: 401 })).ticketFiles(SITE, 'ABC-1', 'docx'), /jira_email and jira_api_token/)
  await assert.rejects(client(fakeJira([], {}, { status: 404 })).ticketFiles(SITE, 'ABC-1', 'docx'), /404 for ABC-1/)
})
test('the tool: one read-only tool; images come back as image parts after one text part', async () => {
  assert.deepEqual(TOOLS.map(t => t.name), ['get_ticket_files'])
  assert.match(TOOLS[0].description, /Read-only/)
  assert.deepEqual(toContent({ kind: 'images', read: [{ image: 'AAA', mimeType: 'image/png' }], skipped: [] }),
    [{ type: 'text', text: '{"images":1,"skipped":[]}' }, { type: 'image', data: 'AAA', mimeType: 'image/png' }])
  const h = handler(client(fakeJira([att(1, 'a.docx', 'application/octet-stream')], { 1: DOCX })))
  assert.deepEqual((await h({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools, TOOLS)
  const ok = await h({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_ticket_files', arguments: { site: SITE, key: 'ABC-1', kind: 'docx' } } })
  assert.match(JSON.parse(ok.result.content[0].text).docx[0].text, /Trova posizione/)
  const err = await h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_ticket_files', arguments: { site: 'https://evil.com', key: 'ABC-1', kind: 'docx' } } })
  assert.equal(err.result.isError, true)
  assert.equal((await h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602)
})
