#!/usr/bin/env node
// The Xray connector: a stdio MCP server over Xray Cloud's GraphQL API, for /quality-code:qa. It is
// started by bin/mcp-launch.mjs, only when the API key's secret is set (xray_client_id and
// xray_client_secret in the plugin settings); without it the launcher answers with no tools. The key
// comes from the environment .mcp.json fills from the keychain, goes only to the Xray API address,
// and is never printed. Five tools: read a test execution's runs (tests, steps, statuses), set a
// run's status, add a defect to a run, create manual tests, add tests to a test execution. The qa and
// xray commands ask the tester before each write.
//
//   node bin/mcp-launch.mjs xray -- node bin/xray-api.mjs
import { reply, serve, tokenSet } from './mcp-launch.mjs'
import { DEFAULT_XRAY_API, xrayApiUrlOf } from './connector-settings.mjs'
import { isMain } from '../lib/core/script-io.mjs'
import { isTicketKey } from '../lib/core/text.mjs'

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
const STATUS = /^[A-Za-z0-9 _-]{1,40}$/
const PROJECT = /^[A-Z][A-Z0-9_]*$/
const ISSUE_ID = /^\d{1,12}$/
const MAX_TESTS = 50
const MAX_STEPS = 40
const PAGE = 100 // the most testRuns Xray returns at once
const q = JSON.stringify // a GraphQL string literal, for values the patterns above already checked

const runsQuery = (key, start) => `{
  getTestExecutions(jql: ${q(`key = "${key}"`)}, limit: 1) {
    results {
      jira(fields: ["key", "summary"])
      testRuns(limit: ${PAGE}, start: ${start}) {
        total
        results {
          id
          status { name }
          defects
          test { jira(fields: ["key", "summary"]) testType { name } }
          steps { id action data result status { name } }
          unstructured
          gherkin
        }
      }
    }
  }
}`

/** One test run as the qa command reads it. */
export const shapeRun = r => ({
  id: r.id,
  status: r.status?.name ?? null,
  test: { key: r.test?.jira?.key ?? null, summary: r.test?.jira?.summary ?? null, type: r.test?.testType?.name ?? null },
  steps: (r.steps ?? []).map(s => ({ id: s.id, action: s.action ?? '', data: s.data ?? '', expected: s.result ?? '', status: s.status?.name ?? null })),
  definition: r.gherkin || r.unstructured || null,
  defects: r.defects ?? [],
})

/** The Xray Cloud client: signs in once, again after a 401 (the token lasts about a day). */
export function xrayClient({ id, secret, base, fetch = globalThis.fetch, timeoutMs = 30000, sleep = ms => new Promise(r => setTimeout(r, ms)), pollMs = 1500, polls = 40 }) {
  const api = xrayApiUrlOf(base || DEFAULT_XRAY_API)
  let token = null
  const post = (path, body, auth) => fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  async function signIn() {
    const r = await post('/api/v2/authenticate', { client_id: id, client_secret: secret })
    if (!r.ok) throw new Error(`Xray sign-in failed (${r.status}): check xray_client_id and xray_client_secret in /plugin, and xray_api_url`)
    token = await r.json()
  }
  /** An authenticated REST call (the import endpoints): signs in again after a 401, as gql does. */
  async function rest(method, path, body, retried = false) {
    if (!api) throw new Error('xray_api_url must be https://xray.cloud.getxray.app or a regional address like https://eu.xray.cloud.getxray.app')
    if (!token) await signIn()
    const r = await fetch(`${api}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (r.status === 401 && !retried) { token = null; return rest(method, path, body, true) }
    if (!r.ok) throw new Error(`Xray answered ${r.status}`)
    return r.json()
  }
  async function gql(query, retried = false) {
    if (!api) throw new Error('xray_api_url must be https://xray.cloud.getxray.app or a regional address like https://eu.xray.cloud.getxray.app')
    if (!token) await signIn()
    const r = await post('/api/v2/graphql', { query }, token)
    if (r.status === 401 && !retried) { token = null; return gql(query, true) }
    if (!r.ok) throw new Error(`Xray answered ${r.status}`)
    const body = await r.json()
    if (body.errors?.length) throw new Error(`Xray: ${body.errors.map(e => e.message).join('; ')}`)
    return body.data
  }
  return {
    async testRun(key) {
      if (!isTicketKey(key)) throw new Error(`not a Jira key: ${JSON.stringify(key)}`)
      const runs = []
      let exec
      for (let start = 0, total = 1; start < total; start += PAGE) {
        exec = (await gql(runsQuery(key, start))).getTestExecutions?.results?.[0]
        if (!exec) throw new Error(`${key} is not an Xray test execution`)
        const page = exec.testRuns?.results ?? []
        total = exec.testRuns?.total ?? 0
        runs.push(...page)
        if (!page.length) break
      }
      const statuses = (await gql('{ getStatuses { name final } }')).getStatuses ?? []
      return { key, summary: exec.jira?.summary ?? null, statuses: statuses.map(s => ({ name: s.name, final: Boolean(s.final) })), runs: runs.map(shapeRun) }
    },
    async setStatus(runId, status) {
      if (!RUN_ID.test(String(runId))) throw new Error(`not a test run id: ${JSON.stringify(runId)}`)
      if (!STATUS.test(String(status))) throw new Error(`not a status name: ${JSON.stringify(status)}`)
      await gql(`mutation { updateTestRunStatus(id: ${q(runId)}, status: ${q(status)}) }`)
      return { ok: true, runId, status }
    },
    /** Creates manual tests in a project through Xray's bulk import, and waits for the job. */
    async createTests(project, tests) {
      if (!PROJECT.test(String(project))) throw new Error(`not a Jira project key: ${JSON.stringify(project)}`)
      if (!Array.isArray(tests) || tests.length < 1 || tests.length > MAX_TESTS) throw new Error(`give 1 to ${MAX_TESTS} tests`)
      const line = v => typeof v === 'string' && v.trim() !== '' && v.length <= 255 && !/[\r\n]/.test(v)
      const text = v => typeof v === 'string' && v.length <= 2000
      tests.forEach((t, i) => {
        if (!line(t?.summary)) throw new Error(`test ${i + 1}: summary must be one line of up to 255 characters`)
        if (!Array.isArray(t.steps) || t.steps.length < 1 || t.steps.length > MAX_STEPS) throw new Error(`test ${i + 1}: give 1 to ${MAX_STEPS} steps`)
        t.steps.forEach((s, j) => {
          if (!(text(s?.action) && s.action.trim()) || !text(s.data ?? '') || !text(s.result ?? '')) throw new Error(`test ${i + 1}, step ${j + 1}: action is needed; action, data and result are text of up to 2000 characters`)
        })
      })
      const payload = tests.map(t => ({
        testtype: 'Manual',
        fields: { summary: t.summary.trim(), project: { key: project }, ...(Array.isArray(t.labels) && t.labels.length ? { labels: t.labels.filter(line) } : {}) },
        steps: t.steps.map(s => ({ action: s.action, data: s.data ?? '', result: s.result ?? '' })),
      }))
      const job = await rest('POST', '/api/v2/import/test/bulk', payload)
      const jobId = String(job?.jobId ?? '')
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) throw new Error('Xray did not start an import job')
      for (let i = 0; i < polls; i++) {
        const s = await rest('GET', `/api/v2/import/test/bulk/${jobId}/status`)
        // pending and working: not done yet. partially_successful still lists the tests it created, so no retry duplicates them.
        if (s?.status && !['pending', 'working'].includes(s.status)) {
          const issues = s.result?.issues ?? []
          return {
            ok: s.status === 'successful', status: s.status, jobId,
            created: issues.map(x => ({ index: x.elementIndex ?? null, key: x.key ?? null, id: x.id ?? null })),
            errors: (s.result?.errors ?? []).map(e => (typeof e === 'string' ? e : e?.error ?? JSON.stringify(e))),
            warnings: (s.result?.warnings ?? []).map(e => (typeof e === 'string' ? e : JSON.stringify(e))),
          }
        }
        await sleep(pollMs)
      }
      throw new Error(`the Xray import ${jobId} is still running: check Test Repository in Xray, do not create the tests again`)
    },
    /** Adds tests (by key) to a test execution (by key). */
    async addTestsToExecution(execKey, testKeys) {
      if (!isTicketKey(execKey)) throw new Error(`not a Jira key: ${JSON.stringify(execKey)}`)
      if (!Array.isArray(testKeys) || testKeys.length < 1 || testKeys.length > 100 || testKeys.some(k => !isTicketKey(k))) throw new Error('give 1 to 100 test keys, like ABC-12')
      const exec = (await gql(`{ getTestExecutions(jql: ${q(`key = "${execKey}"`)}, limit: 1) { results { issueId } } }`)).getTestExecutions?.results?.[0]
      if (!exec?.issueId || !ISSUE_ID.test(String(exec.issueId))) throw new Error(`${execKey} is not an Xray test execution`)
      const found = (await gql(`{ getTests(jql: ${q(`key in (${testKeys.join(', ')})`)}, limit: 100) { results { issueId jira(fields: ["key"]) } } }`)).getTests?.results ?? []
      const missing = testKeys.filter(k => !found.some(f => f.jira?.key === k))
      if (missing.length) throw new Error(`not Xray tests: ${missing.join(', ')}`)
      const ids = found.map(f => String(f.issueId))
      if (ids.some(i => !ISSUE_ID.test(i))) throw new Error('Xray returned an unexpected test id')
      const d = await gql(`mutation { addTestsToTestExecution(issueId: ${q(String(exec.issueId))}, testIssueIds: [${ids.map(q).join(', ')}]) { addedTests warning } }`)
      return { ok: true, execution: execKey, added: d.addTestsToTestExecution?.addedTests ?? [], warning: d.addTestsToTestExecution?.warning ?? null }
    },
    async addDefect(runId, defect) {
      if (!RUN_ID.test(String(runId))) throw new Error(`not a test run id: ${JSON.stringify(runId)}`)
      if (!isTicketKey(defect)) throw new Error(`not a Jira key: ${JSON.stringify(defect)}`)
      const d = await gql(`mutation { addDefectsToTestRun(id: ${q(runId)}, issues: [${q(defect)}]) { addedDefects warnings } }`)
      return { ok: true, runId, defect, warnings: [].concat(d.addDefectsToTestRun ?? []).flatMap(x => x?.warnings ?? []) }
    },
  }
}

const obj = (props, required) => ({ type: 'object', properties: props, required })
const str = description => ({ type: 'string', description })
export const TOOLS = [
  {
    name: 'get_test_run',
    description: "Read an Xray test execution: each test's run id, status and steps (action, data, expected result), and the run statuses this Xray has. Read-only.",
    inputSchema: obj({ key: str('The test execution key, like ABC-123') }, ['key']),
  },
  {
    name: 'set_test_run_status',
    description: "Set one test run's status in Xray, by a status name from get_test_run (like PASSED or FAILED). Writes to Xray: only after the tester said yes.",
    inputSchema: obj({ runId: str('The test run id from get_test_run'), status: str('A status name from get_test_run') }, ['runId', 'status']),
  },
  {
    name: 'add_defect_to_test_run',
    description: "Add a Jira defect to a test run in Xray (the run's Findings). Writes to Xray: only after the tester said yes.",
    inputSchema: obj({ runId: str('The test run id from get_test_run'), defect: str('The defect key, like ABC-124') }, ['runId', 'defect']),
  },
  {
    name: 'create_tests',
    description: 'Create manual tests in an Xray project (bulk import) and wait for the result: each test is a summary and steps (action, data, result). Writes to Xray: only after the tester said yes. Returns the created test keys; never run it twice for the same tests.',
    inputSchema: obj({
      project: str('The Jira project key, like ABC'),
      tests: { type: 'array', description: `1 to ${MAX_TESTS} tests`, items: obj({ summary: str('One line'), steps: { type: 'array', items: obj({ action: str('What to do'), data: str('Data to use, or empty'), result: str('The expected result, or empty') }, ['action']) }, labels: { type: 'array', items: { type: 'string' } } }, ['summary', 'steps']) },
    }, ['project', 'tests']),
  },
  {
    name: 'add_tests_to_test_execution',
    description: 'Add Xray tests (by key) to a test execution (by key). Writes to Xray: only after the tester said yes.',
    inputSchema: obj({ execution: str('The test execution key, like ABC-123'), tests: { type: 'array', items: { type: 'string' }, description: 'Test keys, like ABC-12' } }, ['execution', 'tests']),
  },
]

/** Answers one JSON-RPC message: the five tools, the rest as the no-tools server does. */
export function handler(client) {
  return async msg => {
    if (msg?.id === undefined || msg?.id === null) return reply(msg, 'xray')
    const res = result => ({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'tools/list') return res({ tools: TOOLS })
    if (msg.method !== 'tools/call') return reply(msg, 'xray')
    const { name, arguments: a = {} } = msg.params ?? {}
    const calls = {
      get_test_run: () => client.testRun(a.key),
      set_test_run_status: () => client.setStatus(a.runId, a.status),
      add_defect_to_test_run: () => client.addDefect(a.runId, a.defect),
      create_tests: () => client.createTests(a.project, a.tests),
      add_tests_to_test_execution: () => client.addTestsToExecution(a.execution, a.tests),
    }
    if (!Object.hasOwn(calls, name)) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } }
    try {
      return res({ content: [{ type: 'text', text: JSON.stringify(await calls[name]()) }] })
    } catch (e) {
      return res({ content: [{ type: 'text', text: e.message }], isError: true })
    }
  }
}

if (isMain(import.meta.url)) {
  const { XRAY_CLIENT_ID: id, XRAY_CLIENT_SECRET: secret, XRAY_API_URL: base } = process.env
  await serve(handler(xrayClient({ id, secret, base: tokenSet(base) ? base : '' })))
}
