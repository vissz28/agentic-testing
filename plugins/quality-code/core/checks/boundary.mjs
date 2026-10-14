// Boundary: a test-writing run writes tests, never the code under test. Path rules from the
// config; a hook that only acts while a run is active; a diff mode that is the check that counts.
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { changedPaths } from './git.mjs'
import { result } from './result.mjs'

export const ALWAYS = ['dist/', 'node_modules/', '.git/', '.claude/quality-code.json']
export const DEFAULT_WHY = 'application code: a test run writes tests, it never changes the code under test.'
export const RUN_MARKER = '.claude/quality-code/run.active'
export const BOUNDARY_LOG = '.claude/quality-code/boundary.jsonl'
export const STALE_MS = 6 * 3600 * 1000
const CI_FILES = ['.gitlab-ci.yml', '.github/workflows/']

const globRe = pattern => new RegExp(`^${pattern
  .split(/(\*\*\/|\*\*|\*)/)
  .map(part => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
  .join('')}$`)

/** A prefix ending in / (also matches the folder itself), a glob with * or **, or an exact path. */
export function matches(pattern, path) {
  if (pattern.includes('*')) return globRe(pattern).test(path)
  if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern)
  return path === pattern
}

export function defaultForbidden(root) {
  return [{ path: 'src/' }, { path: '.env' }, { path: '.env.*' }, ...CI_FILES.filter(p => existsSync(join(root, p))).map(path => ({ path }))]
}

export function rulesFor(config, root) {
  return { forbidden: config.boundaries?.forbidden ?? defaultForbidden(root), allow: config.boundaries?.allow ?? [] }
}

export function violation(relPath, rules) {
  const p = String(relPath ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p || p.startsWith('../') || p === '..' || isAbsolute(p)) return null
  if (ALWAYS.some(a => matches(a, p))) return { path: p, why: 'never written by a test run.' }
  if (rules.allow.some(a => matches(a, p))) return null
  const rule = rules.forbidden.find(r => matches(r.path, p))
  return rule ? { path: p, why: rule.why ?? DEFAULT_WHY } : null
}

export function runActive(root, now = Date.now()) {
  try { return now - statSync(join(root, RUN_MARKER)).mtimeMs < STALE_MS } catch { return false }
}

export function hookDecision(payload, { root, config, now = Date.now() }) {
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  if (!target || !config || !runActive(root, now)) return { decision: 'allow' }
  const v = violation(relative(root, resolve(root, target)), rulesFor(config, root))
  return v ? { decision: 'deny', path: v.path, why: v.why } : { decision: 'allow' }
}

export function hookReason(path, why) {
  return `Blocked by the quality-code boundary: ${path} is off limits during a test run.\n\n${why}\n\nThe attempt is recorded in ${BOUNDARY_LOG}. If the change genuinely belongs there, ask the user; do not work around it.`
}

/** One line per refused write. A failed log write never decides whether a tool runs. */
export function logBlocked(root, entry) {
  try {
    const p = join(root, BOUNDARY_LOG)
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
  } catch {}
}

export function run({ range = null }, ctx) {
  const c = changedPaths(ctx.root, range)
  if (!c.ok) return result('boundary', 'not_run', `cannot read the changed files: ${c.error}`)
  const rules = rulesFor(ctx.config, ctx.root)
  const hits = c.paths.map(p => violation(p, rules)).filter(Boolean)
  const data = { mode: 'diff', paths: c.paths.length }
  if (!hits.length) return result('boundary', 'pass', `${c.paths.length} changed file(s), none outside the boundary`, [], data)
  return result('boundary', 'fail', `${hits.length} write(s) outside the boundary`, hits.map(h => ({ file: h.path, kind: 'forbidden write', detail: h.why })), data)
}
