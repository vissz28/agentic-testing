// Deterministic half of the setup command: --detect scans the repo (read-only), --write validates and
// writes, --smoke runs the smoke test setup writes for a frontend that had no Playwright, and
// --unit-overlap lists the e2e specs the project's own unit runner (Vitest, Jest) would pick up too.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { stripCredentials } from './branch.mjs'
import { CONFIG_REL, DEFAULTS, configPath, loadConfig, normaliseTicketsDir, personalConfigPath, timeoutSecondsOf, validateConfig } from '../lib/base/config.mjs'
import { FIELDS_REL } from '../lib/ticket/fields.mjs'
import { ignoreFolder } from '../lib/base/ignore.mjs'
import { placeConfigPath, placeOf } from '../lib/base/places.mjs'
import { CONFIG_FILES, DEFAULT_E2E_FOLDER, e2eFolder, readTestDir } from '../lib/base/e2e-folder.mjs'
import { PLAIN } from '../lib/base/git.mjs'
import { CI_FILES } from '../lib/base/boundary.mjs'
import { asAdapter } from '../lib/base/stack.mjs'
import { configFor, runPlaywright } from '../lib/pipeline/runners/playwright.mjs'
import { toolScript } from '../lib/pipeline/runners/tool.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { RUNNERS, runnerLabel, runnerOf } from '../lib/base/runners.mjs'
import { backendOf } from '../lib/base/backends.mjs'
import { detectConventions } from '../lib/base/conventions.mjs'
import { containersScaffold, containersWrite } from '../lib/base/containers.mjs'
import { BUILD_COPIES, majorityRunner, workspaceDeps, workspaceDirs, workspacePatterns, workspaceRunners } from '../lib/base/workspaces.mjs'
import { isMain, tag, printLine } from '../lib/core/script-io.mjs'
import { toForwardSlashes } from '../lib/core/text.mjs'
import { readJson } from '../lib/core/files.mjs'

// Found in this order; a new one is written where the repo's host keeps issue templates.
const TEMPLATE_CANDIDATES = {
  bug: ['.gitlab/issue_templates/Bug.md', '.github/ISSUE_TEMPLATE/bug.md', '.github/ISSUE_TEMPLATE/bug_report.md'],
  story: ['.gitlab/issue_templates/Story.md', '.github/ISSUE_TEMPLATE/story.md', '.github/ISSUE_TEMPLATE/feature_request.md'],
}
const TEMPLATE_HOME = { gitlab: { bug: '.gitlab/issue_templates/Bug.md', story: '.gitlab/issue_templates/Story.md' }, github: { bug: '.github/ISSUE_TEMPLATE/bug.md', story: '.github/ISSUE_TEMPLATE/story.md' } }

export const RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*', '.claude/quality-code/audit/']

const rawLine = ticketsDir => `${normaliseTicketsDir(typeof ticketsDir === 'string' ? ticketsDir : DEFAULTS.ticketsDir)}/*/raw.json`

function boundaryCandidates(root, ignored = new Set()) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const exists = p => existsSync(join(root, p.replace(/\/$/, ''))) && !ignored.has(p.replace(/\/$/, ''))
  // A workspace monorepo's packages each have their code folder.
  const workspaceSrc = top => { try { return readdirSync(join(root, top)).some(n => !BUILD_COPIES.has(n) && !ignored.has(`${top}/${n}`) && existsSync(join(root, top, n, 'src'))) } catch { return false } }
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

const SPEC_FILE = /\.(spec|test|cy)\.[cm]?[jt]sx?$/

// The files that name a Python project's test runner; any of them that mentions pytest makes it pytest.
const PYTHON_FILES = /^(?:pyproject\.toml|pytest\.ini|setup\.cfg|tox\.ini|requirements[\w.-]*\.txt)$/
const DOTNET_FILES = /\.(?:csproj|fsproj|sln)$/

/**
 * The backend runners a repo shows, in the order setup proposes them: Vitest (package.json), pytest,
 * JUnit (Maven or Gradle), Go (go.mod), .NET (a project or solution file, at the top or one folder down).
 */
export function detectBackends(root, deps = {}, ignored = new Set()) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const read = n => { try { return readFileSync(join(root, n), 'utf8').slice(0, 1 << 20) } catch { return '' } }
  const oneDown = re => names.some(n => re.test(n)) || names.some(n => {
    if (n.startsWith('.') || n === 'node_modules' || BUILD_COPIES.has(n) || ignored.has(n)) return false
    try { return readdirSync(join(root, n)).some(m => re.test(m)) } catch { return false }
  })
  const found = []
  if ('vitest' in deps) found.push('vitest')
  if (names.includes('pytest.ini') || names.some(n => PYTHON_FILES.test(n) && /\bpytest\b/.test(read(n)))) found.push('pytest')
  if (['pom.xml', 'build.gradle', 'build.gradle.kts'].some(n => names.includes(n))) found.push('junit')
  if (names.includes('go.mod')) found.push('go')
  if (oneDown(DOTNET_FILES)) found.push('dotnet')
  return found
}

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

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', ...BUILD_COPIES])

/** The folders (first two path segments, ending in "/") that hold specs: sorted, at most 10. */
function specFolders(root, ignored = new Set(), budget = { n: 20000 }) {
  const found = new Set()
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !ignored.has(rel ? `${rel}/${e.name}` : e.name)) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1) }
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
function playwrightConfigs(root, ignored = new Set()) {
  const names = new Set(CONFIG_FILES)
  const found = []
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (depth < 2 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && !ignored.has(p)) walk(p, depth + 1) }
      else if (names.has(e.name)) found.push({ config: p, folder: readTestDir(root, [p])?.value ?? null })
    }
  }
  walk('', 0)
  return found.sort((a, b) => a.config.split('/').length - b.config.split('/').length || (a.config < b.config ? -1 : 1)).slice(0, 5)
}

// A frontend: one of these in its dependencies, or an index.html at the root.
const UI_DEPS = ['react', 'vue', '@angular/core', 'svelte', 'solid-js', 'preact', 'lit', 'next', 'nuxt', 'astro', '@sveltejs/kit', 'ember-source', 'vite', 'parcel', 'webpack-dev-server']
// A server: one of these in its dependencies. A frontend with one is a frontend with its backend.
const SERVER_DEPS = ['express', '@nestjs/core', 'fastify', 'koa', '@hapi/hapi', 'hono', 'restify', '@adonisjs/core', '@feathersjs/feathers', 'h3']
const DEV_SCRIPTS = ['dev', 'start', 'serve']
// The port a dev server opens on when its script and config name none.
const DEFAULT_PORTS = [[/\bnext\b|\breact-scripts\b|\bnuxi?\b/, 3000], [/\bng\b/, 4200], [/\bastro\b/, 4321], [/\bparcel\b/, 1234], [/\bvue-cli-service\b|\bwebpack\b/, 8080], [/\bvite\b|\bremix\b|\breact-router\b/, 5173]]
const LOCKFILES = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']]
const ADD_DEV = { npm: 'npm install --save-dev', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -d' }
export const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }
const SMOKE_NAMES = ['smoke.spec.ts', 'smoke.spec.js']
const AUTH_STATE = 'playwright/.auth/user.json'
const ENV_FILE = '.env.e2e'
const PLAYWRIGHT_GITIGNORE = ['test-results/', 'playwright-report/']
const SIGN_IN_GITIGNORE = [`${dirname(AUTH_STATE)}/`, ENV_FILE]
// The unit runners setup recognises, the first one found winning; Vitest is the specialized one.
// Node's own runner is no dependency: a script that runs node --test names it.
const UNIT_RUNNERS = ['vitest', 'jest', 'mocha']
const NODE_TEST = /(?:^|&&|\|\||;|\|)\s*node\b[^&|;]*\s--test\b/
const runsNodeTest = pkg => Object.values(pkg?.scripts ?? {}).some(s => NODE_TEST.test(String(s)))

/** The package manager, from package.json or the nearest lockfile up to the repo top (a workspace keeps one at its root); npm when none. */
export function packageManager(root, pkg) {
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
  // A repo that runs Cypress keeps it: its e2e tests are written and checked in Cypress.
  if ('cypress' in deps) return null
  const installed = '@playwright/test' in deps
  const { pm, pnp } = packageManager(root, pkg)
  const app = devServer(root, pkg, pm)
  // With Vitest already, a frontend also needs a script that serves it: a UI library is tested with Vitest alone.
  if (!installed && !(isFrontend(root, deps) && (adapter === null || (adapter === 'vitest' && app.command)))) return null
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
  if (pnp) s.problem = pnpProblem('Playwright')
  return s
}

const isFrontend = (root, deps) => UI_DEPS.some(d => d in deps) || existsSync(join(root, 'index.html'))
const pnpProblem = tool => `Yarn Plug'n'Play keeps no node_modules folder, which the checks run ${tool} from: set nodeLinker: node-modules in .yarnrc.yml, then run /quality-code:spec again.`

/**
 * What setup adds to a repo with no test runner that is not a frontend alone (a backend, a library, or a
 * frontend with its server, which gets Playwright too): the install command and the Vitest config. Null
 * when the repo has any runner, or no package.json.
 */
function vitestScaffold(root, pkg, adapter) {
  if (!pkg || adapter !== null) return null
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (isFrontend(root, deps) && !SERVER_DEPS.some(d => d in deps)) return null
  const { pm, pnp } = packageManager(root, pkg)
  const ext = existsSync(join(root, 'tsconfig.json')) ? 'ts' : 'js'
  // ponytail: no SWC for NestJS: Vitest 5 compiles with oxc, which emits the decorator metadata Nest's injection
  // reads. A repo held on Vitest 3 (esbuild) needs unplugin-swc in its config.
  const s = { install: `${ADD_DEV[pm]} vitest`, files: vitestConfigs(root).length ? [] : [`vitest.config.${ext}`] }
  const problem = vitestProblem(process.versions.node, deps.vite) ?? (pnp ? pnpProblem('Vitest') : null)
  if (problem) s.problem = problem
  return s
}

/**
 * Why the Vitest an install gets (5) cannot run here, or null: it starts on Node 22.12 or newer, beside a
 * Vite of 6.4 or newer. vite is the repo's own range for it (a frontend's), checked by its major only.
 */
export function vitestProblem(node, vite) {
  const [major, minor] = String(node).split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) return `Vitest needs Node 22.12 or newer, and this is Node ${node}: update Node, then run /quality-code:spec again.`
  if (Number(/\d+/.exec(String(vite ?? ''))?.[0]) < 6) return `Vitest needs Vite 6.4 or newer, and this repo has vite ${vite}: update Vite, then run /quality-code:spec again.`
  return null
}

/** The Vitest config setup writes; next to Playwright, the e2e folder is left to Playwright, and the integration folder to its own config. */
export function vitestConfigText({ e2e, integration = null }) {
  const out = [...(e2e ? [DEFAULT_E2E_FOLDER] : []), ...(integration ? [integration] : [])]
  const test = out.length ? `{ exclude: [...configDefaults.exclude, ${out.map(f => `'${f}**'`).join(', ')}] }` : '{}'
  const but = [e2e && `the Playwright specs in ${DEFAULT_E2E_FOLDER}`, integration && `the integration specs in ${integration} (vitest.integration.config)`].filter(Boolean).join(' and ')
  return `import { ${out.length ? 'configDefaults, ' : ''}defineConfig } from 'vitest/config'

// Written by quality-code setup. Vitest runs every *.test.* and *.spec.* file${but ? `, but ${but}` : ''}.
export default defineConfig({
  // Imports through the tsconfig's baseUrl or paths (src/…, @app/…) resolve as they do for tsc.
  resolve: { tsconfigPaths: true },
  test: ${test},
})
`
}

function containersProblems(config, c) {
  if (c !== true) return ['containersScaffold: must be true']
  if (backendOf(config) === 'vitest' && runnerOf(config, 'vitest') !== 'vitest') return [`containersScaffold: only for a Vitest backend, not ${runnerLabel(runnerOf(config, 'vitest'))}`]
  return []
}

const packageJson = root => { try { return readJson(join(root, 'package.json')) } catch { return {} } }
const packageDeps = root => { const pkg = packageJson(root); return { ...pkg.dependencies, ...pkg.devDependencies } }

function vitestScaffoldProblems(config, v) {
  if (v !== true) return ['vitestScaffold: must be true']
  if (backendOf(config) !== 'vitest' || runnerOf(config, 'vitest') !== 'vitest') return ['vitestScaffold: only for "backend": "vitest"']
  return []
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
  if (!config.frontend) e.push('scaffold: only for "frontend": "playwright"')
  else if (runnerOf(config, 'playwright') !== 'playwright') e.push(`scaffold: it sets up Playwright, and this project's e2e runner is ${runnerOf(config, 'playwright')}`)
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

/** The folders git ignores (relative to root, no trailing slash): detect never reads them. Empty outside a repo. */
export function ignoredDirs(root) {
  const out = gitOut(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']) ?? ''
  return new Set(out.split('\n').filter(l => l.endsWith('/')).map(l => l.slice(0, -1)))
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
  // A key that reads like another one (PF0 with a zero beside PFO with the letter, 1 and I) is a typo of the more used one: it is dropped.
  const look = k => k.replace(/0/g, 'O').replace(/1/g, 'I')
  const digits = k => (k.match(/[01]/g) ?? []).length
  const kept = []
  for (const [key, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const twin = kept.find(t => look(t[0]) === look(key))
    // A tie between lookalikes keeps the one spelled with letters.
    if (!twin) kept.push([key, n])
    else if (twin[1] === n && digits(key) < digits(twin[0])) twin[0] = key
  }
  return kept.slice(0, 5).map(([key]) => key)
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

/**
 * A version 1 config (it names an adapter) as version 2 names its sides, so a rerun of setup rewrites it:
 * playwright is the frontend, a backend runner the backend, fullstack both (Vitest when it named no backend).
 */
export function fromVersion1(c) {
  if (!c || typeof c !== 'object' || !('adapter' in c)) return c
  const { adapter, backend, ...rest } = c
  const sides = adapter === 'fullstack' ? { frontend: 'playwright', backend: backend ?? 'vitest' }
    : adapter === 'playwright' ? { frontend: 'playwright' } : { backend: adapter }
  return { ...rest, version: 2, ...sides }
}

/** The personal config (no repo): its path and what it holds now (null when there is none). */
function personalState(env) {
  const path = personalConfigPath(env)
  const state = { path, existing: null }
  if (existsSync(path)) {
    try { state.existing = fromVersion1(readJson(path)) } catch (err) { state.existingError = `${path} is not valid JSON (${err.message})` }
  }
  return state
}

// A tool in package.json that runs tests: a subfolder with one is proposed first as the project root.
const TEST_DEPS = [...UNIT_RUNNERS, '@playwright/test', 'cypress']

/** The folder has a package.json that names a test tool or runs node --test. */
const hasTestTool = (top, n) => { try { const pkg = readJson(join(top, n, 'package.json')); return TEST_DEPS.some(d => d in { ...pkg.dependencies, ...pkg.devDependencies }) || runsNodeTest(pkg) } catch { return false } }

/** The folders one down that hold a package.json, those with a test tool first: where the project may live when the top has none. */
function rootCandidates(top, ignored = new Set()) {
  let names = []
  try { names = readdirSync(top, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && !ignored.has(e.name)).map(e => e.name).sort() } catch {}
  const tested = n => hasTestTool(top, n)
  const found = names.filter(n => existsSync(join(top, n, 'package.json')))
  return [...found.filter(tested), ...found.filter(n => !tested(n))]
}

/**
 * Where the work is, for a repo with several projects: the folders this branch changed (against the base, and not yet
 * committed) come first, then those with the most spec files. Each candidate gets its evidence; nothing is guessed by name.
 */
export function rankRoots(top, candidates) {
  if (candidates.length < 2) return { ordered: candidates, evidence: {}, decisive: candidates.length === 1 }
  const evidence = Object.fromEntries(candidates.map(c => [c, { changed: 0, specs: 0 }]))
  const folderOf = path => path.split('/')[0]
  for (const f of (gitOut(top, ['ls-files']) ?? '').split('\n')) {
    const c = folderOf(f)
    if (c in evidence && /\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py)$/.test(f)) evidence[c].specs++
  }
  const base = baseCandidate(top)
  const touched = [
    ...(base ? (gitOut(top, ['diff', '--name-only', `origin/${base.proposed}...HEAD`]) ?? '').split('\n') : []),
    ...(gitOut(top, ['status', '--porcelain']) ?? '').split('\n').map(l => l.slice(3)),
  ].filter(Boolean)
  for (const f of touched) { const c = folderOf(f); if (c in evidence) evidence[c].changed++ }
  const ordered = [...candidates].sort((a, b) => evidence[b].changed - evidence[a].changed || evidence[b].specs - evidence[a].specs || candidates.indexOf(a) - candidates.indexOf(b))
  // Decisive: exactly one folder holds this branch's work. Otherwise the person says which service this is.
  // Or exactly one folder can run tests at all (a test tool or spec files): the others cannot be where tests are written.
  const changed = ordered.filter(c => evidence[c].changed > 0)
  const testable = ordered.filter(c => evidence[c].specs > 0 || hasTestTool(top, c))
  return { ordered, evidence, decisive: changed.length === 1 || (changed.length === 0 && testable.length === 1) }
}

/**
 * Tests that sit next to the code (src/**\/*.unit.test.jsx): the layer that finds them and the boundary rule that lets a run
 * write their names, or null when the project keeps its tests apart. A layer in src/ needs the rule: src/ is otherwise protected.
 */
export function colocatedProposal(root) {
  const c = detectConventions(root)
  if (!c.beside || !c.specs || !c.pattern) return null
  const top = [...new Set(c.folders.map(f => f.split('/')[0]))]
  if (top.length !== 1 || top[0] === '.') return null
  const folder = `${top[0]}/`
  return { layer: { name: 'unit', folder }, allow: [`${folder}**/*${c.pattern.replace(/^\*/, '')}`], specs: c.specs, pattern: c.pattern }
}

/**
 * What setup proposes, read from the project root: the subfolder sub names ("." the top), else the
 * existing config's root, else the first candidate when the top shows no project of its own. The
 * config, existing and personal stay at the top.
 */
export function detect(top, env = process.env, sub = null) {
  let existing = null
  let existingError
  const cp = configPath(top)
  if (existsSync(cp)) {
    try { existing = fromVersion1(readJson(cp)) } catch (err) { existingError = `${cp.endsWith(CONFIG_REL) ? CONFIG_REL : 'config.json'} is not valid JSON (${err.message})` }
  }
  const ignored = ignoredDirs(top)
  const topPkg = (() => { try { return readJson(join(top, 'package.json')) } catch { return null } })()
  // A workspaces root (npm, Yarn, pnpm) is ONE project with many test roots: never a choice of which service.
  const patterns = workspacePatterns(top, topPkg)
  const wsDirs = patterns ? workspaceDirs(top, patterns, ignored) : []
  const monorepo = wsDirs.length > 0 && !sub && typeof existing?.root !== 'string'
  const candidates = monorepo ? [] : rootCandidates(top, ignored)
  const bare = !monorepo && !existsSync(join(top, 'package.json')) && !detectBackends(top, {}, ignored).length
  const ranking = bare && !sub && typeof existing?.root !== 'string' ? rankRoots(top, candidates) : null
  const pick = sub ?? (typeof existing?.root === 'string' ? existing.root : bare ? ranking.ordered[0] ?? null : null)
  const proposed = pick && resolve(top, pick) !== resolve(top) ? pick : null
  const root = proposed ? resolve(top, proposed) : top
  let deps = {}
  let pkg = null
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      pkg = readJson(pkgPath)
      deps = { ...pkg.dependencies, ...pkg.devDependencies }
    } catch { deps = {}; pkg = null }
  }
  // The JavaScript unit runner (Vitest, else Jest, Mocha or node --test under the vitest adapter) and the e2e one.
  // A monorepo is tested with what its workspaces are: the runner most of them use, each with its own config.
  const wsRunners = monorepo ? workspaceRunners(top, wsDirs) : []
  const wsRunner = majorityRunner(wsRunners)
  const wsAll = monorepo ? { ...workspaceDeps(top, wsDirs), ...deps } : deps
  const unit = wsRunner ?? UNIT_RUNNERS.find(r => r in wsAll) ?? (runsNodeTest(pkg) ? 'node' : null)
  const e2e = '@playwright/test' in wsAll ? 'playwright' : 'cypress' in wsAll ? 'cypress' : null
  // Each workspace's own config (Jest started at the root without --config trips over the copies of packages in build folders):
  // the project's vitest.configs maps the folder to it. Only the workspaces on the runner the project uses.
  const unitConfigs = wsRunners.filter(w => w.runner === unit && w.config).map(w => ({ match: `${w.dir}/`, config: w.config }))
  // The backend runner: the first one found; with an e2e runner too the repo is both (fullstack + backend).
  const backends = detectBackends(root, deps, ignored)
  if (unit && !backends.includes('vitest')) backends.unshift('vitest')
  const backend = backends[0] ?? null
  const frontend = e2e ? 'playwright' : null
  const adapter = e2e && backend ? 'both' : e2e ? 'playwright' : backend
  // The config names a runner only when it is not the default of its kind: { unit: 'jest' }, { e2e: 'cypress' }.
  const runners = { ...(backend === 'vitest' && unit && unit !== 'vitest' ? { unit } : {}), ...(e2e === 'cypress' ? { e2e } : {}) }
  const pwConfigs = playwrightConfigs(root, ignored)
  const vitest = monorepo ? null : vitestScaffold(root, pkg, adapter)
  // The backend that gets real databases: Vitest when it runs the tests (or setup adds it), else pytest, Go or .NET.
  const containerBackend = monorepo ? null : unit === 'vitest' || (vitest && !vitest.problem) ? 'vitest' : backend && backend !== 'vitest' ? backend : null
  const templates = {}
  for (const [kind, paths] of Object.entries(TEMPLATE_CANDIDATES)) {
    templates[kind] = paths.find(p => existsSync(join(root, p))) ?? null
  }
  const result = {
    // ask: several projects and nothing decides which one is this work: the person picks (setup shows the card).
    root: { proposed, candidates: ranking?.ordered ?? candidates, ask: Boolean(ranking && ranking.ordered.length > 1 && !ranking.decisive), evidence: ranking?.evidence ?? {} },
    frontend, backend, backends, runners, templates, existing,
    // monorepo: one project over these workspace folders; unitConfigs is the vitest.configs proposal (folder -> its own config).
    workspaces: monorepo ? { folders: wsDirs, unit, unitConfigs } : null,
    gitignore: hasLine(join(root, '.gitignore'), rawLine(existing?.ticketsDir)),
    boundaries: boundaryCandidates(root, ignored),
    vitestConfigs: vitestConfigs(root),
    specsBesideCode: hasSpecBesideCode(join(root, 'src')),
    colocated: colocatedProposal(root),
    specFolders: specFolders(root, ignored),
    conventions: detectConventions(root),
    playwrightConfigs: pwConfigs,
    scaffold: monorepo ? null : playwrightScaffold(root, pkg, adapter, pwConfigs),
    vitestScaffold: vitest,
    containersScaffold: containersScaffold(root, containerBackend, { deps, config: existing, cmd: pkg ? { add: ADD_DEV[packageManager(root, pkg).pm], ts: existsSync(join(root, 'tsconfig.json')) } : {} }),
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

/**
 * scaffold ({ command, url, signIn }) also writes the Playwright config and the smoke test, vitestScaffold
 * (true) the Vitest config, containersScaffold (true) the integration layer that runs on real databases;
 * an existing file is never replaced.
 */
export function write(top, config, { templates, gitignoreLine, scaffold, vitestScaffold, containersScaffold, colocated, configFile } = {}) {
  // configFile: a change to the config already in force is written back to that file, not to the setup location.
  // colocated (true): the project's tests sit next to its code: its test folder is the code folder, with the test names allowed.
  if (colocated !== undefined) {
    if (colocated !== true) return { ok: false, errors: ['colocated: must be true'] }
    const proposal = colocatedProposal(resolve(top, config?.root ?? '.'))
    if (!proposal) return { ok: false, errors: ['colocated: this project has no tests next to its code'] }
    const block = config?.backend ?? 'vitest'
    config = {
      ...config,
      [block]: { ...config[block], layers: config[block]?.layers ?? [proposal.layer] },
      boundaries: { ...config.boundaries, allow: [...new Set([...(config.boundaries?.allow ?? []), ...proposal.allow])] },
    }
  }
  const v = validateConfig(config)
  if (!v.ok) return { ok: false, errors: v.errors }
  const loaded = v.config
  // The config stays at the top; every file it names, and what setup adds, is in the project root.
  const root = resolve(top, config.root ?? '.')
  if (!existsSync(root)) return { ok: false, errors: [`root "${config.root}" is not a folder of this repository`] }
  const errors = []
  const named = [['ticketsDir', config.ticketsDir], ...Object.entries(config.ticketTemplates ?? {}).filter(([, p]) => p !== null).map(([k, p]) => [`ticketTemplates.${k}`, p])]
  for (const [label, p] of named) if (p !== undefined) { const m = pathProblem(root, label, p); if (m) errors.push(m) }
  if (gitignoreLine !== undefined && typeof gitignoreLine !== 'string') errors.push('gitignoreLine: must be text')
  if (scaffold !== undefined) errors.push(...scaffoldProblems(root, loaded, scaffold))
  if (vitestScaffold !== undefined) errors.push(...vitestScaffoldProblems(loaded, vitestScaffold))
  if (containersScaffold !== undefined) errors.push(...containersProblems(loaded, containersScaffold))
  if (errors.length) return { ok: false, errors }

  const { templates: found, here: h } = detect(root, process.env, '.')
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
  const ts = existsSync(join(root, 'tsconfig.json'))
  let out = { ...config }
  const backend = config.backend ?? null
  // The project's own Vitest config, which the integration config builds on: the one there, else the one written now.
  const own = vitestConfigs(root).filter(n => !n.startsWith('vitest.integration.config.'))
  const containers = containersScaffold === undefined ? null
    : containersWrite(root, backend, out, { deps: packageDeps(root), base: own[0] ?? (vitestScaffold !== undefined ? `vitest.config.${ts ? 'ts' : 'js'}` : null), cmd: { ts, exec: EXEC[packageManager(root, packageJson(root)).pm] } })
  if (containers?.errors) return { ok: false, errors: containers.errors }
  if (containers) {
    const v2 = validateConfig(containers.config)
    if (!v2.ok) return { ok: false, errors: v2.errors }
    out = containers.config
  }
  if (vitestScaffold !== undefined && !own.length) {
    toWrite.push([`vitest.config.${ts ? 'ts' : 'js'}`, vitestConfigText({ e2e: Boolean(config.frontend && config.backend), integration: backend === 'vitest' ? containers?.folder ?? null : null })])
  }
  for (const [p, body] of containers?.files ?? []) if (!existsSync(join(root, p))) toWrite.push([p, body])
  // A config-set write (configFile) saves only the keys it previewed: no templates found on the way.
  if (!configFile && out.ticketTemplates === undefined && (paths.bug || paths.story)) out.ticketTemplates = { bug: paths.bug, story: paths.story }

  let step = ''
  try {
    for (const [p, body] of toWrite) {
      const full = join(root, p)
      step = p
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body.endsWith('\n') ? body : `${body}\n`, { flag: 'wx' })
    }
    // The config sits next to the tickets and audit files, in the place this person keeps them (on this machine, or the
    // session's temp folder until setup's last step picks); nothing about it is written into the repo's .gitignore.
    step = 'config.json'
    const cfg = configFile ?? placeConfigPath(top)
    mkdirSync(dirname(cfg), { recursive: true })
    writeFileSync(cfg, `${JSON.stringify(out, null, 2)}\n`)
    if (!configFile && placeOf(top, 'repo') === 'repo') {
      ignoreFolder(dirname(cfg))
      ignoreFolder(join(root, normaliseTicketsDir(config.ticketsDir ?? DEFAULTS.ticketsDir)))
    }
    // Only what setup adds to the project itself (the Playwright files) gets a line in its .gitignore.
    const playwrightLines = scaffold === undefined ? [] : [...PLAYWRIGHT_GITIGNORE, ...(scaffold.signIn ? SIGN_IN_GITIGNORE : [])]
    const gi = join(root, '.gitignore')
    step = '.gitignore'
    for (const line of [...(gitignoreLine === undefined ? [] : [gitignoreLine]), ...playwrightLines]) {
      if (hasLine(gi, line)) continue
      const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
      writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
    }
  } catch (err) {
    return { ok: false, errors: [`${step}: ${err.message}`] }
  }
  const legacy = !configFile && existsSync(join(top, CONFIG_REL)) ? CONFIG_REL : null
  return { ok: true, config: placeConfigPath(top), ...(legacy ? { legacy, note: `${legacy} is still there and is no longer read once the new config exists; delete it when you like.` } : {}) }
}

/** Writes the personal config only: no repo file, no .gitignore, no template. */
export function writePersonal(config, env = process.env) {
  const v = validateConfig(config, { allowAbsoluteTicketsDir: true })
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

// How a unit runner lists the files it would run, with its default config.
// ponytail: Mocha runs only its spec glob (./test by default), so it is taken to leave the e2e folder alone.
const LISTS = {
  vitest: { packages: ['vitest'], args: ['list', '--filesOnly', '--json'], files: list => list.map(t => t?.file) },
  jest: { packages: ['jest'], args: ['--listTests', '--json'], files: list => list },
}

/**
 * The e2e specs the project's own unit runner (Vitest, Jest) picks up too, where they fail: Playwright's
 * test() runs only under Playwright. { files } from the runner's own list, or { error } when it cannot list them.
 */
export function unitOverlap(root, folder, runner = 'vitest', { timeoutMs = 120000 } = {}) {
  const how = LISTS[runner]
  if (!how) return { files: [] }
  const label = RUNNERS[runner]?.label ?? runner
  const bin = toolScript(root, how.packages, runner)
  if (!bin) return { error: `${label} is not installed in this project: run npm install` }
  let out
  try {
    out = execFileSync(process.execPath, [bin, ...how.args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, env: { ...process.env, NO_COLOR: '1', CI: '1' } })
  } catch (e) { out = e.stdout ?? '' }
  let list
  try { list = how.files(JSON.parse(out.slice(out.indexOf('[')))) } catch { return { error: `${label} could not list its test files` } }
  let base = root
  try { base = realpathSync(root) } catch {}
  const files = list.map(f => toForwardSlashes(relative(base, String(f ?? '')))).filter(f => f.startsWith(folder))
  return { files: [...new Set(files)].sort() }
}

function main(argv) {
  // Where the user set up: not a parent folder's project, which projectRoot would find.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (argv[0] === '--detect' && (argv.length === 1 || (argv[1] === '--root' && argv.length === 3))) {
    const sub = argv[2] ?? null
    const bad = sub && sub !== '.' && (pathProblem(root, '--root', sub) ?? (existsSync(join(root, sub)) ? null : `--root "${sub}" is not a folder of this repository`))
    if (bad) { printLine(bad); return 2 }
    printLine(tag('SETUP', detect(root, process.env, sub)))
    return 0
  }
  if ((argv[0] === '--write' || argv[0] === '--write-personal') && argv[1]) {
    // The proposal inline ('{"config": …}') or from a file (@proposal.json).
    const inline = argv[1].trimStart().startsWith('{')
    const ref = argv[1].startsWith('@') ? argv[1].slice(1) : argv[1]
    let proposal
    try { proposal = inline ? JSON.parse(argv[1]) : readJson(resolve(root, ref)) } catch (err) {
      printLine(`proposal: cannot read ${inline ? 'the inline JSON' : ref} (${err.message})`)
      return 2
    }
    if (argv[0] === '--write-personal' || proposal?.scope === 'personal') {
      const r = writePersonal(proposal?.config)
      if (!r.ok) { printLine(r.errors.join('\n')); return 2 }
      printLine('ok')
      return 0
    }
    const r = write(root, proposal?.config, { templates: proposal?.templates, scaffold: proposal?.scaffold, vitestScaffold: proposal?.vitestScaffold, containersScaffold: proposal?.containersScaffold, colocated: proposal?.colocated })
    if (!r.ok) { printLine(r.errors.join('\n')); return 2 }
    process.stdout.write(`ok\n${r.note ? `${r.note}\n` : ''}`)
    return 0
  }
  if (argv[0] === '--smoke' && argv.slice(1).every(a => a === '--if-first')) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { printLine(cfg.errors.join('\n')); return 2 }
    return smoke(resolve(root, cfg.config.root ?? '.'), cfg.config, { ifFirst: argv.includes('--if-first') }).then(r => { printLine(r.line); return r.code })
  }
  if (argv[0] === '--unit-overlap' && argv.length === 1) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { printLine(cfg.errors.join('\n')); return 2 }
    // A pytest, JUnit, Go or .NET backend never runs the Playwright specs: its runner lists none of them.
    const backend = backendOf(cfg.config)
    const runner = backend && backend !== 'vitest' ? backend : runnerOf(cfg.config, 'vitest')
    const label = RUNNERS[runner]?.label ?? runnerLabel(runner)
    const proj = resolve(root, cfg.config.root ?? '.')
    const e2e = e2eFolder(proj, cfg.config)
    const r = e2e.ok ? unitOverlap(proj, e2e.folder, runner) : { error: e2e.error }
    if (r.error) { printLine(r.error); return 2 }
    if (!r.files.length) { printLine(`ok: ${label} runs none of the specs in ${e2e.folder}`); return 0 }
    printLine(`${label} also runs ${r.files.length} spec(s) in ${e2e.folder}, and fails on them:\n${r.files.map(f => `  ${f}`).join('\n')}`)
    return 1
  }
  printLine("usage: setup.mjs --detect [--root DIR] | --write '<proposal json>'|@proposal.json | --write-personal '<proposal json>'|@proposal.json | --smoke [--if-first] | --unit-overlap")
  return 2
}

if (isMain(import.meta.url)) Promise.resolve(main(process.argv.slice(2))).then(code => { process.exitCode = code })
