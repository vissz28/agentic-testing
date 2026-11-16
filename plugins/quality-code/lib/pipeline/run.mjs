// Marker for an active test-writing run; the boundary hook acts only while one exists.
import { mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RUN_MARKER, readRunMarker, snapshot } from './boundary.mjs'
import { ignoreFolder } from '../core/ignore.mjs'
import { gitOut } from '../core/git.mjs'

/** null outside a git repo or before the first commit. */
export function gitHead(root) {
  const sha = gitOut(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])?.trim() ?? ''
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null
}

/** Refuses while a fresh marker exists; a stale one (older than STALE_MS) is replaced. */
export function startRun(root, key, now = Date.now()) {
  const p = join(root, RUN_MARKER)
  const cur = readRunMarker(root, now)
  if (cur && !cur.stale) {
    const who = typeof cur.marker?.key === 'string' && cur.marker.key ? cur.marker.key : 'an unknown key'
    return { ok: false, error: `a run for ${who} is active: finish it or run 'run stop'` }
  }
  if (cur) rmSync(p, { force: true })
  // dirty: files changed before the run, so the boundary check ignores them.
  const marker = { key, startedAt: new Date(now).toISOString(), base: gitHead(root), dirty: snapshot(root) }
  ignoreFolder(dirname(p))
  try {
    writeFileSync(p, `${JSON.stringify(marker)}\n`, { flag: 'wx' })
  } catch (e) {
    if (e?.code === 'EEXIST') return { ok: false, error: `a run is active: finish it or run 'run stop'` }
    throw e
  }
  return { ok: true, marker, replacedStale: Boolean(cur) }
}

export function stopRun(root) {
  const had = readRunMarker(root) !== null
  rmSync(join(root, RUN_MARKER), { force: true })
  // Don't leave an empty marker folder behind (it only held the marker and its .gitignore).
  const dir = join(root, dirname(RUN_MARKER))
  try {
    if (readdirSync(dir).every(f => f === '.gitignore')) { rmSync(join(dir, '.gitignore'), { force: true }); rmdirSync(dir) }
    rmdirSync(join(root, '.claude'))
  } catch {}
  return { removed: had }
}

export function runStatus(root, now = Date.now()) {
  const cur = readRunMarker(root, now)
  if (!cur) return { active: false, stale: false, marker: null }
  return { active: !cur.stale, stale: cur.stale, marker: cur.marker, startedAt: new Date(cur.startedMs).toISOString() }
}

export function statusLine(s) {
  if (!s.active && !s.stale) return 'no active run'
  const key = s.marker?.key ?? 'unknown key'
  const base = s.marker?.base ? `, base ${s.marker.base}` : ''
  return s.stale
    ? `stale run for ${key} since ${s.startedAt}${base} (older than 12 hours: ignored by the hook, replaced by 'run start')`
    : `active run for ${key} since ${s.startedAt}${base}`
}
