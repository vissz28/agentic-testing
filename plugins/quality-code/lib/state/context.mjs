// Facts learned about a project, cached with their source so a stale one gets re-read.
// Files are stored as path + hash, never content. Local only; never secrets or ticket text.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { dirOf, secretIn, short, slug } from './progress.mjs'
import { readJson } from '../core/files.mjs'
import { toForwardSlashes } from '../core/text.mjs'
import { isAbsoluteAnywhere } from '../core/paths.mjs'

export const FACTS = ['flow', 'tests', 'style', 'stack', 'base', 'connectors', 'jira', 'features']
export const SOURCE_KINDS = ['ttl', 'hash', 'head', 'ticket', 'none']
export const MAX_BYTES = 64 * 1024

const fileOf = (root, env) => join(dirOf(env), `${slug(root)}-${short(root)}`, 'context.json')

function read(root, env) {
  try {
    const c = readJson(fileOf(root, env))
    return { facts: c?.facts && typeof c.facts === 'object' ? c.facts : {}, files: c?.files && typeof c.files === 'object' ? c.files : {} }
  } catch { return { facts: {}, files: {} } }
}

function write(root, env, ctx) {
  const json = JSON.stringify(ctx)
  if (Buffer.byteLength(json) > MAX_BYTES) return `the saved context is over ${MAX_BYTES / 1024} KB`
  const file = fileOf(root, env)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, json)
  return null
}

export function hashFile(root, rel) {
  try { return createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex').slice(0, 16) } catch { return null }
}

/** Source { kind, value }: ttl = ms; hash/head/ticket = token to compare; none = never stale. */
function checkSource(source) {
  if (!source || !SOURCE_KINDS.includes(source.kind)) return `the source is one of ${SOURCE_KINDS.join(', ')}`
  if (source.kind === 'ttl' && !(Number.isInteger(source.value) && source.value > 0)) return 'a ttl source needs the milliseconds as a positive whole number'
  if (['hash', 'head', 'ticket'].includes(source.kind) && !(typeof source.value === 'string' && source.value && source.value.length <= 200)) return `a ${source.kind} source needs the token it came from`
  return null
}

export function setFact(root, name, value, source, env = process.env, now = Date.now()) {
  if (!FACTS.includes(name)) return { ok: false, reason: `unknown fact "${name}" (${FACTS.join(', ')})` }
  const bad = checkSource(source)
  if (bad) return { ok: false, reason: bad }
  if (value === undefined || value === null) return { ok: false, reason: 'the value is a JSON value, not empty' }
  const where = secretIn({ value })
  if (where) return { ok: false, reason: `${where} looks like a secret: the context keeps facts, never tokens, keys or passwords` }
  const ctx = read(root, env)
  ctx.facts[name] = { value, source, savedAt: new Date(now).toISOString() }
  const err = write(root, env, ctx)
  return err ? { ok: false, reason: err } : { ok: true, name }
}

// `current` is the token to compare (HEAD, config hash, ticket updated time).
// A stale fact comes back with a reason and no value, so the command re-reads it.
export function getFact(root, name, current = null, env = process.env, now = Date.now()) {
  if (!FACTS.includes(name)) return { ok: false, reason: `unknown fact "${name}" (${FACTS.join(', ')})` }
  const f = read(root, env).facts[name]
  const at = Date.parse(f?.savedAt)
  if (!f || !Number.isFinite(at) || checkSource(f.source)) return { ok: true, found: false }
  const ageMinutes = Math.max(0, Math.round((now - at) / 60000))
  const { kind, value } = f.source
  let stale = null
  if (kind === 'ttl' && now - at > value) stale = 'older than its time limit'
  if (['hash', 'head', 'ticket'].includes(kind)) {
    if (current === null || current === undefined) stale = `no current ${kind} to compare`
    else if (current !== value) stale = { head: 'the code changed (new git commit)', ticket: 'the ticket changed', hash: 'its source changed' }[kind]
  }
  return stale ? { ok: true, found: true, fresh: false, reason: stale, ageMinutes } : { ok: true, found: true, fresh: true, value: f.value, ageMinutes }
}

/** Stores path and hash only. role: target, spec, config… */
export function recordFile(root, rel, role = 'file', env = process.env, now = Date.now()) {
  // A Windows path (..\x, C:\x) is checked and stored as forward slashes, as fileChanged looks it up.
  if (typeof rel === 'string') rel = toForwardSlashes(rel)
  if (typeof rel !== 'string' || !rel || isAbsoluteAnywhere(rel) || rel.split('/').includes('..')) return { ok: false, reason: 'the path is relative to the project and stays inside it' }
  const hash = hashFile(root, rel)
  if (!hash) return { ok: false, reason: `${rel} is not there` }
  const ctx = read(root, env)
  ctx.files[rel] = { hash, role: String(role).slice(0, 20), savedAt: new Date(now).toISOString() }
  const err = write(root, env, ctx)
  return err ? { ok: false, reason: err } : { ok: true, path: rel, hash }
}

export function fileChanged(root, rel, env = process.env) {
  rel = toForwardSlashes(rel)
  const f = read(root, env).files[rel]
  if (!f) return { ok: true, known: false, changed: true }
  return { ok: true, known: true, changed: hashFile(root, rel) !== f.hash, role: f.role }
}

/** No name: forget everything for this project. */
export function clearContext(root, name = null, env = process.env) {
  if (name !== null && !FACTS.includes(name)) return { ok: false, reason: `unknown fact "${name}" (${FACTS.join(', ')})` }
  if (name === null) { const had = existsSync(fileOf(root, env)); rmSync(fileOf(root, env), { force: true }); return { ok: true, cleared: had } }
  const ctx = read(root, env)
  const had = name in ctx.facts
  delete ctx.facts[name]
  const err = write(root, env, ctx)
  return err ? { ok: false, reason: err } : { ok: true, cleared: had }
}

export function listContext(root, env = process.env, now = Date.now()) {
  const { facts, files } = read(root, env)
  return {
    facts: Object.entries(facts).map(([name, f]) => ({ name, source: f.source?.kind, savedAt: f.savedAt, ageMinutes: Math.max(0, Math.round((now - Date.parse(f.savedAt)) / 60000)) })),
    files: Object.entries(files).map(([path, f]) => ({ path, role: f.role, savedAt: f.savedAt })),
  }
}
