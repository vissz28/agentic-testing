// Starts a token connector only when its token is set. With the token, the real MCP server runs
// with this process's stdio, environment, signals and exit code. Without it, a stdio MCP server
// with no tools answers instead, so Claude Code shows the connector as connected (nothing to use)
// and never as failed. A server with no tools means "not set up".
//
//   node bin/mcp-launch.mjs <name> -- <command> <args...>
//
// <name> is a connector below, which says the token's variable; the real server comes after --,
// so its pinned version stays in .mcp.json, the one place it is written.
// The token itself is never read beyond "is it set", and never printed.
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { constants } from 'node:os'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

/** Each token connector and the environment variable that holds its token. */
export const CONNECTORS = {
  'figma-token': 'FIGMA_API_KEY',
  'gitlab-token': 'GITLAB_PERSONAL_ACCESS_TOKEN',
  xray: 'XRAY_CLIENT_SECRET',
}

/** A value counts as set when it is not empty and not a ${...} placeholder left unexpanded. */
export function tokenSet(value) {
  const v = String(value ?? '').trim()
  return v !== '' && !/^\$\{[^}]*\}$/.test(v)
}

/** { name, token, command } from argv, or { error }. */
export function parseArgs(argv) {
  const [name, sep, ...command] = argv
  const token = Object.hasOwn(CONNECTORS, name ?? '') ? CONNECTORS[name] : null
  if (!token) return { error: `unknown connector "${name ?? ''}": one of ${Object.keys(CONNECTORS).join(', ')}` }
  if (sep !== '--' || !command.length) return { error: 'pass the real server after --' }
  return { name, token, command }
}

const version = (() => {
  try { return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version ?? '0.0.0' } catch { return '0.0.0' }
})()

/** The reply to one JSON-RPC message, or null for a notification (no id). */
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

/**
 * A stdio MCP server: newline-delimited JSON-RPC on stdin/stdout, ends with stdin. `handle` answers
 * one message, or a promise of the answer (null for a notification).
 */
export function serve(handle, input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on('line', line => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      return
    }
    // A plain answer is written at once, so replies keep the order of the requests; a promise when it settles.
    const write = r => { if (r) output.write(JSON.stringify(r) + '\n') }
    const r = handle(msg)
    if (r instanceof Promise) r.then(write)
    else write(r)
  })
  return new Promise(done => lines.on('close', done))
}

/** The no-tools server. */
export const serveEmpty = (name, input, output) => serve(msg => reply(msg, name), input, output)

/** Runs the real server in this process's place: same stdio and env, signals passed on, same exit. */
export function runReal(command) {
  const [cmd, ...args] = command
  // npx is npx.cmd on Windows, which only a shell finds.
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' })
  const forward = sig => () => { try { child.kill(sig) } catch {} }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, forward(sig))
  child.on('error', e => {
    process.stderr.write(`mcp-launch: could not start ${cmd}: ${e.code ?? e.message}\n`)
    process.exit(127)
  })
  child.on('exit', (code, signal) => {
    // Killed by a signal: exit as a shell reports it, 128 + the signal's number.
    process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : code ?? 1)
  })
}

const isMain = (() => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
})()

if (isMain) {
  const a = parseArgs(process.argv.slice(2))
  if (a.error) {
    process.stderr.write(`mcp-launch: ${a.error}\n`)
    process.exit(2)
  }
  if (tokenSet(process.env[a.token])) runReal(a.command)
  else await serveEmpty(a.name)
}
