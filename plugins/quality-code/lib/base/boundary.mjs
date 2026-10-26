// Boundary: a test-writing run writes tests, never the code under test. Path rules from the
// config; a hook that only acts while a run is active; a diff mode that is the check that counts.
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { changedPaths } from './git.mjs'
import { result } from './result.mjs'
import { backendOf, BACKENDS } from './backends.mjs'

// Never written by a test run: build output and packages at any depth (monorepos), git, and the
// plugin's own state, so a run cannot switch its own hook off or rewrite what it is judged by.
// The plugin's scripts write their state during a run, so only the hook guards it, not the diff check.
const STATE = ['.claude/quality-code/run.active', '.claude/quality-code/boundary.jsonl', '.claude/quality-code/audit/']
export const ALWAYS = ['**/dist/', '**/node_modules/', '.git/', '.claude/quality-code.json', ...STATE, '.claude/settings.json', '.claude/settings.local.json']
export const DEFAULT_WHY = 'application code: a test run writes tests, it never changes the code under test.'
export const RUN_MARKER = '.claude/quality-code/run.active'
export const BOUNDARY_LOG = '.claude/quality-code/boundary.jsonl'
export const STALE_MS = 12 * 3600 * 1000
export const CI_FILES = ['.gitlab-ci.yml', '.github/workflows/', 'Jenkinsfile', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', '.circleci/']
// Committed examples of an env file, with no real values: a pattern like .env.* never forbids them.
const ENV_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template)$/

const globRe = pattern => new RegExp(`^${pattern
  .split(/(\*\*\/|\*\*|\*)/)
  .map(part => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
  .join('')}$`)

/** A prefix ending in / (also matches the folder itself), a glob with * or **, or an exact path. */
export function matches(pattern, path) {
  // A glob folder (packages/*/src/) covers the folder and everything inside it, as a plain one does.
  if (pattern.includes('*') && pattern.endsWith('/')) return globRe(`${pattern}**`).test(path) || globRe(pattern.slice(0, -1)).test(path)
  if (pattern.includes('*')) return globRe(pattern).test(path)
  if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern)
  return path === pattern
}

// The code folders of a workspace monorepo, when it has one.
const WORKSPACE_SRC = ['packages/*/src/', 'apps/*/src/']

// What a test run must leave alone besides the code, each with its reason: the packages a project
// depends on, its secrets and environment, its CI.
export const DEPENDENCY_FILES = [
  '**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/bun.lockb',
  '**/pyproject.toml', '**/requirements*.txt', '**/Pipfile', '**/Pipfile.lock', '**/poetry.lock', '**/setup.py', '**/setup.cfg',
  '**/pom.xml', '**/build.gradle', '**/build.gradle.kts', '**/settings.gradle', '**/settings.gradle.kts', '**/gradle.lockfile',
  '**/go.mod', '**/go.sum',
  '**/*.csproj', '**/*.fsproj', '**/*.sln', '**/Directory.Packages.props', '**/packages.lock.json',
]
const WHY_DEPENDENCIES = 'dependencies: a test run uses the project\'s own tools; it never adds, removes or upgrades a package.'
const WHY_ENV = 'secrets and environment: a test run never changes the project\'s environment files.'
const WHY_CI = 'CI configuration: a test run never changes how the project is built or checked.'

export function defaultForbidden(root) {
  return [
    { path: 'src/' },
    ...WORKSPACE_SRC.filter(p => existsSync(join(root, p.split('/')[0]))).map(path => ({ path })),
    { path: '**/.env', why: WHY_ENV }, { path: '**/.env.*', why: WHY_ENV },
    ...CI_FILES.filter(p => existsSync(join(root, p))).map(path => ({ path, why: WHY_CI })),
    ...DEPENDENCY_FILES.map(path => ({ path, why: WHY_DEPENDENCIES })),
  ]
}

const norm = p => String(p).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')

/**
 * The test file names a run may write even inside a forbidden folder: those of a backend other than
 * Vitest, whose tests live in the code tree (Maven's src/test/java/, Go beside the code). A Vitest
 * project keeps its rules as they are: an exception there is an "allow" entry.
 */
export function testsAnywhere(config) {
  const b = backendOf(config)
  return b && b !== 'vitest' ? BACKENDS[b].testFile : null
}

export function rulesFor(config, root) {
  const forbidden = config.boundaries?.forbidden ?? defaultForbidden(root)
  return { forbidden: forbidden.map(r => ({ ...r, path: norm(r.path) })), allow: (config.boundaries?.allow ?? []).map(norm), tests: testsAnywhere(config) }
}

export function violation(relPath, rules) {
  const p = String(relPath ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p || p.startsWith('../') || p === '..' || isAbsolute(p)) return null
  if (ALWAYS.some(a => matches(a, p))) return { path: p, why: 'never written by a test run.' }
  if (rules.allow.some(a => matches(a, p))) return null
  if (rules.tests?.test(p)) return null
  const rule = rules.forbidden.find(r => matches(r.path, p) && !(r.path.includes('*') && ENV_TEMPLATE.test(p)))
  return rule ? { path: p, why: rule.why ?? DEFAULT_WHY } : null
}

/**
 * The run marker as written by `run start`: { marker, startedMs, stale }, or null when there is none.
 * Age comes from the marker's startedAt; a marker that is not JSON or has no valid startedAt falls
 * back to the file's mtime.
 */
export function readRunMarker(root, now = Date.now()) {
  const p = join(root, RUN_MARKER)
  let st
  try { st = statSync(p) } catch { return null }
  let marker = null
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'))
    if (m && typeof m === 'object' && !Array.isArray(m)) marker = m
  } catch {}
  const t = typeof marker?.startedAt === 'string' ? Date.parse(marker.startedAt) : NaN
  const startedMs = Number.isFinite(t) ? t : st.mtimeMs
  return { marker, startedMs, stale: now - startedMs >= STALE_MS }
}

export function runActive(root, now = Date.now()) {
  const m = readRunMarker(root, now)
  return Boolean(m && !m.stale)
}

/**
 * The path on disk as the filesystem knows it: symlinks followed, the case a case-insensitive disk
 * stores, /tmp as /private/tmp. A file not written yet keeps its name under its deepest existing folder.
 */
export function onDisk(p) {
  const tail = []
  let cur = resolve(p)
  for (;;) {
    try { return join(realpathSync.native(cur), ...tail.reverse()) } catch {}
    const up = dirname(cur)
    if (up === cur) return resolve(p)
    tail.push(basename(cur))
    cur = up
  }
}

export function hookDecision(payload, { root, config, now = Date.now() }) {
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  if (!target || !config || !runActive(root, now)) return { decision: 'allow' }
  // SRC/a.ts, a symlinked folder or the /tmp alias reach the same file as src/a.ts: compare the real paths.
  const v = violation(relative(onDisk(root), onDisk(resolve(root, target))), rulesFor(config, root))
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

const hashOf = (root, p) => {
  try { return createHash('sha1').update(readFileSync(join(root, p))).digest('hex') } catch { return null }
}

/** Every changed or untracked path with the hash of its content (null: deleted), as run start records it. */
export function snapshot(root) {
  const c = changedPaths(root)
  return c.ok ? Object.fromEntries(c.paths.map(p => [p, hashOf(root, p)])) : null
}

/**
 * The paths a run wrote: without a range, those whose state differs from the snapshot run start took,
 * so an edit the developer already had is not the run's (and one the run reverted is). With a range,
 * or a marker without a snapshot, every changed path.
 */
function writtenPaths(root, range) {
  const c = changedPaths(root, range)
  if (!c.ok || range) return c
  const before = readRunMarker(root)?.marker?.dirty
  if (!before || typeof before !== 'object') return c
  const paths = [...new Set([...c.paths, ...Object.keys(before)])]
  return { ok: true, paths: paths.filter(p => !(p in before) || before[p] !== hashOf(root, p)) }
}

export function run({ range = null }, ctx) {
  const c = writtenPaths(ctx.root, range)
  if (!c.ok) return result('boundary', 'not_run', `cannot read the changed files: ${c.error}`)
  const rules = rulesFor(ctx.config, ctx.root)
  const hits = c.paths.filter(p => !STATE.some(s => matches(s, p))).map(p => violation(p, rules)).filter(Boolean)
  const data = { mode: 'diff', paths: c.paths.length }
  if (!hits.length) return result('boundary', 'pass', `${c.paths.length} changed file(s), none outside the boundary`, [], data)
  return result('boundary', 'fail', `${hits.length} write(s) outside the boundary`, hits.map(h => ({ file: h.path, kind: 'forbidden write', detail: h.why })), data)
}
