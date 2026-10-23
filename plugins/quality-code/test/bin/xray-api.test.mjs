// The Xray connector: the API address it may send the key to, the GraphQL it sends, paging, a new
// sign-in after a 401, and the MCP tools. A fake fetch stands in for Xray Cloud.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_XRAY_API, saveXraySettings, xrayApiUrlOf } from '../../bin/connector-settings.mjs'
import { handler, shapeRun, TOOLS, xrayClient } from '../../bin/xray-api.mjs'

/** A fake Xray: answers sign-in with a token and each GraphQL call from `answers` in turn. */
function fakeXray(answers, { signIn = [200] } = {}) {
  const calls = []
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, auth: init.headers.Authorization, body })
    if (url.endsWith('/api/v2/authenticate')) return json(signIn.shift() ?? 200, `tok${calls.length}`)
    const a = answers.shift()
    return typeof a === 'number' ? json(a, {}) : json(200, a)
  }
  return { fetch, calls }
}
const run = (id, key, status = 'TO DO') => ({
  id, status: { name: status }, defects: [],
  test: { jira: { key, summary: `${key} summary` }, testType: { name: 'Manual' } },
  steps: [{ id: `${id}-1`, action: 'Open Timesheet', data: 'week 18', result: 'The week loads', status: { name: 'TO DO' } }],
})
const execPage = (runs, total) => ({ data: { getTestExecutions: { results: [{ jira: { key: 'ABC-1', summary: 'Filters' }, testRuns: { total, results: runs } }] } } })
const STATUSES = { data: { getStatuses: [{ name: 'PASSED', final: true }, { name: 'FAILED', final: true }, { name: 'TO DO', final: false }] } }

test('xrayApiUrlOf: the global or a regional Xray Cloud address, nothing else', () => {
  for (const a of ['https://xray.cloud.getxray.app', 'xray.cloud.getxray.app', 'https://xray.cloud.getxray.app/', ' https://xray.cloud.getxray.app '])
    assert.equal(xrayApiUrlOf(a), DEFAULT_XRAY_API, a)
  assert.equal(xrayApiUrlOf('https://eu.xray.cloud.getxray.app'), 'https://eu.xray.cloud.getxray.app')
  for (const bad of ['http://xray.cloud.getxray.app', 'https://xray.cloud.getxray.app.evil.com', 'https://evil.com/xray.cloud.getxray.app', 'https://u:p@xray.cloud.getxray.app', 'https://xray.cloud.getxray.app/api', 'https://xray.cloud.getxray.app:8443', ''])
    assert.equal(xrayApiUrlOf(bad), null, bad)
})
test('saveXraySettings: saves the address, refuses any other host', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'qc-xray-')), 'settings.json')
  assert.equal(saveXraySettings({ file: f, url: 'eu.xray.cloud.getxray.app' }).ok, true)
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).pluginConfigs['quality-code@teamsystem'].options.xray_api_url, 'https://eu.xray.cloud.getxray.app')
  assert.match(saveXraySettings({ file: f, url: 'https://example.com' }).reason, /not an Xray Cloud address/)
})

test('testRun: signs in once, reads every page of runs, then the statuses', async () => {
  const runs = Array.from({ length: 101 }, (_, i) => run(`r${i}`, `ABC-${i + 10}`))
  const x = fakeXray([execPage(runs.slice(0, 100), 101), execPage(runs.slice(100), 101), STATUSES])
  const r = await xrayClient({ id: 'id', secret: 's', fetch: x.fetch }).testRun('ABC-1')
  assert.equal(r.runs.length, 101)
  assert.deepEqual(r.statuses.map(s => s.name), ['PASSED', 'FAILED', 'TO DO'])
  assert.deepEqual(r.runs[0], shapeRun(runs[0]))
  assert.deepEqual(r.runs[0].steps[0], { id: 'r0-1', action: 'Open Timesheet', data: 'week 18', expected: 'The week loads', status: 'TO DO' })
  assert.equal(x.calls.filter(c => c.url.endsWith('/authenticate')).length, 1)
  assert.deepEqual(x.calls[0].body, { client_id: 'id', client_secret: 's' })
  assert.match(x.calls[1].body.query, /getTestExecutions\(jql: "key = \\"ABC-1\\"", limit: 1\)/)
  assert.match(x.calls[1].body.query, /testRuns\(limit: 100, start: 0\)/)
  assert.match(x.calls[2].body.query, /start: 100/)
  assert.equal(x.calls[1].auth, 'Bearer tok1')
  assert.ok(x.calls.every(c => c.url.startsWith(DEFAULT_XRAY_API)))
})
test('testRun: a key that is no test execution, and a bad key, are errors', async () => {
  const x = fakeXray([{ data: { getTestExecutions: { results: [] } } }])
  await assert.rejects(xrayClient({ id: 'i', secret: 's', fetch: x.fetch }).testRun('ABC-2'), /ABC-2 is not an Xray test execution/)
  await assert.rejects(xrayClient({ id: 'i', secret: 's', fetch: x.fetch }).testRun('abc" OR 1=1'), /not a Jira key/)
})
test('a 401 signs in again once; a refused sign-in names the settings to check', async () => {
  const x = fakeXray([401, execPage([], 0), STATUSES])
  assert.deepEqual((await xrayClient({ id: 'i', secret: 's', fetch: x.fetch }).testRun('ABC-1')).runs, [])
  assert.equal(x.calls.filter(c => c.url.endsWith('/authenticate')).length, 2)
  const y = fakeXray([], { signIn: [401] })
  await assert.rejects(xrayClient({ id: 'i', secret: 'bad', fetch: y.fetch }).testRun('ABC-1'), /xray_client_id and xray_client_secret/)
})
test('the key goes nowhere but Xray Cloud: another address fails before any call', async () => {
  const x = fakeXray([])
  await assert.rejects(xrayClient({ id: 'i', secret: 's', base: 'https://evil.example.com', fetch: x.fetch }).testRun('ABC-1'), /xray_api_url must be/)
  assert.equal(x.calls.length, 0)
})
test('GraphQL errors come back as one message', async () => {
  const x = fakeXray([{ errors: [{ message: 'no access' }, { message: 'bad field' }] }])
  await assert.rejects(xrayClient({ id: 'i', secret: 's', fetch: x.fetch }).testRun('ABC-1'), /Xray: no access; bad field/)
})
test('setStatus and addDefect send one mutation each, with checked values', async () => {
  const x = fakeXray([{ data: { updateTestRunStatus: null } }, { data: { addDefectsToTestRun: { addedDefects: ['10001'], warnings: ['already there'] } } }])
  const c = xrayClient({ id: 'i', secret: 's', base: 'https://eu.xray.cloud.getxray.app', fetch: x.fetch })
  assert.deepEqual(await c.setStatus('5acc7ab0a3fe1b6fcdc3c737', 'FAILED'), { ok: true, runId: '5acc7ab0a3fe1b6fcdc3c737', status: 'FAILED' })
  assert.equal(x.calls[1].body.query, 'mutation { updateTestRunStatus(id: "5acc7ab0a3fe1b6fcdc3c737", status: "FAILED") }')
  assert.deepEqual((await c.addDefect('5acc7ab0a3fe1b6fcdc3c737', 'ABC-9')).warnings, ['already there'])
  assert.match(x.calls[2].body.query, /addDefectsToTestRun\(id: "5acc7ab0a3fe1b6fcdc3c737", issues: \["ABC-9"\]\)/)
  assert.ok(x.calls.every(c => c.url.startsWith('https://eu.xray.cloud.getxray.app/')))
  for (const [id, s] of [['x") { a }', 'PASSED'], ['5acc', 'PASS"ED']]) await assert.rejects(c.setStatus(id, s))
  await assert.rejects(c.addDefect('5acc', 'not a key'), /not a Jira key/)
})

test('MCP: initialize and the three tools; a call answers JSON text, a failure isError, an unknown tool an error', async () => {
  const h = handler({ testRun: async key => ({ key, runs: [] }), setStatus: async () => { throw new Error('Xray answered 500') }, addDefect: async () => ({}) })
  assert.equal((await h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.serverInfo.name, 'quality-code-xray')
  assert.deepEqual((await h({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(t => t.name), ['get_test_run', 'set_test_run_status', 'add_defect_to_test_run'])
  const ok = await h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_test_run', arguments: { key: 'ABC-1' } } })
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { key: 'ABC-1', runs: [] })
  const bad = await h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'set_test_run_status', arguments: {} } })
  assert.equal(bad.result.isError, true)
  assert.equal(bad.result.content[0].text, 'Xray answered 500')
  for (const name of ['nope', 'toString']) assert.equal((await h({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name } })).error.code, -32602, name)
  assert.equal(await h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
})
test('the write tools say they need the tester\'s yes', () => {
  for (const t of TOOLS.filter(t => t.name !== 'get_test_run')) assert.match(t.description, /only after the tester said yes/)
  assert.match(TOOLS[0].description, /Read-only/)
})
