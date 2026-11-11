#!/usr/bin/env node
// A ticket's attachment, read from the short-lived link the Atlassian connector gives for it
// (downloadJiraIssueAttachment, on a v2 connection). The connector signs the link, so this script
// holds no token: it only downloads from Atlassian's media address, at most 5 MB, images and .docx.
//   node bin/jira-file.mjs <KEY> '<download url>' '<file name>'
//     an image is saved as <ticketsDir>/<KEY>/files/<n>.<ext>: FILE_JSON:{ path, name, bytes }
//     a .docx is not saved: DOCX_JSON, as `ticket.mjs docx` prints it
//   node bin/jira-file.mjs done <KEY>     deletes <ticketsDir>/<KEY>/files/
// Exit 0 read, 2 usage or a file that is not read (the reason on stderr).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, normaliseTicketsDir, projectRoot } from '../lib/base/config.mjs'
import { docxText, MAX_BYTES } from '../lib/ticket/docx.mjs'

const USAGE = "usage: jira-file.mjs <KEY> '<download url>' '<file name>' | jira-file.mjs done <KEY>"
export const MEDIA_HOST = 'api.media.atlassian.com'
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
export const MAX_IMAGES = 3
const TIMEOUT_MS = 30000

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { fetchImpl = globalThis.fetch, out = s => process.stdout.write(`${s}\n`), err = s => process.stderr.write(`${s}\n`) } = {}) {
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root, env)
  if (!cfg.ok) { cfg.errors.forEach(e => err(e)); return 2 }
  // A key that cannot leave the tickets folder.
  const dirOf = key => join(resolve(root, normaliseTicketsDir(cfg.config.ticketsDir)), key, 'files')
  if (argv[0] === 'done') {
    if (!KEY.test(argv[1] ?? '') || argv.length > 2) { err(USAGE); return 2 }
    rmSync(dirOf(argv[1]), { recursive: true, force: true })
    out('ok')
    return 0
  }
  const [key, link, name] = argv
  if (!KEY.test(key ?? '') || !link || !name || argv.length > 3) { err(USAGE); return 2 }
  let url = null
  try { url = new URL(link) } catch {}
  if (url?.protocol !== 'https:' || url.hostname !== MEDIA_HOST) { err(`only a link to https://${MEDIA_HOST} is downloaded`); return 2 }
  const file = basename(name)
  const ext = extname(file).toLowerCase()
  if (!IMAGES.has(ext) && ext !== '.docx') { err(`${file}: only images and .docx files are read`); return 2 }
  const dir = dirOf(key)
  const saved = existsSync(dir) ? readdirSync(dir).length : 0
  if (ext !== '.docx' && saved >= MAX_IMAGES) { err(`${file}: ${MAX_IMAGES} images of ${key} are read already`); return 2 }
  let buf
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // ponytail: a file with no content-length is buffered whole before the size check; stream it if that ever matters.
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('over 5 MB, not read')
    buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('over 5 MB, not read')
    if (ext === '.docx') { out(`DOCX_JSON:${JSON.stringify(docxText(buf))}`); return 0 }
  } catch (e) { err(`${file}: ${String(e?.message ?? e).split('\n')[0]}`); return 2 }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${saved + 1}${ext}`)
  writeFileSync(path, buf)
  out(`FILE_JSON:${JSON.stringify({ path, name: file, bytes: buf.length })}`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exit(await main())
