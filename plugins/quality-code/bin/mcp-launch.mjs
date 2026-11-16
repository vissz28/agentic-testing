// Runs the real MCP server only when its token is set; otherwise an empty one, so Claude Code shows it as connected, not failed.
// The token is only checked for presence, never printed.
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { createInterface } from 'node:readline'
import { isMain, printError } from '../lib/core/script-io.mjs'
import { tryReadJson } from '../lib/core/files.mjs'

export const CONNECTORS = {
  'figma-token': 'FIGMA_API_KEY',
  'gitlab-token': 'GITLAB_PERSONAL_ACCESS_TOKEN',
  xray: 'XRAY_CLIENT_SECRET',
}

/** An unexpanded ${...} placeholder counts as unset. */
export function tokenSet(value) {
  const v = String(value ?? '').trim()
  return v !== '' && !/^\$\{[^}]*\}$/.test(v)
}

export function parseArgs(argv) {
  const [name, sep, ...command] = argv
  const token = Object.hasOwn(CONNECTORS, name ?? '') ? CONNECTORS[name] : null
  if (!token) return { error: `unknown connector "${name ?? ''}": one of ${Object.keys(CONNECTORS).join(', ')}` }
  if (sep !== '--' || !command.length) return { error: 'pass the real server after --' }
  return { name, token, command }
}

const version = tryReadJson(new URL('../.claude-plugin/plugin.json', import.meta.url), null)?.version ?? '0.0.0'

/** null for a notification (no id). */
export function reply(msg, name) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string')
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } }
  if (msg.id === undefined || msg.id === null) return null
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion
      return ok({
        protocolVersion: typeof asked === 'string' && asked ? asked : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: `quality-code-${name}`, version },
      })
    }
    case 'tools/list': return ok({ tools: [] })
    case 'ping': return ok({})
    default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
  }
}

/** Newline-delimited JSON-RPC over stdio; resolves when stdin closes. */
export function serve(handle, input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on('line', line => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      return
    }
    // Sync answers are written immediately so replies keep request order.
    const write = r => { if (r) output.write(JSON.stringify(r) + '\n') }
    const r = handle(msg)
    if (r instanceof Promise) r.then(write)
    else write(r)
  })
  return new Promise(done => lines.on('close', done))
}

export const serveEmpty = (name, input, output) => serve(msg => reply(msg, name), input, output)

export function runReal(command) {
  const [cmd, ...args] = command
  // npx is npx.cmd on Windows, which only a shell finds.
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' })
  const forward = sig => () => { try { child.kill(sig) } catch {} }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, forward(sig))
  child.on('error', e => {
    printError(`mcp-launch: could not start ${cmd}: ${e.code ?? e.message}`)
    process.exit(127)
  })
  child.on('exit', (code, signal) => {
    // Shell convention: 128 + signal number.
    process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : code ?? 1)
  })
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2))
  if (a.error) {
    printError(`mcp-launch: ${a.error}`)
    process.exit(2)
  }
  if (tokenSet(process.env[a.token])) runReal(a.command)
  else await serveEmpty(a.name)
}
