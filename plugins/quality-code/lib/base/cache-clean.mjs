// Cleans the plugin's own local cache: the progress, context and saved-language files under
// <Claude folder>/quality-code/progress/<slug-hash>/. Nothing else is ever listed or deleted: not the
// config, tickets, specs or audit log. Every path is checked to sit inside the cache folder (real path, no
// symlink escape, no `..`) before it is touched; a symlink is skipped, never followed or removed.
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, rmdirSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { dirOf, short, slug } from './progress.mjs'

const inside = (base, p) => { const r = relative(base, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r) }

// The real cache folder, or null when it does not exist or is itself a link (a link could lead anywhere).
function realBase(env) {
  const base = dirOf(env)
  try {
    const st = lstatSync(base)
    if (!st.isDirectory() || st.isSymbolicLink()) return null
    return realpathSync(base)
  } catch { return null }
}

function projectFolders(base, root, all) {
  if (!all) {
    const name = `${slug(root)}-${short(root)}`
    return existsSync(join(base, name)) ? [name] : []
  }
  return readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name).sort()
}

function walk(base, dir, files, skipped) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isSymbolicLink()) { skipped.push(p); continue }
    if (e.isDirectory()) { walk(base, p, files, skipped); continue }
    if (!e.isFile()) { skipped.push(p); continue }
    let real
    try { real = realpathSync(p) } catch { skipped.push(p); continue }
    if (real !== p || !inside(base, real)) { skipped.push(p); continue }
    files.push({ path: p, bytes: lstatSync(p).size })
  }
}

/** What would be deleted: this project's cache, or every project's with `all`. Touches nothing. */
export function listCache(root, { all = false, env = process.env } = {}) {
  const base = realBase(env)
  const empty = { ok: true, all, dir: dirOf(env), projects: [], files: 0, bytes: 0, skipped: 0, _paths: [], _dirs: [] }
  if (!base) return empty
  const projects = []
  let skipped = 0
  for (const name of projectFolders(base, root, all)) {
    const dir = join(base, name)
    if (!inside(base, dir) || realpathSync(dir) !== dir) { skipped++; continue }
    const files = []
    const skip = []
    walk(base, dir, files, skip)
    skipped += skip.length
    projects.push({ name, dir, files })
  }
  const sum = f => projects.reduce((n, p) => n + p.files.reduce((m, x) => m + f(x), 0), 0)
  return {
    ok: true, all, dir: base, skipped,
    projects: projects.map(p => ({ name: p.name, files: p.files.length, bytes: p.files.reduce((n, f) => n + f.bytes, 0) })),
    files: sum(() => 1), bytes: sum(f => f.bytes),
    _paths: projects.flatMap(p => p.files.map(f => f.path)), _dirs: projects.map(p => p.dir),
  }
}

function pruneEmpty(base, dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.isSymbolicLink()) pruneEmpty(base, join(dir, e.name))
  if (inside(base, dir) && readdirSync(dir).length === 0) rmdirSync(dir)
}

/** Delete exactly what `listCache` shows, then the project folders it leaves empty. */
export function deleteCache(root, { all = false, env = process.env } = {}) {
  const l = listCache(root, { all, env })
  const base = realBase(env)
  let deleted = 0
  let bytes = 0
  if (base) {
    for (const p of l._paths) {
      if (!inside(base, p)) continue // never outside the cache folder
      try {
        const st = lstatSync(p)
        if (!st.isFile()) continue
        rmSync(p, { force: true })
        deleted++
        bytes += st.size
      } catch { /* gone already */ }
    }
    for (const d of l._dirs) { try { pruneEmpty(base, d) } catch { /* not empty or gone */ } }
  }
  return { ok: true, all, dir: l.dir, deleted, bytes, projects: l.projects.length, skipped: l.skipped }
}

export const human = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
export const strip = ({ _paths, _dirs, ...rest }) => rest
