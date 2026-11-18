// Every git call the plugin makes. Never takes an optional lock, never waits on a password prompt.
import { execFileSync } from 'node:child_process'

// The user's git config must not change what the checks read: a colored or external diff hides
// every removed expect from the honesty check, a quoted path misses the boundary rules.
const PLAIN = ['-c', 'color.ui=never', '-c', 'color.diff=never', '-c', 'core.quotePath=false']

/**
 * Runs git in root. → { ok: true, out } | { ok: false, out, error }: out is what git printed, error the first line of its complaint.
 * okCodes: exit codes that still count as success (git diff --no-index exits 1 when the files differ).
 */
export function git(root, args, { okCodes = [], input, timeout } = {}) {
  try {
    const out = execFileSync('git', [...PLAIN, ...args], { cwd: root, input, timeout, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 1e8, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
    return { ok: true, out }
  } catch (err) {
    const out = String(err.stdout ?? '')
    if (okCodes.includes(err.status)) return { ok: true, out }
    return { ok: false, out, error: String(err.stderr || err.message).trim().split('\n')[0] }
  }
}

/** What git printed without the closing newline (a leading space stays: status lines start with one); null when git fails. */
export const gitOut = (root, args) => { const r = git(root, args); return r.ok ? r.out.replace(/\n$/, '') : null }

/** A remote URL without its user:password@ part; null for none. */
export function stripCredentials(url) {
  if (!url) return null
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/** HEAD, or git's empty tree in a repo with no commit yet: there every line of a file reads as added. */
function head(root) {
  if (git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok) return 'HEAD'
  const r = git(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })
  return r.ok ? r.out.trim() : 'HEAD'
}

const badRange = range => (range && String(range).startsWith('-') ? { ok: false, error: 'range must not start with "-"' } : null)

/** Unified diff of the given paths, against HEAD or over a range like A...B. */
export function specDiff(root, paths, range = null) {
  const bad = badRange(range)
  if (bad) return bad
  const r = git(root, ['diff', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', range ?? head(root), '--', ...paths])
  if (!r.ok) return r
  let diff = r.out
  if (!range) {
    // An untracked spec has no diff against HEAD: read it as all added lines (exit 1 means "differs").
    for (const p of paths) {
      if (git(root, ['ls-files', '--error-unmatch', '--', p]).ok) continue
      const n = git(root, ['diff', '--no-index', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', '/dev/null', p], { okCodes: [1] })
      if (n.ok) diff += n.out
    }
  }
  return { ok: true, diff }
}

/** Every path changed against HEAD (or over a range), plus untracked files; relative to root. */
export function changedPaths(root, range = null) {
  const bad = badRange(range)
  if (bad) return bad
  const d = git(root, ['diff', '--name-only', '--no-renames', '--relative', '-z', range ?? head(root)])
  if (!d.ok) return d
  const u = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (!u.ok) return u
  const paths = `${d.out}\0${u.out}`.split('\0').filter(Boolean)
  return { ok: true, paths: [...new Set(paths)] }
}

/**
 * Paths this branch changed: committed since it left its base, not committed yet, and untracked; relative to root.
 * The base is base (origin/ first), else origin/HEAD, main or master; with none, only what is not committed yet.
 * null outside a git repo.
 */
export function branchChangedPaths(root, base = null) {
  if (gitOut(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null
  const tries = [base && `origin/${base}`, base, gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']), 'origin/main', 'origin/master', 'main', 'master']
  const ref = tries.find(r => r && !r.startsWith('-') && git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).ok)
  const fork = ref ? gitOut(root, ['merge-base', 'HEAD', ref]) : null
  const r = changedPaths(root, fork || null)
  return r.ok ? r.paths : null
}
