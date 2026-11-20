// Figma designs already read, so a re-run does not spend a Figma call. View and Collab seats get a few
// calls a month: one read per node, saved here, and a rate limit remembered so nothing calls again.
// Holds the read-out of a design (frames, texts, labels, states), never tokens. Local only; /clean --cache deletes it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirOf, MAX_AGE_MS, secretIn, short, slug } from './progress.mjs'
import { readJsonOr } from '../core/files.mjs'
import { isObject } from '../core/is.mjs'

export const MAX_TEXT_BYTES = 32 * 1024
export const MAX_DESIGNS = 50
export const LIMIT_HOURS = 24
const MAX_LIMIT_HOURS = 31 * 24

const fileOf = (root, env) => join(dirOf(env), `${slug(root)}-${short(root)}`, 'figma.json')

function read(root, env) {
  const c = readJsonOr(fileOf(root, env), null)
  return { designs: isObject(c?.designs) ? c.designs : {}, limitedUntil: typeof c?.limitedUntil === 'string' ? c.limitedUntil : null }
}

function write(root, env, data) {
  const file = fileOf(root, env)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}

/** { fileKey, nodeId } of a figma.com design link; a branch link reads the branch. null when it is not one. */
export function parseFigmaUrl(url) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  if (!/^(?:[\w-]+\.)?figma\.com$/i.test(u.hostname)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (!['design', 'file', 'proto', 'board'].includes(parts[0]) || !/^\w+$/.test(parts[1] ?? '')) return null
  const fileKey = parts[2] === 'branch' && /^\w+$/.test(parts[3] ?? '') ? parts[3] : parts[1]
  const raw = u.searchParams.get('node-id')
  const nodeId = raw && /^[\d:-]+$/.test(raw) ? raw.replace(/-/g, ':') : null
  return { fileKey, nodeId }
}

const keyOf = ({ fileKey, nodeId }) => `${fileKey}:${nodeId ?? ''}`

function limitOf(c, now) {
  const until = Date.parse(c.limitedUntil)
  return Number.isFinite(until) && until > now ? c.limitedUntil : null
}

/** A saved read-out of the link's node, fresh for 7 days, and whether Figma's rate limit is still on. */
export function getDesign(root, url, env = process.env, now = Date.now()) {
  const link = parseFigmaUrl(url)
  if (!link) return { ok: false, reason: 'not a figma.com design link' }
  const c = read(root, env)
  const limitedUntil = limitOf(c, now)
  const base = { ok: true, ...link, limited: Boolean(limitedUntil), ...(limitedUntil && { limitedUntil }) }
  const d = c.designs[keyOf(link)]
  const at = Date.parse(d?.savedAt)
  if (!d || typeof d.text !== 'string' || !Number.isFinite(at) || now - at > MAX_AGE_MS) return { ...base, found: false }
  return { ...base, found: true, text: d.text, ageMinutes: Math.max(0, Math.round((now - at) / 60000)) }
}

export function setDesign(root, url, text, env = process.env, now = Date.now()) {
  const link = parseFigmaUrl(url)
  if (!link) return { ok: false, reason: 'not a figma.com design link' }
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'the read-out is empty' }
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) return { ok: false, reason: `the read-out is over ${MAX_TEXT_BYTES / 1024} KB: keep the frames, texts, labels and states only` }
  if (secretIn(text)) return { ok: false, reason: 'the read-out looks like it holds a secret: the cache keeps the design, never tokens or keys' }
  const c = read(root, env)
  c.designs[keyOf(link)] = { text, savedAt: new Date(now).toISOString() }
  // The oldest go first past the cap.
  const keys = Object.keys(c.designs).sort((a, b) => Date.parse(c.designs[a].savedAt) - Date.parse(c.designs[b].savedAt))
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DESIGNS))) delete c.designs[k]
  write(root, env, c)
  return { ok: true, ...link }
}

/** Figma said the seat's limit is reached: no call until then. */
export function setLimited(root, hours = LIMIT_HOURS, env = process.env, now = Date.now()) {
  if (!(Number.isInteger(hours) && hours > 0 && hours <= MAX_LIMIT_HOURS)) return { ok: false, reason: `the hours are a whole number from 1 to ${MAX_LIMIT_HOURS}` }
  const c = read(root, env)
  c.limitedUntil = new Date(now + hours * 3600000).toISOString()
  write(root, env, c)
  return { ok: true, limitedUntil: c.limitedUntil }
}

/** Forgets the saved designs and the limit. */
export function clearFigma(root, env = process.env) {
  rmSync(fileOf(root, env), { force: true })
  return { ok: true }
}
