// The run marker: `run start` opens a test-writing run (the boundary hook then acts), `run stop`
// closes it, `run status` shows it. A marker older than STALE_MS is ignored and replaced.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RUN_MARKER, readRunMarker, snapshot } from './boundary.mjs'

/** HEAD of the repository at root, or null when it is not a git repo or has no commit. */
export function gitHead(root) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const sha = r.status === 0 ? String(r.stdout).trim() : ''
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null
}

/**
 * Write the marker for key. Refuses while a fresh marker exists; a stale one is replaced.
 * → { ok: true, marker, replacedStale } | { ok: false, error }
 */
export function startRun(root, key, now = Date.now()) {
  const p = join(root, RUN_MARKER)
  const cur = readRunMarker(root, now)
  if (cur && !cur.stale) {
    const who = typeof cur.marker?.key === 'string' && cur.marker.key ? cur.marker.key : 'an unknown key'
    return { ok: false, error: `a run for ${who} is active: finish it or run 'run stop'` }
  }
  if (cur) rmSync(p, { force: true })
  // dirty: what was already changed before the run, so the boundary check does not count it.
  const marker = { key, startedAt: new Date(now).toISOString(), base: gitHead(root), dirty: snapshot(root) }
  mkdirSync(dirname(p), { recursive: true })
  try {
    writeFileSync(p, `${JSON.stringify(marker)}\n`, { flag: 'wx' })
  } catch (e) {
    if (e?.code === 'EEXIST') return { ok: false, error: `a run is active: finish it or run 'run stop'` }
    throw e
  }
  return { ok: true, marker, replacedStale: Boolean(cur) }
}

/** Remove the marker; idempotent. → { removed } */
export function stopRun(root) {
  const had = readRunMarker(root) !== null
  rmSync(join(root, RUN_MARKER), { force: true })
  return { removed: had }
}

/** → { active: false, stale: false, marker: null } | { active, stale, marker, startedAt } */
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
