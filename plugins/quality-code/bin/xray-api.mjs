#!/usr/bin/env node
// The Xray connector: a stdio MCP server over Xray Cloud's GraphQL API, for /quality-code:qa. It is
// started by bin/mcp-launch.mjs, only when the API key's secret is set (xray_client_id and
// xray_client_secret in the plugin settings); without it the launcher answers with no tools. The key
// comes from the environment .mcp.json fills from the keychain, goes only to the Xray API address,
// and is never printed. Three tools: read a test execution's runs (tests, steps, statuses), set a
// run's status, add a defect to a run. The qa command asks the tester before each write.
//
//   node bin/mcp-launch.mjs xray -- node bin/xray-api.mjs
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { reply, serve, tokenSet } from './mcp-launch.mjs'
import { DEFAULT_XRAY_API, xrayApiUrlOf } from './connector-settings.mjs'

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
const STATUS = /^[A-Za-z0-9 _-]{1,40}$/
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
export function xrayClient({ id, secret, base, fetch = globalThis.fetch, timeoutMs = 30000 }) {
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
      if (!KEY.test(String(key))) throw new Error(`not a Jira key: ${JSON.stringify(key)}`)
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
    async addDefect(runId, defect) {
      if (!RUN_ID.test(String(runId))) throw new Error(`not a test run id: ${JSON.stringify(runId)}`)
      if (!KEY.test(String(defect))) throw new Error(`not a Jira key: ${JSON.stringify(defect)}`)
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
]

/** Answers one JSON-RPC message: the three tools, the rest as the no-tools server does. */
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
    }
    if (!Object.hasOwn(calls, name)) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } }
    try {
      return res({ content: [{ type: 'text', text: JSON.stringify(await calls[name]()) }] })
    } catch (e) {
      return res({ content: [{ type: 'text', text: e.message }], isError: true })
    }
  }
}

const isMain = (() => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
})()

if (isMain) {
  const { XRAY_CLIENT_ID: id, XRAY_CLIENT_SECRET: secret, XRAY_API_URL: base } = process.env
  await serve(handler(xrayClient({ id, secret, base: tokenSet(base) ? base : '' })))
}
