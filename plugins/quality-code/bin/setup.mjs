// Deterministic half of the setup command: --detect scans the repo (read-only), --write validates and
// writes, --smoke runs the smoke test setup writes for a frontend that had no Playwright, and
// --vitest-overlap lists the e2e specs the project's own Vitest run would pick up too.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripCredentials } from './branch.mjs'
import { CONFIG_REL, DEFAULTS, configPath, loadConfig, normaliseTicketsDir, personalConfigPath, timeoutSecondsOf, validateConfig } from '../lib/base/config.mjs'
import { FIELDS_REL } from '../lib/ticket/fields.mjs'
import { CONFIG_FILES, DEFAULT_E2E_FOLDER, e2eFolder, readTestDir } from '../lib/base/e2e-folder.mjs'
import { PLAIN } from '../lib/base/git.mjs'
import { CI_FILES } from '../lib/base/boundary.mjs'
import { asAdapter } from '../lib/base/stack.mjs'
import { configFor, runPlaywright } from '../lib/pipeline/runners/playwright.mjs'
import { toolScript } from '../lib/pipeline/runners/tool.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'

// Found in this order; a new one is written where the repo's host keeps issue templates.
const TEMPLATE_CANDIDATES = {
  bug: ['.gitlab/issue_templates/Bug.md', '.github/ISSUE_TEMPLATE/bug.md', '.github/ISSUE_TEMPLATE/bug_report.md'],
  story: ['.gitlab/issue_templates/Story.md', '.github/ISSUE_TEMPLATE/story.md', '.github/ISSUE_TEMPLATE/feature_request.md'],
}
const TEMPLATE_HOME = { gitlab: { bug: '.gitlab/issue_templates/Bug.md', story: '.gitlab/issue_templates/Story.md' }, github: { bug: '.github/ISSUE_TEMPLATE/bug.md', story: '.github/ISSUE_TEMPLATE/story.md' } }

export const RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*', '.claude/quality-code/audit/']

const rawLine = ticketsDir => `${normaliseTicketsDir(typeof ticketsDir === 'string' ? ticketsDir : DEFAULTS.ticketsDir)}/*/raw.json`

function boundaryCandidates(root) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const exists = p => existsSync(join(root, p.replace(/\/$/, '')))
  // A workspace monorepo's packages each have their code folder.
  const workspaceSrc = top => { try { return readdirSync(join(root, top)).some(n => existsSync(join(root, top, n, 'src'))) } catch { return false } }
  // Order: code folders, environment files, CI files.
  return [
    ...['src/', 'app/', 'lib/', 'server/', 'pages/', 'components/', 'prisma/', 'migrations/'].filter(exists),
    ...['packages', 'apps'].filter(workspaceSrc).map(t => `${t}/*/src/`),
    ...(exists('.env') ? ['.env'] : []),
    ...(names.some(n => /^\.env\..+/.test(n)) ? ['.env.*'] : []),
    ...CI_FILES.filter(exists),
  ]
}

const VITEST_CONFIG = /^vitest(\.[\w-]+)?\.config\.[cm]?[jt]s$|^vitest\.config(\.[\w-]+)?\.[cm]?[jt]s$/
const VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/

/** Vitest config files at the root: vitest.config.*, and a vite.config.* that holds a test block. */
function vitestConfigs(root) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const viteWithTests = n => { try { return /\btest\s*:/.test(readFileSync(join(root, n), 'utf8')) } catch { return false } }
  return names.filter(n => VITEST_CONFIG.test(n) || (VITE_CONFIG.test(n) && viteWithTests(n))).sort()
}

const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/

function hasSpecBesideCode(dir, budget = { n: 5000 }) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (--budget.n < 0) return false
    if (e.isDirectory()) { if (e.name !== 'node_modules' && hasSpecBesideCode(join(dir, e.name), budget)) return true }
    else if (SPEC_FILE.test(e.name)) return true
  }
  return false
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

/** The folders (first two path segments, ending in "/") that hold specs: sorted, at most 10. */
function specFolders(root, budget = { n: 20000 }) {
  const found = new Set()
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1) }
      else if (depth > 0 && SPEC_FILE.test(e.name)) found.add(`${rel.split('/').slice(0, 2).join('/')}/`)
    }
  }
  walk('', 0)
  return [...found].sort().slice(0, 10)
}

/**
 * Playwright config files at the root or up to two folders down (Playwright finds only the root one by
 * itself), each with the test folder its testDir gives, or null when it cannot be read.
 */
function playwrightConfigs(root) {
  const names = new Set(CONFIG_FILES)
  const found = []
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (depth < 2 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1) }
      else if (names.has(e.name)) found.push({ config: p, folder: readTestDir(root, [p])?.value ?? null })
    }
  }
  walk('', 0)
  return found.sort((a, b) => a.config.split('/').length - b.config.split('/').length || (a.config < b.config ? -1 : 1)).slice(0, 5)
}

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))

// A frontend: one of these in its dependencies, or an index.html at the root.
const UI_DEPS = ['react', 'vue', '@angular/core', 'svelte', 'solid-js', 'preact', 'lit', 'next', 'nuxt', 'astro', '@sveltejs/kit', 'ember-source', 'vite', 'parcel', 'webpack-dev-server']
const DEV_SCRIPTS = ['dev', 'start', 'serve']
// The port a dev server opens on when its script and config name none.
const DEFAULT_PORTS = [[/\bnext\b|\breact-scripts\b|\bnuxi?\b/, 3000], [/\bng\b/, 4200], [/\bastro\b/, 4321], [/\bparcel\b/, 1234], [/\bvue-cli-service\b|\bwebpack\b/, 8080], [/\bvite\b|\bremix\b|\breact-router\b/, 5173]]
const LOCKFILES = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']]
const ADD_DEV = { npm: 'npm install --save-dev', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -d' }
const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }
const SMOKE_NAMES = ['smoke.spec.ts', 'smoke.spec.js']
const AUTH_STATE = 'playwright/.auth/user.json'
const ENV_FILE = '.env.e2e'
const PLAYWRIGHT_GITIGNORE = ['test-results/', 'playwright-report/']
const SIGN_IN_GITIGNORE = [`${dirname(AUTH_STATE)}/`, ENV_FILE]

/** The package manager, from package.json or the nearest lockfile up to the repo top (a workspace keeps one at its root); npm when none. */
function packageManager(root, pkg) {
  let pm = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '')?.[1] ?? null
  let pnp = false
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    pm ??= LOCKFILES.find(([f]) => existsSync(join(dir, f)))?.[1] ?? null
    pnp ||= existsSync(join(dir, '.pnp.cjs'))
    if (pm || existsSync(join(dir, '.git')) || dirname(dir) === dir) return { pm: pm ?? 'npm', pnp }
  }
}

// ponytail: the first `port:` in the Vite config, server's or preview's; the user confirms the address on the card.
function vitePort(root) {
  for (const e of ['ts', 'mts', 'js', 'mjs', 'cjs']) {
    try { return /\bport\s*:\s*(\d{2,5})\b/.exec(readFileSync(join(root, `vite.config.${e}`), 'utf8'))?.[1] ?? null } catch {}
  }
  return null
}

/** How the app starts for the tests: its dev script, and the address it opens at; null for what cannot be read. */
function devServer(root, pkg, pm) {
  const name = DEV_SCRIPTS.find(n => typeof pkg.scripts?.[n] === 'string')
  if (!name) return { command: null, url: null }
  const script = pkg.scripts[name]
  const port = /(?:--port|-p)[=\s]+(\d{2,5})\b/.exec(script)?.[1] ?? /\bPORT=(\d{2,5})\b/.exec(script)?.[1]
    ?? (/\bvite\b/.test(script) ? vitePort(root) : null) ?? DEFAULT_PORTS.find(([re]) => re.test(script))?.[1]
  return { command: `${pm} run ${name}`, url: port ? `http://localhost:${port}` : null }
}

/**
 * What setup adds to a frontend with no Playwright config: the install command (null when Playwright is
 * installed), the browser download, the app's command and address, the files it writes. Null when the
 * repo has a Playwright config, or is no frontend (a backend, a UI library, or no package.json).
 */
function playwrightScaffold(root, pkg, adapter, configs) {
  if (!pkg || configs.length) return null
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const installed = '@playwright/test' in deps
  const { pm, pnp } = packageManager(root, pkg)
  const app = devServer(root, pkg, pm)
  const frontend = UI_DEPS.some(d => d in deps) || existsSync(join(root, 'index.html'))
  // With Vitest already, a frontend also needs a script that serves it: a UI library is tested with Vitest alone.
  if (!installed && !(frontend && (adapter === null || (adapter === 'vitest' && app.command)))) return null
  const ts = existsSync(join(root, 'tsconfig.json'))
  // As npm init playwright does: the config reads process, which TypeScript knows from @types/node.
  const packages = ['@playwright/test', ...(ts && !('@types/node' in deps) ? ['@types/node'] : [])]
  const ext = ts ? 'ts' : 'js'
  const s = {
    install: installed ? null : `${ADD_DEV[pm]} ${packages.join(' ')}`,
    browsers: `${EXEC[pm]} playwright install chromium`,
    ...app,
    files: [`playwright.config.${ext}`, `${DEFAULT_E2E_FOLDER}smoke.spec.${ext}`],
  }
  if (pnp) s.problem = "Yarn Plug'n'Play keeps no node_modules folder, which the checks run Playwright from: set nodeLinker: node-modules in .yarnrc.yml, then run setup again."
  return s
}

const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** The Playwright config setup writes. With signIn, a setup project signs in once and every test starts signed in. */
export function playwrightConfigText({ command, url, signIn }) {
  const head = signIn
    ? `import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// The test user for the sign-in: E2E_USERNAME and E2E_PASSWORD in ${ENV_FILE}, which git ignores.
if (existsSync('${ENV_FILE}')) process.loadEnvFile('${ENV_FILE}')
`
    : `import { defineConfig, devices } from '@playwright/test'
`
  const projects = signIn
    ? `    { name: 'setup', testMatch: /auth\\.setup\\.[cm]?[jt]s/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: '${AUTH_STATE}' }, dependencies: ['setup'] },`
    : `    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },`
  return `${head}
export default defineConfig({
  testDir: './${DEFAULT_E2E_FOLDER.replace(/\/$/, '')}',
  use: { baseURL: ${quote(url)} },
  webServer: { command: ${quote(command)}, url: ${quote(url)}, reuseExistingServer: !process.env.CI },
  projects: [
${projects}
  ],
})
`
}

// Each expect names what it checks: the first line of a failure says what is wrong with the setup.
export const SMOKE_TEXT = `import { test, expect } from '@playwright/test'

// Written by quality-code setup. While it is the only spec here, /quality-code:spec runs it first, so a
// setup that does not work is never read as a bug in the app.
test('the app opens', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.ok(), 'the app should answer at its address').toBe(true)
  await expect(page.locator('body'), 'the app should show a page').not.toHaveText(/^\\s*$/)
  await expect(page.locator('input[type="password"]'), 'the app should open past its sign-in page').toHaveCount(0)
})
`

function scaffoldProblems(root, config, s) {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return ['scaffold: must be an object with "command", "url" and "signIn"']
  const e = []
  if (config.adapter !== 'playwright' && config.adapter !== 'fullstack') e.push('scaffold: only for "adapter": "playwright" or "fullstack"')
  if (typeof s.command !== 'string' || !s.command.trim() || /[\r\n]/.test(s.command)) e.push('scaffold.command: must be the one-line command that starts the app, like "npm run dev"')
  if (typeof s.url !== 'string' || !/^https?:\/\/[^\s'"`\\]+$/.test(s.url)) e.push('scaffold.url: must be the address the app opens at, like "http://localhost:5173"')
  if (typeof s.signIn !== 'boolean') e.push('scaffold.signIn: must be true or false')
  const there = CONFIG_FILES.find(f => existsSync(join(root, f)))
  if (there) e.push(`scaffold: ${there} already exists, and setup never replaces it`)
  return e
}

function hasLine(path, line) {
  return existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).some(l => l.trim() === line)
}

function gitOut(root, args) {
  try {
    return execFileSync('git', [...PLAIN, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()
  } catch {
    return null
  }
}

/** { host, path } of a remote (https or scp form), credentials dropped; else null. */
export function remoteProject(url) {
  const u = stripCredentials(url)
  if (!u) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u) || /^[^@\s/]+@([^:\s]+):(.+?)(?:\.git)?\/?$/.exec(u)
  return m ? { host: m[1], path: m[2] } : null
}

/** github, bitbucket, or gitlab for any other host (GitLab is the one usually self-hosted under its own name). */
export const hostKind = host => (/github/i.test(host) ? 'github' : /bitbucket/i.test(host) ? 'bitbucket' : 'gitlab')

/**
 * The account the gh CLI is signed in with on host: { login }, else { login: null, reason }. Local
 * for a host gh has no account on: it never sends a request to a GitLab.
 */
export function ghAccount(host) {
  try {
    const out = execFileSync('gh', ['auth', 'status', '--hostname', host, '--active', '--json', 'hosts'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } })
    const a = JSON.parse(out).hosts?.[host]?.[0]
    if (a?.state === 'success') return { login: a.login }
    return { login: null, reason: a ? `gh's sign-in to ${host} no longer works` : `gh is not signed in to ${host}` }
  } catch (e) {
    return { login: null, reason: e.code === 'ENOENT' ? 'gh is not installed' : `gh could not check ${host}` }
  }
}

/**
 * Where the project lives: its folder, the git repo around it, and the origin's project: remote
 * for any host, gitlab only when the host is a GitLab (the GitLab connector looks it up), github
 * (gh's account there) only when it is a GitHub. A GitHub on its own domain (GitHub Enterprise) is
 * known by gh's sign-in to it, not by its name.
 */
function here(root) {
  const top = gitOut(root, ['rev-parse', '--show-toplevel'])
  if (!top) return { folder: basename(root), repoTop: null, subfolder: null, remote: null, gitlab: null, github: null }
  const prefix = gitOut(root, ['rev-parse', '--show-prefix'])
  const p = remoteProject(gitOut(root, ['remote', 'get-url', 'origin']))
  const gh = p && ghAccount(p.host)
  const kind = gh?.login ? 'github' : p && hostKind(p.host)
  const remote = p && { ...p, kind }
  return { folder: basename(root), repoTop: basename(top), subfolder: prefix ? prefix.replace(/\/$/, '') : null, remote, gitlab: kind === 'gitlab' ? p : null, github: kind === 'github' ? gh : null }
}

// A Jira key in a branch name or a commit subject: ABC-12. Jira keys have at least two characters.
const JIRA_KEY = /(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]+)-\d+(?!\d)/g
// Shaped like a key, never a Jira project: UTF-8, SHA-256, ISO-8601, PR-12.
const NOT_PROJECTS = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'CVE', 'HTTP', 'TLS', 'ES', 'PR', 'MR', 'WIP'])
const MAX_SUBJECTS = 200

/** The project prefixes of the Jira keys in the texts, most frequent first (ties: first seen), at most 5. */
export function projectCandidates(texts) {
  const count = new Map()
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(JIRA_KEY)) if (!NOT_PROJECTS.has(m[1])) count.set(m[1], (count.get(m[1]) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key)
}

/** Project keys named by the local branches and the last 200 commit subjects: setup proposes them. */
function jiraCandidates(root) {
  const branches = gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? ''
  const subjects = gitOut(root, ['log', `-${MAX_SUBJECTS}`, '--format=%s']) ?? ''
  return projectCandidates([...branches.split('\n'), ...subjects.split('\n')])
}

/**
 * The branch features start from, as git alone sees it: develop when origin/develop exists (gitflow),
 * else origin/HEAD. Setup may replace it by the target of recent merge requests. Null outside a repo.
 */
function baseCandidate(root) {
  if (gitOut(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/develop^{commit}'])) return { proposed: 'develop', source: 'develop' }
  const head = gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  return head ? { proposed: head.replace(/^origin\//, ''), source: 'origin-head' } : null
}

/** The host whose issue-template folder new templates go to: the remote's, else the folder the repo already has. */
function templateHost(root, remote) {
  if (remote) return remote.kind === 'gitlab' ? 'gitlab' : 'github'
  return existsSync(join(root, '.github')) && !existsSync(join(root, '.gitlab')) ? 'github' : 'gitlab'
}

/** The personal config (no repo): its path and what it holds now (null when there is none). */
function personalState(env) {
  const path = personalConfigPath(env)
  const state = { path, existing: null }
  if (existsSync(path)) {
    try { state.existing = readJson(path) } catch (err) { state.existingError = `${path} is not valid JSON (${err.message})` }
  }
  return state
}

export function detect(root, env = process.env) {
  let adapter = null
  let pkg = null
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      pkg = readJson(pkgPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const pw = '@playwright/test' in deps
      const vt = 'vitest' in deps
      adapter = pw && vt ? 'both' : pw ? 'playwright' : vt ? 'vitest' : null
    } catch { adapter = null; pkg = null }
  }
  const pwConfigs = playwrightConfigs(root)
  const templates = {}
  for (const [kind, paths] of Object.entries(TEMPLATE_CANDIDATES)) {
    templates[kind] = paths.find(p => existsSync(join(root, p))) ?? null
  }
  let existing = null
  let existingError
  const cp = configPath(root)
  if (existsSync(cp)) {
    try { existing = readJson(cp) } catch (err) { existingError = `${CONFIG_REL} is not valid JSON (${err.message})` }
  }
  const result = {
    adapter, templates, existing,
    gitignore: hasLine(join(root, '.gitignore'), rawLine(existing?.ticketsDir)),
    boundaries: boundaryCandidates(root),
    vitestConfigs: vitestConfigs(root),
    specsBesideCode: hasSpecBesideCode(join(root, 'src')),
    specFolders: specFolders(root),
    playwrightConfigs: pwConfigs,
    scaffold: playwrightScaffold(root, pkg, adapter, pwConfigs),
    here: here(root),
    projectCandidates: jiraCandidates(root),
    base: baseCandidate(root),
    personal: personalState(env)
  }
  if (existingError) result.existingError = existingError
  return result
}

// A path the proposal names must stay inside the project root.
function pathProblem(root, label, p) {
  if (typeof p !== 'string' || !p.trim()) return `${label}: must be a non-empty relative path`
  if (isAbsolute(p) || p.split(/[\\/]/).includes('..')) return `${label} "${p}" must be a relative path inside the project (no ".." or absolute paths)`
  const rel = relative(resolve(root), resolve(root, p))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return `${label} "${p}" is outside the project`
  return null
}

/** scaffold ({ command, url, signIn }) also writes the Playwright config and the smoke test; an existing file is never replaced. */
export function write(root, config, { templates, gitignoreLine, scaffold } = {}) {
  const v = validateConfig(config)
  if (!v.ok) return { ok: false, errors: v.errors }
  const errors = []
  const named = [['ticketsDir', config.ticketsDir], ...Object.entries(config.ticketTemplates ?? {}).filter(([, p]) => p !== null).map(([k, p]) => [`ticketTemplates.${k}`, p])]
  for (const [label, p] of named) if (p !== undefined) { const m = pathProblem(root, label, p); if (m) errors.push(m) }
  if (gitignoreLine !== undefined && typeof gitignoreLine !== 'string') errors.push('gitignoreLine: must be text')
  if (scaffold !== undefined) errors.push(...scaffoldProblems(root, config, scaffold))
  if (errors.length) return { ok: false, errors }

  const { templates: found, here: h } = detect(root)
  const home = TEMPLATE_HOME[templateHost(root, h.remote)]
  const toWrite = []
  const paths = { bug: found.bug, story: found.story }
  for (const kind of ['bug', 'story']) {
    if (typeof templates?.[kind] !== 'string' || found[kind]) continue
    const p = home[kind]
    paths[kind] = p
    toWrite.push([p, templates[kind]])
  }
  if (scaffold !== undefined) {
    const ext = existsSync(join(root, 'tsconfig.json')) ? 'ts' : 'js'
    toWrite.push([`playwright.config.${ext}`, playwrightConfigText(scaffold)])
    const smoke = `${DEFAULT_E2E_FOLDER}smoke.spec.${ext}`
    if (!existsSync(join(root, smoke))) toWrite.push([smoke, SMOKE_TEXT])
  }
  const out = { ...config }
  if (out.ticketTemplates === undefined && (paths.bug || paths.story)) out.ticketTemplates = { bug: paths.bug, story: paths.story }

  let step = ''
  try {
    for (const [p, body] of toWrite) {
      const full = join(root, p)
      step = p
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body.endsWith('\n') ? body : `${body}\n`, { flag: 'wx' })
    }
    step = CONFIG_REL
    mkdirSync(join(root, dirname(CONFIG_REL)), { recursive: true })
    writeFileSync(configPath(root), `${JSON.stringify(out, null, 2)}\n`)

    const gi = join(root, '.gitignore')
    step = '.gitignore'
    const playwrightLines = scaffold === undefined ? [] : [...PLAYWRIGHT_GITIGNORE, ...(scaffold.signIn ? SIGN_IN_GITIGNORE : [])]
    for (const line of [gitignoreLine ?? rawLine(config.ticketsDir), FIELDS_REL, ...RUNTIME_GITIGNORE, ...playwrightLines]) {
      if (hasLine(gi, line)) continue
      const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
      writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
    }
  } catch (err) {
    return { ok: false, errors: [`${step}: ${err.message}`] }
  }
  return { ok: true }
}

/** Writes the personal config only: no repo file, no .gitignore, no template. */
export function writePersonal(config, env = process.env) {
  const v = validateConfig(config)
  if (!v.ok) return { ok: false, errors: v.errors }
  const p = personalConfigPath(env)
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`)
  } catch (err) {
    return { ok: false, errors: [`${p}: ${err.message}`] }
  }
  return { ok: true, path: p }
}

/**
 * Runs the smoke test setup wrote: { code, line }. code 0: it passed, or there was nothing to run; 1: it
 * failed, so the setup does not work yet; 2: no usable e2e folder. With ifFirst it runs only while it is
 * the only frontend spec: before the first ticket's tests, never after them.
 */
export async function smoke(root, config, { ifFirst = false, run = runPlaywright } = {}) {
  const e2e = e2eFolder(root, config)
  if (!e2e.ok) return { code: 2, line: e2e.error }
  const file = SMOKE_NAMES.map(n => `${e2e.folder}${n}`).find(p => existsSync(join(root, p)))
  if (!file) return { code: 0, line: 'skip: no smoke test in the e2e folder' }
  if (ifFirst && projectSpecs(root, config).some(s => s.adapter === 'playwright' && s.path !== file)) return { code: 0, line: 'skip: the e2e folder has other specs' }
  const timeoutMs = timeoutSecondsOf(asAdapter(config, 'playwright')) * 1000
  const r = await run(root, [file], { config: configFor(file, config), projects: config.playwright?.projects ?? [], timeoutMs })
  const why = m => String(m).replace(/^Error: /, '')
  if (!r.ran) return { code: 1, line: `The app did not open: ${why(r.error)}` }
  if (r.broken.length) return { code: 1, line: `${r.broken[0].file} does not load: ${why(r.broken[0].message)}` }
  // A setup project (the sign-in) runs first; when it fails, the smoke test does not run.
  const signIn = r.tests.find(t => t.status === 'failed' && t.file !== file)
  if (signIn) return { code: 1, line: `The sign-in failed (${signIn.file}): ${why(signIn.message)}` }
  const t = r.tests.find(x => x.file === file)
  if (!t || t.status === 'skipped') return { code: 1, line: 'The smoke test did not run: check the projects in the Playwright config' }
  if (t.status === 'failed' && t.message.includes(AUTH_STATE)) return { code: 1, line: `The smoke test found no signed-in state: the sign-in (${e2e.folder}auth.setup.${file.split('.').pop()}) is missing, or it does not save ${AUTH_STATE}` }
  if (t.status === 'failed') return { code: 1, line: `The smoke test failed: ${why(t.message)}` }
  return { code: 0, line: 'ok: the app opens' }
}

/**
 * The e2e specs the project's own Vitest run (its default config) picks up too, where they fail: Playwright's
 * test() runs only under Playwright. { files } from `vitest list`, or { error } when Vitest cannot list them.
 */
export function vitestOverlap(root, folder, { timeoutMs = 120000 } = {}) {
  const bin = toolScript(root, ['vitest'], 'vitest')
  if (!bin) return { error: 'Vitest is not installed in this project: run npm install' }
  let out
  try {
    out = execFileSync(process.execPath, [bin, 'list', '--filesOnly', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, env: { ...process.env, NO_COLOR: '1', CI: '1' } })
  } catch (e) { out = e.stdout ?? '' }
  let list
  try { list = JSON.parse(out.slice(out.indexOf('['))) } catch { return { error: 'Vitest could not list its test files' } }
  let base = root
  try { base = realpathSync(root) } catch {}
  const files = list.map(t => relative(base, String(t?.file ?? '')).split('\\').join('/')).filter(f => f.startsWith(folder))
  return { files: [...new Set(files)].sort() }
}

function main(argv) {
  // Where the user set up: not a parent folder's project, which projectRoot would find.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (argv[0] === '--detect') {
    process.stdout.write(`SETUP_JSON:${JSON.stringify(detect(root))}\n`)
    return 0
  }
  if ((argv[0] === '--write' || argv[0] === '--write-personal') && argv[1]) {
    // The proposal inline ('{"config": …}') or from a file (@proposal.json).
    const inline = argv[1].trimStart().startsWith('{')
    const ref = argv[1].startsWith('@') ? argv[1].slice(1) : argv[1]
    let proposal
    try { proposal = inline ? JSON.parse(argv[1]) : readJson(resolve(root, ref)) } catch (err) {
      process.stdout.write(`proposal: cannot read ${inline ? 'the inline JSON' : ref} (${err.message})\n`)
      return 2
    }
    if (argv[0] === '--write-personal' || proposal?.scope === 'personal') {
      const r = writePersonal(proposal?.config)
      if (!r.ok) { process.stdout.write(`${r.errors.join('\n')}\n`); return 2 }
      process.stdout.write('ok\n')
      return 0
    }
    const r = write(root, proposal?.config, { templates: proposal?.templates, scaffold: proposal?.scaffold })
    if (!r.ok) { process.stdout.write(`${r.errors.join('\n')}\n`); return 2 }
    process.stdout.write('ok\n')
    return 0
  }
  if (argv[0] === '--smoke' && argv.slice(1).every(a => a === '--if-first')) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { process.stdout.write(`${cfg.errors.join('\n')}\n`); return 2 }
    return smoke(root, cfg.config, { ifFirst: argv.includes('--if-first') }).then(r => { process.stdout.write(`${r.line}\n`); return r.code })
  }
  if (argv[0] === '--vitest-overlap' && argv.length === 1) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { process.stdout.write(`${cfg.errors.join('\n')}\n`); return 2 }
    const e2e = e2eFolder(root, cfg.config)
    const r = e2e.ok ? vitestOverlap(root, e2e.folder) : { error: e2e.error }
    if (r.error) { process.stdout.write(`${r.error}\n`); return 2 }
    if (!r.files.length) { process.stdout.write(`ok: Vitest runs none of the specs in ${e2e.folder}\n`); return 0 }
    process.stdout.write(`Vitest also runs ${r.files.length} spec(s) in ${e2e.folder}, and fails on them:\n${r.files.map(f => `  ${f}`).join('\n')}\n`)
    return 1
  }
  process.stdout.write("usage: setup.mjs --detect | --write '<proposal json>'|@proposal.json | --write-personal '<proposal json>'|@proposal.json | --smoke [--if-first] | --vitest-overlap\n")
  return 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) Promise.resolve(main(process.argv.slice(2))).then(code => { process.exitCode = code })
