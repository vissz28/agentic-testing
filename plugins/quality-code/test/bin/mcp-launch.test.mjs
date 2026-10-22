// bin/mcp-launch.mjs: a token connector without its token answers as an MCP server with no tools
// (never "failed"); with the token it runs the real server in its place. The real server here is
// a fake node script, so no npx and no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseArgs, reply, tokenSet } from '../../bin/mcp-launch.mjs'

const LAUNCH = join(dirname(fileURLToPath(import.meta.url)), '../../bin/mcp-launch.mjs')
const dir = mkdtempSync(join(tmpdir(), 'qc-mcp-launch-'))
// Echoes each stdin line back marked as its own, says whether the token reached it, exits 7 at
// stdin end and 5 on SIGTERM.
const FAKE = join(dir, 'fake-server.mjs')
writeFileSync(FAKE, `
import { createInterface } from 'node:readline'
process.on('SIGTERM', () => { process.stdout.write('term\\n'); process.exit(5) })
process.stdout.write('ready token=' + (process.env.GITLAB_PERSONAL_ACCESS_TOKEN ? 'yes' : 'no') + '\\n')
createInterface({ input: process.stdin }).on('line', l => process.stdout.write('real:' + l + '\\n')).on('close', () => process.exit(7))
`)

/** Starts the launcher; resolves with { code, out, err } once it exits. */
function launch(args, env, { input = [], keepOpen = false } = {}) {
  const child = spawn(process.execPath, [LAUNCH, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: 'pipe' })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  for (const line of input) child.stdin.write(line + '\n')
  if (!keepOpen) child.stdin.end()
  const done = new Promise(r => child.on('close', code => r({ code, out, err })))
  return { child, done, out: () => out }
}
const lines = out => out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}

test('tokenSet: empty, blank and an unexpanded ${user_config...} are not set', () => {
  for (const v of [undefined, '', '   ', '${user_config.gitlab_token}', '${GITLAB_TOKEN}']) assert.equal(tokenSet(v), false, String(v))
  for (const v of ['glpat-x', 'figd_abc']) assert.equal(tokenSet(v), true)
})

test('parseArgs: a known connector, then the real server after --', () => {
  assert.deepEqual(parseArgs(['gitlab-token', '--', 'npx', '-y', 'pkg@1.0.0']), { name: 'gitlab-token', token: 'GITLAB_PERSONAL_ACCESS_TOKEN', command: ['npx', '-y', 'pkg@1.0.0'] })
  assert.equal(parseArgs(['figma-token', '--', 'x']).token, 'FIGMA_API_KEY')
  for (const bad of [[], ['nope', '--', 'x'], ['toString', '--', 'x'], ['gitlab-token'], ['gitlab-token', '--'], ['gitlab-token', 'npx']])
    assert.ok(parseArgs(bad).error, JSON.stringify(bad))
})

test('reply: initialize echoes the protocol, tools/list is empty, ping answers, notifications get nothing', () => {
  const init = reply({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, 'gitlab-token')
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.deepEqual(init.result.capabilities, { tools: {} })
  assert.equal(init.result.serverInfo.name, 'quality-code-gitlab-token')
  assert.equal(typeof init.result.serverInfo.version, 'string')
  assert.equal(reply({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, 'x').result.protocolVersion, '2024-11-05')
  assert.deepEqual(reply({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'x'), { jsonrpc: '2.0', id: 3, result: { tools: [] } })
  assert.deepEqual(reply({ jsonrpc: '2.0', id: 'p', method: 'ping' }, 'x'), { jsonrpc: '2.0', id: 'p', result: {} })
  assert.equal(reply({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'x'), null)
  assert.equal(reply({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'a' } }, 'x').error.code, -32601)
  assert.equal(reply({ jsonrpc: '2.0', id: 5 }, 'x').error.code, -32600)
})

for (const [label, value] of [['empty', ''], ['unset', undefined], ['an unexpanded placeholder', '${user_config.gitlab_token}']]) {
  test(`no token (${label}): an MCP server with no tools answers over stdio and exits 0 at stdin end`, async () => {
    const env = value === undefined ? {} : { GITLAB_PERSONAL_ACCESS_TOKEN: value }
    const { done } = launch(['gitlab-token', '--', process.execPath, FAKE], env, {
      input: [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
        JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list' }),
        'not json',
      ],
    })
    const { code, out, err } = await done
    assert.equal(code, 0)
    assert.equal(err, '')
    assert.doesNotMatch(out, /real:|ready/)
    const [init, list, ping, unknown, parse] = lines(out)
    assert.deepEqual(init, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: init.result.serverInfo } })
    assert.deepEqual(list, { jsonrpc: '2.0', id: 2, result: { tools: [] } })
    assert.deepEqual(ping, { jsonrpc: '2.0', id: 3, result: {} })
    assert.equal(unknown.id, 4)
    assert.equal(unknown.error.code, -32601)
    assert.deepEqual(parse, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  })
}

test('no Figma key: the figma-token launcher answers the same way', async () => {
  const { done } = launch(['figma-token', '--', process.execPath, FAKE], { FIGMA_API_KEY: '' }, {
    input: [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
  })
  const { code, out } = await done
  assert.equal(code, 0)
  assert.deepEqual(lines(out), [{ jsonrpc: '2.0', id: 1, result: { tools: [] } }])
})

test('token set: the real server runs with the same stdio and env, and its exit code is passed on', async () => {
  const { done } = launch(['gitlab-token', '--', process.execPath, FAKE], { GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-test' }, {
    input: [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
  })
  const { code, out, err } = await done
  assert.equal(code, 7)
  assert.equal(err, '')
  assert.equal(out, 'ready token=yes\nreal:{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
  assert.doesNotMatch(out + err, /glpat-test/)
})

test('token set: a SIGTERM to the launcher reaches the real server', async () => {
  const run = launch(['gitlab-token', '--', process.execPath, FAKE], { GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-test' }, { keepOpen: true })
  await until(() => run.out().includes('ready'))
  run.child.kill('SIGTERM')
  const { code, out } = await run.done
  assert.equal(code, 5)
  assert.match(out, /term\n$/)
})

test('token set but the real server cannot start: exits 127 with a reason, no token in it', async () => {
  const { code, err } = await launch(['gitlab-token', '--', join(dir, 'missing-command')], { GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-test' }).done
  assert.equal(code, 127)
  assert.match(err, /could not start/)
  assert.doesNotMatch(err, /glpat-test/)
})

test('bad arguments: exit 2 with the reason', async () => {
  const { code, err } = await launch(['unknown'], {}).done
  assert.equal(code, 2)
  assert.match(err, /unknown connector/)
})
