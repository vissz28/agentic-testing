// The only git calls the checks make. Read-only; never takes the index lock.
import { execFileSync } from 'node:child_process'

function git(root, args, okCodes = []) {
  try {
    const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1e8, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    return { ok: true, out }
  } catch (err) {
    if (okCodes.includes(err.status)) return { ok: true, out: String(err.stdout ?? '') }
    return { ok: false, error: String(err.stderr || err.message).trim().split('\n')[0] }
  }
}

const badRange = range => (range && String(range).startsWith('-') ? { ok: false, error: 'range must not start with "-"' } : null)

/** Unified diff of the given paths, against HEAD or over a range like A...B. */
export function specDiff(root, paths, range = null) {
  const bad = badRange(range)
  if (bad) return bad
  const r = git(root, ['diff', ...(range ? [range] : ['HEAD']), '--', ...paths])
  if (!r.ok) return r
  let diff = r.out
  if (!range) {
    // An untracked spec has no diff against HEAD: read it as all added lines (exit 1 means "differs").
    for (const p of paths) {
      if (git(root, ['ls-files', '--error-unmatch', '--', p]).ok) continue
      const n = git(root, ['diff', '--no-index', '--', '/dev/null', p], [1])
      if (n.ok) diff += n.out
    }
  }
  return { ok: true, diff }
}

/** Every path changed against HEAD (or over a range), plus untracked files; relative to root. */
export function changedPaths(root, range = null) {
  const bad = badRange(range)
  if (bad) return bad
  const d = git(root, ['diff', '--name-only', '--no-renames', '--relative', '-z', ...(range ? [range] : ['HEAD'])])
  if (!d.ok) return d
  const u = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (!u.ok) return u
  const paths = `${d.out}\0${u.out}`.split('\0').filter(Boolean)
  return { ok: true, paths: [...new Set(paths)] }
}
