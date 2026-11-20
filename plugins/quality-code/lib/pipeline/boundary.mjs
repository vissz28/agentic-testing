// Boundary: a test-writing run may write tests, never the code under test (hook + diff check).
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { changedPaths } from '../core/git.mjs'
import { result } from './result.mjs'
import { backendOf, BACKENDS } from '../stacks/backends.mjs'
import { ignoreFolder } from '../core/ignore.mjs'
import { readJson } from '../core/files.mjs'
import { stripDotSlash, leavesFolder } from '../core/paths.mjs'
import { isObject } from '../core/is.mjs'
import { escapeRegExp } from '../core/text.mjs'

// Off limits to every run, so it can't disable its own hook or rewrite what judges it.
// STATE is written by our own scripts mid-run, so only the hook guards it, not the diff check.
const STATE = ['.claude/quality-code/run.active', '.claude/quality-code/boundary.jsonl', '.claude/quality-code/audit/']
export const ALWAYS = ['**/dist/', '**/node_modules/', '.git/', '.claude/quality-code.json', '.quality-code/config.json', ...STATE, '.claude/settings.json', '.claude/settings.local.json']
export const DEFAULT_WHY = 'application code: a test run writes tests, it never changes the code under test.'
export const RUN_MARKER = '.claude/quality-code/run.active'
export const BOUNDARY_LOG = '.claude/quality-code/boundary.jsonl'
export const STALE_MS = 12 * 3600 * 1000
export const CI_FILES = ['.gitlab-ci.yml', '.github/workflows/', 'Jenkinsfile', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', '.circleci/']
// Committed env templates hold no secrets; .env.* must not forbid them.
const ENV_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template)$/

const globRe = pattern => new RegExp(`^${pattern
  .split(/(\*\*\/|\*\*|\*)/)
  .map(part => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
  .join('')}$`)

/** Pattern: folder prefix ending in / (matches the folder too), a * / ** glob, or an exact path. */
export function matches(pattern, path) {
  // A glob folder (packages/*/src/) covers itself and everything inside, like a plain one.
  if (pattern.includes('*') && pattern.endsWith('/')) return globRe(`${pattern}**`).test(path) || globRe(pattern.slice(0, -1)).test(path)
  if (pattern.includes('*')) return globRe(pattern).test(path)
  if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern)
  return path === pattern
}

/** An allow glob reaches into folder (a src/ rule for *.unit.test.js covers src/), so it may hold tests. */
export function allowCovers(allow, folder) {
  const f = stripDotSlash(folder)
  return (allow ?? []).some(a => {
    const lit = stripDotSlash(a).split('*')[0]
    return a.includes('*') && (lit.startsWith(f) || f.startsWith(lit))
  })
}

const WORKSPACE_SRC = ['packages/*/src/', 'apps/*/src/']

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

// Playwright screenshot baselines (<spec>-snapshots/*.png) are test data: writable even in a forbidden folder.
const BASELINE_IMAGE = /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?-snapshots\/[^/]+\.png$/

const norm = stripDotSlash

// Where each backend's tests live, so app code named like a test (src/main/java/LabTest.java, app/ab_test.py) stays forbidden.
// Go keeps _test.go beside the code: anywhere. The backend's layer folders count too.
const TEST_HOME = {
  junit: /(?:^|\/)src\/(?:[^/]*[tT]est[^/]*|it)\//,
  pytest: /(?:^|\/)tests?\//,
  dotnet: /(?:^|\/)(?:[^/]*Tests?|tests?)\//,
}

/** Non-Vitest backends keep tests in the code tree (Maven src/test/java, Go): allow their test files there. Vitest uses `allow`. */
export function testsAnywhere(config) {
  const b = backendOf(config)
  if (!b || b === 'vitest') return null
  const name = BACKENDS[b].testFile
  const home = TEST_HOME[b]
  if (!home) return name
  // Not layersOf: config.mjs imports this file.
  const layers = Array.isArray(config[b]?.layers) ? config[b].layers : BACKENDS[b].defaultLayers
  const folders = layers.map(l => norm(String(l?.folder ?? '')).replace(/^\.$/, '').replace(/\/*$/, '/'))
  // A "./" layer puts the tests beside the code, like Go.
  if (folders.includes('/')) return name
  return { test: p => name.test(p) && (home.test(p) || folders.some(f => matches(f, p))) }
}

export function rulesFor(config, root) {
  const forbidden = config.boundaries?.forbidden ?? defaultForbidden(root)
  return { forbidden: forbidden.map(r => ({ ...r, path: norm(r.path) })), allow: (config.boundaries?.allow ?? []).map(norm), tests: testsAnywhere(config) }
}

/** fold: case-insensitive disk (macOS, Windows), .ENV is .env. Forbidden rules match any case, allow rules exact case. */
export function violation(relPath, rules, { fold = false } = {}) {
  const p = stripDotSlash(relPath ?? '')
  if (!p || leavesFolder(p)) return null
  const hit = (pattern, path) => (fold ? matches(pattern.toLowerCase(), path.toLowerCase()) : matches(pattern, path))
  if (ALWAYS.some(a => hit(a, p))) return { path: p, why: 'never written by a test run.' }
  if (rules.allow.some(a => matches(a, p))) return null
  if (rules.tests?.test(p)) return null
  if (BASELINE_IMAGE.test(p)) return null
  const rule = rules.forbidden.find(r => hit(r.path, p) && !(r.path.includes('*') && ENV_TEMPLATE.test(p)))
  return rule ? { path: p, why: rule.why ?? DEFAULT_WHY } : null
}

/** Age from startedAt, falling back to the file's mtime if the marker is unreadable. */
export function readRunMarker(root, now = Date.now()) {
  const p = join(root, RUN_MARKER)
  let st
  try { st = statSync(p) } catch { return null }
  let marker = null
  try {
    const m = readJson(p)
    if (isObject(m)) marker = m
  } catch {}
  const t = typeof marker?.startedAt === 'string' ? Date.parse(marker.startedAt) : NaN
  const startedMs = Number.isFinite(t) ? t : st.mtimeMs
  return { marker, startedMs, stale: now - startedMs >= STALE_MS }
}

export function runActive(root, now = Date.now()) {
  const m = readRunMarker(root, now)
  return Boolean(m && !m.stale)
}

/** Real path (symlinks, stored case, /tmp -> /private/tmp); a not-yet-written file resolves via its deepest existing folder. */
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

const FOLDS = process.platform === 'darwin' || process.platform === 'win32'

// Bash: a shell line can't be parsed safely, so only the boundary's own state is guarded, by name. It stops `rm run.active`
// and `> .claude/settings.local.json`, not a determined script; the diff check still judges the run at the end.
const WHY_STATE = 'the boundary\'s own state: a test run never removes its run marker, log or audit, or rewrites the config and settings that set its rules. `checks.mjs run status` shows the run.'
const STATE_NAME = /run\.active|boundary\.jsonl|quality-code[\\/]+audit(?![\w-])/i
const RULE_FILE = /(?:\.claude[\\/]+quality-code\.json|\.quality-code[\\/]+config\.json|\.claude[\\/]+settings(?:\.local)?\.json)/i
const STATE_FOLDER = /(?:^|[\s'"=/\\])(\.claude(?:[\\/]+quality-code)?)[\\/]*\*?(?=$|[\s'";&|)])/i
const VERB = String.raw`(?:^|[\s;&|(\x60])`
const WRITES = new RegExp(`${VERB}(?:rm|rmdir|mv|cp|ln|unlink|shred|truncate|tee|dd|install|del|erase|rd|move|copy|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File)\\b|\\bsed\\b[^;&|]*\\s-[a-zA-Z]*i|\\bperl\\b[^;&|]*\\s-[a-zA-Z]*i`, 'i')
const DESTROYS = new RegExp(`${VERB}(?:rm|rmdir|mv|unlink|shred|del|erase|rd|move|Remove-Item|Move-Item)\\b|\\bfind\\b[^;&|]*\\s-delete\\b`, 'i')
const GIT_CLEAN_IGNORED = /\bgit\s+clean\b[^;&|]*\s-[a-zA-Z]*[xX]/

/** The state path a Bash line touches, else null. */
export function bashTouchesState(command) {
  const c = String(command ?? '')
  const name = STATE_NAME.exec(c)
  if (name) return name[0]
  const rule = RULE_FILE.exec(c)
  const into = rule && new RegExp(`>\\s*['"]?[^\\s;&|'"]*${escapeRegExp(rule[0])}`, 'i').test(c)
  if (rule && (into || WRITES.test(c))) return rule[0]
  const folder = STATE_FOLDER.exec(c)
  if (folder && DESTROYS.test(c)) return folder[1]
  // .claude/quality-code ignores itself, so only an -x/-X clean removes the marker.
  if (GIT_CLEAN_IGNORED.test(c)) return '.claude/quality-code/'
  return null
}

/**
 * home: config folder (above root when config.root names a subfolder). runRoots: folders whose marker counts.
 * guarded: files outside the project a run must not write. A broken config falls back to default rules, so it can't disable the hook.
 */
export function hookDecision(payload, { root, home = root, config, now = Date.now(), runRoots = [root], guarded = [], fold = FOLDS }) {
  const command = payload?.tool_name === 'Bash' ? payload?.tool_input?.command : null
  if (typeof command === 'string') {
    if (!runRoots.some(r => runActive(r, now))) return { decision: 'allow' }
    const hit = bashTouchesState(command)
    return hit ? { decision: 'deny', path: hit, why: WHY_STATE } : { decision: 'allow' }
  }
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  // Not a path: the tool itself rejects the call.
  if (!target || typeof target !== 'string' || !runRoots.some(r => runActive(r, now))) return { decision: 'allow' }
  // Compare real paths: SRC/a.ts, symlinks and /tmp aliases can all reach src/a.ts.
  const file = onDisk(resolve(root, target))
  const same = (a, b) => (fold ? a.toLowerCase() === b.toLowerCase() : a === b)
  const g = guarded.find(p => same(onDisk(p), file))
  const v = violation(relative(onDisk(root), file), rulesFor(config ?? {}, root), { fold })
    // Config and Claude settings at home are off limits even though they're outside the project.
    ?? (home === root ? null : violation(relative(onDisk(home), file), { forbidden: [], allow: [] }, { fold }))
    ?? (g ? { path: g, why: 'never written by a test run.' } : null)
  return v ? { decision: 'deny', path: v.path, why: v.why } : { decision: 'allow' }
}

export function hookReason(path, why) {
  return `Blocked by the quality-code boundary: ${path} is off limits during a test run.\n\n${why}\n\nThe attempt is recorded in ${BOUNDARY_LOG}. If the change genuinely belongs there, ask the user; do not work around it.`
}

/** Best effort: a failed log write must not affect the hook's decision. */
export function logBlocked(root, entry) {
  try {
    const p = join(root, BOUNDARY_LOG)
    ignoreFolder(dirname(p))
    appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
  } catch {}
}

const hashOf = (root, p) => {
  try { return createHash('sha1').update(readFileSync(join(root, p))).digest('hex') } catch { return null }
}

/** Changed/untracked path -> content hash (null if deleted), taken at run start. */
export function snapshot(root) {
  const c = changedPaths(root)
  return c.ok ? Object.fromEntries(c.paths.map(p => [p, hashOf(root, p)])) : null
}

/** Without a range, diff against the run-start snapshot so the developer's prior edits aren't blamed on the run. */
function writtenPaths(root, range) {
  const c = changedPaths(root, range)
  if (!c.ok || range) return c
  const before = readRunMarker(root)?.marker?.dirty
  if (!before || typeof before !== 'object') return c
  const paths = [...new Set([...c.paths, ...Object.keys(before)])]
  return { ok: true, paths: paths.filter(p => !(p in before) || before[p] !== hashOf(root, p)) }
}

// ponytail: reads the project only; with a root field, the config and settings at the top are guarded by the
// hook alone. Diff the top's ALWAYS paths here (with run start's snapshot) if a run writes them another way.
export function run({ range = null }, ctx) {
  const c = writtenPaths(ctx.root, range)
  if (!c.ok) return result('boundary', 'not_run', `cannot read the changed files: ${c.error}`)
  const rules = rulesFor(ctx.config, ctx.root)
  const hits = c.paths.filter(p => !STATE.some(s => matches(s, p))).map(p => violation(p, rules)).filter(Boolean)
  const data = { mode: 'diff', paths: c.paths.length }
  if (!hits.length) return result('boundary', 'pass', `${c.paths.length} changed file(s), all in the allowed test paths`, [], data)
  return result('boundary', 'fail', `${hits.length} write(s) outside the allowed test paths`, hits.map(h => ({ file: h.path, kind: 'forbidden write', detail: h.why })), data)
}
