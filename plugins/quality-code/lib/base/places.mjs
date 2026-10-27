// Where a project's files and logs go: the ticket copies, run logs and Xray files (the tickets folder)
// and the audit log. Each person picks once per project, on this machine:
//   repo   in the project, git-ignored (the default in a repo)
//   local  on this machine, outside the repo, under the Claude folder (the default with no repo)
//   chat   only in the chat: the files a run needs go to a temp folder, and no audit log is kept
// The pick lives in <Claude folder>/quality-code/save.json, never in the repo: it is one person's choice.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { claudeDir, normaliseTicketsDir } from './config.mjs'

export const PLACES = ['repo', 'local', 'chat']
export const AUDIT_REL = '.claude/quality-code/audit'

const prefsPath = env => join(claudeDir(env), 'quality-code', 'save.json')
// A personal setup has no project: one pick for every folder.
const prefKey = (root, source) => (source === 'personal' ? 'personal' : resolve(root))
const short = root => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8)
const slug = root => (basename(resolve(root)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'project').slice(0, 40)

function readPrefs(env) {
  try {
    const p = JSON.parse(readFileSync(prefsPath(env), 'utf8'))
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
  } catch { return {} }
}

/** The pick for this project, or null when it was never asked. */
export function savedPlace(root, source, env = process.env) {
  const v = readPrefs(env)[prefKey(root, source)]
  return PLACES.includes(v) ? v : null
}

/** The places this project can pick from: a setup with no repo has no repo to keep files in. */
export const placesFor = source => (source === 'personal' ? ['local', 'chat'] : PLACES)

/** The place in force: the pick, else repo in a repo and local with no repo. */
export function placeOf(root, source, env = process.env) {
  const p = savedPlace(root, source, env)
  return p && placesFor(source).includes(p) ? p : source === 'personal' ? 'local' : 'repo'
}

/** The folder a place keeps this project's files in, outside the repo; null for repo. */
function baseOf(root, source, place, env) {
  if (place === 'repo') return null
  if (place === 'chat') return join(tmpdir(), 'quality-code', source === 'personal' ? 'personal' : `${slug(root)}-${short(root)}`)
  return source === 'personal' ? join(claudeDir(env), 'quality-code') : join(claudeDir(env), 'quality-code', 'projects', `${slug(root)}-${short(root)}`)
}

/**
 * The folders a place uses: `ticketsDir` (relative to the root in the repo, else absolute) and `auditDir`
 * (absolute; null in the chat, where no log is kept). The config's own ticketsDir applies in the repo,
 * and for a personal setup that names one.
 */
export function placeDirs(root, { source = 'repo', ticketsDir, personalDefault } = {}, place = placeOf(root, source), env = process.env) {
  const base = baseOf(root, source, place, env)
  const own = ticketsDir === undefined ? null : normaliseTicketsDir(ticketsDir)
  if (place === 'repo') return { place, ticketsDir: own ?? '.quality-code/tickets', auditDir: join(resolve(root), AUDIT_REL) }
  const keepOwn = source === 'personal' && place === 'local' && own && own !== personalDefault
  return {
    place,
    ticketsDir: normaliseTicketsDir(keepOwn ? own : join(base, 'tickets')),
    auditDir: place === 'chat' ? null : join(base, 'audit'),
  }
}

/** Remember the pick. */
export function rememberPlace(root, source, place, env = process.env) {
  const p = prefsPath(env)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify({ ...readPrefs(env), [prefKey(root, source)]: place }, null, 2)}\n`)
}

// Moves every file under src into dst. A file already at dst is kept; a log (.jsonl) is appended to it.
function moveTree(src, dst, counts) {
  let entries
  try { entries = readdirSync(src) } catch { return }
  mkdirSync(dst, { recursive: true })
  for (const name of entries) {
    const from = join(src, name)
    const to = join(dst, name)
    if (statSync(from).isDirectory()) { moveTree(from, to, counts); continue }
    if (name === '.gitignore') { if (!existsSync(to)) copyFileSync(from, to); unlinkSync(from); continue }
    if (existsSync(to)) {
      if (!name.endsWith('.jsonl')) { counts.kept++; continue }
      appendFileSync(to, readFileSync(from))
    } else {
      try { renameSync(from, to) } catch { copyFileSync(from, to) }
    }
    try { unlinkSync(from) } catch {}
    counts.moved++
  }
  try { rmdirSync(src) } catch {}
}

/**
 * Pick a place: remember it and move what the old place holds (the tickets folder and the audit log)
 * to the new one. Returns { from, to, moved, kept, dirs }.
 */
export function pickPlace(root, opts, place, env = process.env) {
  const from = placeOf(root, opts.source, env)
  const old = placeDirs(root, opts, from, env)
  const next = placeDirs(root, opts, place, env)
  rememberPlace(root, opts.source, place, env)
  const counts = { moved: 0, kept: 0 }
  if (from !== place) {
    const abs = d => resolve(root, d)
    if (abs(old.ticketsDir) !== abs(next.ticketsDir)) moveTree(abs(old.ticketsDir), abs(next.ticketsDir), counts)
    if (old.auditDir && next.auditDir && old.auditDir !== next.auditDir) moveTree(old.auditDir, next.auditDir, counts)
    // Into the chat: the log is not kept, so it goes to the temp folder with the rest.
    if (old.auditDir && !next.auditDir) moveTree(old.auditDir, join(resolve(root, next.ticketsDir), '..', 'audit'), counts)
  }
  return { from, to: place, ...counts, dirs: next }
}
