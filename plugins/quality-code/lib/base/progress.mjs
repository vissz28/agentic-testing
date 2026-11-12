// Where a command stopped: the answers and the step reached, kept between turns and sessions so a person can go on
// after a break instead of starting over. One small file per project folder, command and ticket, on this machine
// under the Claude folder, never in the repo and never sent anywhere. It holds answers (a site, a project key, a
// pick), never a token, a key, a password or ticket text.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { claudeDir } from './config.mjs'
import { isTicketKey } from '../core/text.mjs'
import { tryReadJson } from '../core/files.mjs'

export const COMMANDS = ['setup', 'spec', 'ticket-eval', 'tickets-eval', 'transcript-goal', 'xray', 'seed', 'qa', 'ci', 'config', 'routine', 'session']
// `session` keeps the person's language (one entry per project folder); it never expires, the others do after 7 days.
const LANGUAGE = /^[a-z]{2}$/
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_DATA_BYTES = 16 * 1024
// Anything that looks like a secret is refused: the cache holds answers, not credentials.
const SECRET = /(ghp_|gho_|github_pat_|glpat-|xox[abp]-|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY)/
const SECRET_FIELD = /^(token|password|passwd|secret|api[_-]?key|authorization)$/i

export const dirOf = env => join(claudeDir(env), 'quality-code', 'progress')
export const short = root => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8)
export const slug = root => (basename(resolve(root)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'project').slice(0, 40)
export const fileOf = (root, command, key, env = process.env) =>
  join(dirOf(env), `${slug(root)}-${short(root)}`, `${command}${key ? `.${key}` : ''}.json`)

function check(command, key) {
  if (!COMMANDS.includes(command)) return `unknown command "${command}" (${COMMANDS.join(', ')})`
  if (command === 'session' && key != null) return 'session has no ticket key'
  if (key != null && !isTicketKey(key)) return `"${key}" is not a ticket key`
  return null
}

export function secretIn(value, path = '') {
  if (typeof value === 'string') return SECRET.test(value) ? path || 'value' : null
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) { const r = secretIn(v, `${path}[${i}]`); if (r) return r } return null }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD.test(k)) return `${path}${path ? '.' : ''}${k}`
      const r = secretIn(v, `${path}${path ? '.' : ''}${k}`)
      if (r) return r
    }
  }
  return null
}

/** Where `command` (and `key`) stopped in this project, or { found: false } when nothing is saved or it is older than 7 days. */
export function getProgress(root, command, key = null, env = process.env, now = Date.now()) {
  const bad = check(command, key)
  if (bad) return { ok: false, reason: bad }
  const saved = tryReadJson(fileOf(root, command, key, env), null)
  const at = Date.parse(saved?.updated)
  if (!saved || !Number.isInteger(saved.step) || !Number.isFinite(at)) return { ok: true, found: false }
  if (command !== 'session' && now - at > MAX_AGE_MS) return { ok: true, found: false, expired: true }
  return { ok: true, found: true, command, key, step: saved.step, label: saved.label ?? '', data: saved.data ?? {}, updated: saved.updated, ageMinutes: Math.max(0, Math.round((now - at) / 60000)) }
}

/** Save the step reached and merge `data` (an object of answers) into what is saved. */
export function setProgress(root, command, { key = null, step, label = '', data = {} }, env = process.env, now = Date.now()) {
  const bad = check(command, key)
  if (bad) return { ok: false, reason: bad }
  if (!Number.isInteger(step) || step < 0 || step > 99) return { ok: false, reason: 'the step is a whole number from 0 to 99' }
  if (typeof label !== 'string' || label.length > 80 || /[\r\n]/.test(label)) return { ok: false, reason: 'the label is one line of 80 characters at most' }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'the data is a JSON object' }
  if (command === 'session') {
    const extra = Object.keys(data).filter(k => k !== 'language')
    if (extra.length) return { ok: false, reason: `session holds only language, not ${extra.join(', ')}` }
    if ('language' in data && !(typeof data.language === 'string' && LANGUAGE.test(data.language))) return { ok: false, reason: 'language is a lowercase two-letter ISO 639-1 code (it, en, sq)' }
  }
  const where = secretIn({ label, data })
  if (where) return { ok: false, reason: `${where} looks like a secret: the cache keeps answers, never tokens, keys or passwords` }
  const before = getProgress(root, command, key, env, now)
  const merged = { ...(before.found ? before.data : {}), ...data }
  const json = JSON.stringify({ command, key, step, label, data: merged, updated: new Date(now).toISOString() })
  if (Buffer.byteLength(json) > MAX_DATA_BYTES) return { ok: false, reason: `the saved answers are over ${MAX_DATA_BYTES / 1024} KB` }
  const file = fileOf(root, command, key, env)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, json)
  return { ok: true, command, key, step, label, data: merged }
}

/** Forget where `command` stopped; true when there was something to forget. */
export function clearProgress(root, command, key = null, env = process.env) {
  const bad = check(command, key)
  if (bad) return { ok: false, reason: bad }
  const file = fileOf(root, command, key, env)
  const had = existsSync(file)
  rmSync(file, { force: true })
  return { ok: true, cleared: had }
}

/** Every saved stop of this project, newest first (for `progress.mjs list`). */
export function listProgress(root, env = process.env, now = Date.now()) {
  const dir = join(dirOf(env), `${slug(root)}-${short(root)}`)
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const [command, key] = f.replace(/\.json$/, '').split(/\.(?=[A-Z])/)
    const p = getProgress(root, command, key ?? null, env, now)
    if (p.ok && p.found) out.push({ command, key: key ?? null, step: p.step, label: p.label, updated: p.updated, ageMinutes: p.ageMinutes })
  }
  return out.sort((a, b) => (a.updated < b.updated ? 1 : -1))
}
