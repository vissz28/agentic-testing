#!/usr/bin/env node
// The Jira files connector: a stdio MCP server that reads a ticket's attachments, which the Atlassian
// connector lists but cannot download. Started by bin/mcp-launch.mjs only when jira_api_token is set
// in the plugin settings; without it the launcher answers with no tools. The token and jira_email come
// from the environment .mcp.json fills from the keychain, go only to an https://<name>.atlassian.net
// site, and are never printed. One read-only tool: a ticket's Word files as text, or its images.
//
//   node bin/mcp-launch.mjs jira-files -- node bin/jira-files.mjs
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { reply, serve, tokenSet } from './mcp-launch.mjs'
import { docxText, MAX_BYTES } from '../lib/ticket/docx.mjs'

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
export const MAX_FILES = 3
const IMAGE = /^image\/(png|jpeg|gif|webp)$/
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const isDocx = a => a.mimeType === DOCX || /\.docx$/i.test(a.filename ?? '')

/** The site's origin when it is Jira Cloud (https://<name>.atlassian.net, no user, port or path), else null. */
export function jiraOrigin(site) {
  let u
  try { u = new URL(String(site ?? '').trim()) } catch { return null }
  const ok = u.protocol === 'https:' && /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(u.hostname) && !u.username && !u.password && !u.port
  return ok ? u.origin : null
}

/** The Jira client: Basic sign-in with the email and API token, read-only calls. */
export function jiraClient({ email, token, fetch = globalThis.fetch, timeoutMs = 30000 }) {
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  async function get(origin, path, what) {
    const r = await fetch(`${origin}${path}`, { headers: { Authorization: auth, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) })
    if (r.status === 401) throw new Error('Jira refused the sign-in (401): check jira_email and jira_api_token in /plugin')
    if (!r.ok) throw new Error(`Jira answered ${r.status} for ${what}: it does not exist, or your account cannot see it`)
    return r
  }
  async function download(origin, a) {
    const r = await get(origin, `/rest/api/3/attachment/content/${a.id}`, 'an attachment')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('over 5 MB')
    return buf
  }
  return {
    /** kind "docx": up to 3 Word files as text; kind "images": up to 3 images. Other files are named in skipped. */
    async ticketFiles(site, key, kind) {
      const origin = jiraOrigin(site)
      if (!origin) throw new Error(`site must be your Jira Cloud address, like https://example.atlassian.net: ${JSON.stringify(site)}`)
      if (!KEY.test(String(key))) throw new Error(`not a Jira key: ${JSON.stringify(key)}`)
      if (kind !== 'docx' && kind !== 'images') throw new Error('kind must be "docx" or "images"')
      if (!tokenSet(email)) throw new Error('set jira_email in /plugin (the email of your Atlassian account)')
      const body = await (await get(origin, `/rest/api/3/issue/${key}?fields=attachment`, key)).json()
      const all = (body.fields?.attachment ?? []).filter(a => /^\d+$/.test(String(a?.id ?? '')))
      const wanted = all.filter(a => (kind === 'docx' ? isDocx(a) : IMAGE.test(a.mimeType ?? '')))
      const skipped = kind === 'docx' ? all.filter(a => !isDocx(a) && !IMAGE.test(a.mimeType ?? '')).map(a => ({ name: a.filename, why: 'not a .docx' })) : []
      const read = []
      for (const a of wanted) {
        if (read.length >= MAX_FILES) { skipped.push({ name: a.filename, why: `more than ${MAX_FILES} files` }); continue }
        if (a.size > MAX_BYTES) { skipped.push({ name: a.filename, why: 'over 5 MB' }); continue }
        try {
          const buf = await download(origin, a)
          read.push(kind === 'docx' ? docxText(buf) : { image: buf.toString('base64'), mimeType: a.mimeType })
        } catch (e) {
          if (/^Jira refused/.test(e.message)) throw e
          skipped.push({ name: a.filename, why: e.message })
        }
      }
      return { kind, read, skipped }
    },
  }
}

const obj = (props, required) => ({ type: 'object', properties: props, required })
const str = description => ({ type: 'string', description })
export const TOOLS = [{
  name: 'get_ticket_files',
  description: `Read a Jira ticket's attachments, which the Atlassian connector cannot download. kind "docx": the text of up to ${MAX_FILES} Word files; kind "images": up to ${MAX_FILES} images, shown to you as images. Files over 5 MB and other types are listed in skipped, by name. Read-only.`,
  inputSchema: obj({
    site: str('The Jira site from the config, like https://example.atlassian.net'),
    key: str('The ticket key, like ABC-123'),
    kind: { type: 'string', enum: ['docx', 'images'], description: 'docx for Word files as text, images for screenshots' },
  }, ['site', 'key', 'kind']),
}]

/** The tool result: one text part with what was read and skipped, then each image as an image part. */
export function toContent({ kind, read, skipped }) {
  if (kind === 'docx') return [{ type: 'text', text: JSON.stringify({ docx: read, skipped }) }]
  return [
    { type: 'text', text: JSON.stringify({ images: read.length, skipped }) },
    ...read.map(r => ({ type: 'image', data: r.image, mimeType: r.mimeType })),
  ]
}

/** Answers one JSON-RPC message: the tool, the rest as the no-tools server does. */
export function handler(client) {
  return async msg => {
    if (msg?.id === undefined || msg?.id === null) return reply(msg, 'jira-files')
    const res = result => ({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'tools/list') return res({ tools: TOOLS })
    if (msg.method !== 'tools/call') return reply(msg, 'jira-files')
    const { name, arguments: a = {} } = msg.params ?? {}
    if (name !== 'get_ticket_files') return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } }
    try {
      return res({ content: toContent(await client.ticketFiles(a.site, a.key, a.kind)) })
    } catch (e) {
      return res({ content: [{ type: 'text', text: e.message }], isError: true })
    }
  }
}

const isMain = (() => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
})()

if (isMain) {
  const { JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env
  await serve(handler(jiraClient({ email, token })))
}
