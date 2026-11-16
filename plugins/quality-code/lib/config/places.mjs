// Where the tickets folder and audit log live: chat (session temp dir, the default), local (this machine,
// under the Claude folder) or repo (git-ignored). Per-person pick, kept in <Claude folder>/quality-code/save.json.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { claudeDir, configHome } from './config.mjs'
import { ignoreFolder } from '../core/ignore.mjs'
import { readJson, readJsonOr } from '../core/files.mjs'
import { cleanRelPath } from '../core/paths.mjs'
import { isObject } from '../core/is.mjs'

export { ignoreFolder }

export const PLACES = ['repo', 'local', 'chat']
export const AUDIT_REL = '.claude/quality-code/audit'
export const CONFIG_FILE = 'config.json'
export const REPO_FOLDER = '.quality-code'
export const FIELDS_FILE = 'jira-fields.json'

export const prefsPath = env => join(claudeDir(env), 'quality-code', 'save.json')
// Personal setup: one pick for every folder. Otherwise one per repo (the folder holding the config),
// so changing setup's project root doesn't ask again.
const prefKey = (root, source, env) => (source === 'personal' ? 'personal' : resolve(configHome(root, env)))
export const short = root => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8)
export const slug = root => (basename(resolve(root)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'project').slice(0, 40)

function readPrefs(env) {
  try {
    const p = readJson(prefsPath(env))
    return isObject(p) ? p : {}
  } catch { return {} }
}

/** null when never asked. */
export function savedPlace(root, source, env = process.env) {
  const prefs = readPrefs(env)
  // A pick saved for the project folder before picks were per repo still counts.
  const v = prefs[prefKey(root, source, env)] ?? (source === 'personal' ? undefined : prefs[resolve(root)])
  return PLACES.includes(v) ? v : null
}

/** A personal setup has no repo to keep files in. */
export const placesFor = source => (source === 'personal' ? ['local', 'chat'] : PLACES)

/** The pick, else QUALITY_CODE_PLACE (for CI or scripts), else chat. */
export function placeOf(root, source, env = process.env) {
  const p = savedPlace(root, source, env)
  if (p && placesFor(source).includes(p)) return p
  const forced = env.QUALITY_CODE_PLACE ?? process.env.QUALITY_CODE_PLACE
  if (!PLACES.includes(forced)) return 'chat'
  // A personal setup has no repo: "repo" means this machine there.
  const place = source === 'personal' && forced === 'repo' ? 'local' : forced
  return placesFor(source).includes(place) ? place : 'chat'
}

/** Out-of-repo folder for this project's files; null for repo. */
function baseOf(root, source, place, env) {
  if (place === 'repo') return null
  if (place === 'chat') return join(tmpdir(), 'quality-code', source === 'personal' ? 'personal' : `${slug(root)}-${short(root)}`)
  return source === 'personal' ? join(claudeDir(env), 'quality-code') : join(claudeDir(env), 'quality-code', 'projects', `${slug(root)}-${short(root)}`)
}

/**
 * The folders a place uses: `ticketsDir` (relative to the root in the repo, else absolute) and `auditDir`
 * (absolute, in every place: the session's audit log lives in its temp folder). The config's own ticketsDir applies in the repo,
 * and for a personal setup that names one.
 */
export function placeDirs(root, { source = 'repo', ticketsDir, personalDefault } = {}, place, env = process.env) {
  place ??= placeOf(root, source, env)
  const base = baseOf(root, source, place, env)
  const own = ticketsDir === undefined ? null : cleanRelPath(ticketsDir)
  if (place === 'repo') return { place, ticketsDir: own ?? '.quality-code/tickets', auditDir: join(resolve(root), AUDIT_REL) }
  const keepOwn = source === 'personal' && place === 'local' && own && own !== personalDefault
  return {
    place,
    ticketsDir: cleanRelPath(keepOwn ? own : join(base, 'tickets')),
    auditDir: join(base, 'audit'),
  }
}

/** Place for the project at home: pick, else QUALITY_CODE_PLACE, else chat. Reads no config. */
function placeAt(home, env) {
  const v = readPrefs(env)[resolve(home)]
  if (PLACES.includes(v)) return v
  const forced = env.QUALITY_CODE_PLACE ?? process.env.QUALITY_CODE_PLACE
  return PLACES.includes(forced) ? forced : 'chat'
}

/** Beside the tickets and audit files in the picked place. Never in .claude, never tracked by git. */
export function placeConfigPath(home, env = process.env, place = placeAt(home, env)) {
  const folder = place === 'repo' ? join(resolve(home), REPO_FOLDER) : baseOf(home, 'repo', place, env)
  return join(folder, CONFIG_FILE)
}

/** Folder holding the home project's setup config, in the place in force. */
export const placeFolder = (home, env = process.env, place) => dirname(placeConfigPath(home, env, place))

export function rememberPlace(root, source, place, env = process.env) {
  const p = prefsPath(env)
  mkdirSync(dirname(p), { recursive: true })
  // Stop on a broken file: rewriting it would drop every other project's pick.
  const prefs = readJsonOr(p, {})
  writeFileSync(p, `${JSON.stringify({ ...(isObject(prefs) ? prefs : {}), [prefKey(root, source, env)]: place }, null, 2)}\n`)
}

// Removes a folder holding only its own .gitignore (what ignoreFolder leaves).
function dropIfEmpty(dir) {
  try {
    if (readdirSync(dir).every(f => f === '.gitignore')) { unlinkSync(join(dir, '.gitignore')); rmdirSync(dir) }
  } catch {}
}

// Existing files at dst are kept; .jsonl logs are appended.
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

/** Saves the pick and moves the tickets folder and audit log over. → { from, to, moved, kept, dirs } */
export function pickPlace(root, opts, place, env = process.env) {
  const from = placeOf(root, opts.source, env)
  const old = placeDirs(root, opts, from, env)
  const next = placeDirs(root, opts, place, env)
  // Before saving: afterwards a subfolder root would look for its config in the new, empty place.
  const home = configHome(root, env)
  rememberPlace(root, opts.source, place, env)
  const counts = { moved: 0, kept: 0 }
  if (from !== place && opts.source !== 'personal') {
    // The setup config and its Jira field file move too; one still in .claude/ stays put.
    const oldFields = join(placeFolder(home, env, from), FIELDS_FILE)
    const newFields = join(placeFolder(home, env, place), FIELDS_FILE)
    if (oldFields !== newFields && existsSync(oldFields)) {
      if (existsSync(newFields)) counts.kept++
      else {
        mkdirSync(dirname(newFields), { recursive: true })
        try { renameSync(oldFields, newFields) } catch { copyFileSync(oldFields, newFields); unlinkSync(oldFields) }
        counts.moved++
      }
      if (place === 'repo') ignoreFolder(dirname(newFields))
    }
    const oldCfg = placeConfigPath(home, env, from)
    const newCfg = placeConfigPath(home, env, place)
    if (oldCfg !== newCfg && existsSync(oldCfg)) {
      if (existsSync(newCfg)) counts.kept++
      else {
        mkdirSync(dirname(newCfg), { recursive: true })
        try { renameSync(oldCfg, newCfg) } catch { copyFileSync(oldCfg, newCfg); unlinkSync(oldCfg) }
        counts.moved++
      }
      if (existsSync(newCfg) && place === 'repo') ignoreFolder(dirname(newCfg))
    }
  }
  if (from !== place) {
    const abs = d => resolve(root, d)
    if (abs(old.ticketsDir) !== abs(next.ticketsDir)) moveTree(abs(old.ticketsDir), abs(next.ticketsDir), counts)
    // A subfolder root's tickets sit outside the ignored .quality-code/: ignore them so raw tickets never reach git.
    if (place === 'repo' && opts.source !== 'personal') ignoreFolder(abs(next.ticketsDir))
    if (old.auditDir && next.auditDir && old.auditDir !== next.auditDir) moveTree(old.auditDir, next.auditDir, counts)
    // Drop the old place's folders once empty.
    if (opts.source !== 'personal') {
      const oldFolder = placeFolder(home, env, from)
      if (oldFolder !== placeFolder(home, env, place)) dropIfEmpty(oldFolder)
    }
    if (from === 'repo') { dropIfEmpty(abs(dirname(AUDIT_REL))); try { rmdirSync(abs('.claude')) } catch {} }
  }
  return { from, to: place, ...counts, dirs: next }
}
