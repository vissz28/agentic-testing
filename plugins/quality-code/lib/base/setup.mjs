// What setup detects and writes: the proposal, the config, the scaffolds, the smoke test. bin/setup.mjs is its command line.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { CONFIG_REL, DEFAULTS, configPath, personalConfigPath, timeoutSecondsOf, validateConfig } from '../config/config.mjs'
import { ignoreFolder } from '../core/ignore.mjs'
import { placeConfigPath, placeOf } from '../config/places.mjs'
import { CONFIG_FILES, DEFAULT_E2E_FOLDER, e2eFolder, readTestDir } from '../stacks/e2e-folder.mjs'
import { gitOut, stripCredentials } from '../core/git.mjs'
import { CI_FILES } from '../pipeline/boundary.mjs'
import { asAdapter } from '../stacks/stack.mjs'
import { configFor, runPlaywright } from '../pipeline/runners/playwright.mjs'
import { toolScript } from '../pipeline/runners/tool.mjs'
import { projectSpecs } from '../report/quality-program.mjs'
import { RUNNERS, runnerLabel, runnerOf } from '../stacks/runners.mjs'
import { backendOf } from '../stacks/backends.mjs'
import { detectConventions } from '../stacks/conventions.mjs'
import { containersScaffold, containersWrite } from './containers.mjs'
import { BUILD_COPIES, majorityRunner, workspaceDeps, workspaceDirs, workspacePatterns, workspaceRunners } from './workspaces.mjs'
import { lines, toForwardSlashes, withoutOrigin } from '../core/text.mjs'
import { readJson } from '../core/files.mjs'
import { noTrailingSlash, cleanRelPath, leavesFolder } from '../core/paths.mjs'
import { isLine, isObject } from '../core/is.mjs'

// Checked in order; new templates go where the repo's host keeps them.
const TEMPLATE_CANDIDATES = {
  bug: ['.gitlab/issue_templates/Bug.md', '.github/ISSUE_TEMPLATE/bug.md', '.github/ISSUE_TEMPLATE/bug_report.md'],
  story: ['.gitlab/issue_templates/Story.md', '.github/ISSUE_TEMPLATE/story.md', '.github/ISSUE_TEMPLATE/feature_request.md'],
}
const TEMPLATE_HOME = { gitlab: { bug: '.gitlab/issue_templates/Bug.md', story: '.gitlab/issue_templates/Story.md' }, github: { bug: '.github/ISSUE_TEMPLATE/bug.md', story: '.github/ISSUE_TEMPLATE/story.md' } }

export const RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*', '.claude/quality-code/audit/']

const rawLine = ticketsDir => `${cleanRelPath(typeof ticketsDir === 'string' ? ticketsDir : DEFAULTS.ticketsDir)}/*/raw.json`

function boundaryCandidates(root, ignored = new Set()) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const exists = p => existsSync(join(root, noTrailingSlash(p))) && !ignored.has(noTrailingSlash(p))
  // A workspace monorepo's packages each have their code folder.
  const workspaceSrc = top => { try { return readdirSync(join(root, top)).some(n => !BUILD_COPIES.has(n) && !ignored.has(`${top}/${n}`) && existsSync(join(root, top, n, 'src'))) } catch { return false } }
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

/** Root vitest.config.*, plus any vite.config.* with a test block. */
function vitestConfigs(root) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const viteWithTests = n => { try { return /\btest\s*:/.test(readFileSync(join(root, n), 'utf8')) } catch { return false } }
  return names.filter(n => VITEST_CONFIG.test(n) || (VITE_CONFIG.test(n) && viteWithTests(n))).sort()
}

const SPEC_FILE = /\.(spec|test|cy)\.[cm]?[jt]sx?$/

// Any of these that mentions pytest means the project uses pytest.
const PYTHON_FILES = /^(?:pyproject\.toml|pytest\.ini|setup\.cfg|tox\.ini|requirements[\w.-]*\.txt)$/
const DOTNET_FILES = /\.(?:csproj|fsproj|sln)$/

/** Backend runners found, in the order setup proposes them. .NET project files may be one folder down. */
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

/** Folders (first two path segments) holding specs, sorted, max 10. */
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

/** Playwright configs up to two folders deep (Playwright only finds the root one), each with its testDir or null. */
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

// Frontend: any of these deps, or a root index.html.
const UI_DEPS = ['react', 'vue', '@angular/core', 'svelte', 'solid-js', 'preact', 'lit', 'next', 'nuxt', 'astro', '@sveltejs/kit', 'ember-source', 'vite', 'parcel', 'webpack-dev-server']
// Server deps; a frontend with one of these also has a backend.
const SERVER_DEPS = ['express', '@nestjs/core', 'fastify', 'koa', '@hapi/hapi', 'hono', 'restify', '@adonisjs/core', '@feathersjs/feathers', 'h3']
const DEV_SCRIPTS = ['dev', 'start', 'serve']
// Default dev-server ports when the script and config set none.
const DEFAULT_PORTS = [[/\bnext\b|\breact-scripts\b|\bnuxi?\b/, 3000], [/\bng\b/, 4200], [/\bastro\b/, 4321], [/\bparcel\b/, 1234], [/\bvue-cli-service\b|\bwebpack\b/, 8080], [/\bvite\b|\bremix\b|\breact-router\b/, 5173]]
const LOCKFILES = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']]
const ADD_DEV = { npm: 'npm install --save-dev', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -d' }
export const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }
const SMOKE_NAMES = ['smoke.spec.ts', 'smoke.spec.js']
const AUTH_STATE = 'playwright/.auth/user.json'
const ENV_FILE = '.env.e2e'
const PLAYWRIGHT_GITIGNORE = ['test-results/', 'playwright-report/']
const SIGN_IN_GITIGNORE = [`${dirname(AUTH_STATE)}/`, ENV_FILE]
// Unit runners in priority order. node --test has no dependency: found via a script or a node:test import.
const UNIT_RUNNERS = ['vitest', 'jest', 'mocha']
const NODE_TEST = /(?:^|&&|\|\||;|\|)\s*node\b[^&|;]*\s--test\b/
const runsNodeTest = pkg => Object.values(pkg?.scripts ?? {}).some(s => NODE_TEST.test(String(s)))
const NODE_TEST_IMPORT = /\b(?:from|require\()\s*['"]node:test['"]/
/** node:test imported from test/ or tests/, with no script running it. */
const importsNodeTest = root => ['test', 'tests'].some(dir => {
  let names = []
  try { names = readdirSync(join(root, dir)) } catch { return false }
  return names.some(n => { try { return SPEC_FILE.test(n) && NODE_TEST_IMPORT.test(readFileSync(join(root, dir, n), 'utf8')) } catch { return false } })
})

/** From packageManager or the nearest lockfile up to the repo top (workspaces keep it at the root); npm by default. */
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

/** The dev script and its URL; null where unknown. */
function devServer(root, pkg, pm) {
  const name = DEV_SCRIPTS.find(n => typeof pkg.scripts?.[n] === 'string')
  if (!name) return { command: null, url: null }
  const script = pkg.scripts[name]
  const port = /(?:--port|-p)[=\s]+(\d{2,5})\b/.exec(script)?.[1] ?? /\bPORT=(\d{2,5})\b/.exec(script)?.[1]
    ?? (/\bvite\b/.test(script) ? vitePort(root) : null) ?? DEFAULT_PORTS.find(([re]) => re.test(script))?.[1]
  return { command: `${pm} run ${name}`, url: port ? `http://localhost:${port}` : null }
}

/** Playwright setup for a frontend with no Playwright config; null for backends, UI libraries or no package.json. */
function playwrightScaffold(root, pkg, adapter, configs) {
  if (!pkg || configs.length) return null
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  // Cypress repos stay on Cypress.
  if ('cypress' in deps) return null
  const installed = '@playwright/test' in deps
  const { pm, pnp } = packageManager(root, pkg)
  const app = devServer(root, pkg, pm)
  // With Vitest present, add Playwright only if there's a dev script; a UI library stays Vitest-only.
  if (!installed && !(isFrontend(root, deps) && (adapter === null || (adapter === 'vitest' && app.command)))) return null
  const ts = existsSync(join(root, 'tsconfig.json'))
  // Like npm init playwright: the config uses process, typed by @types/node.
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

/** Vitest setup for a repo with no runner that isn't a pure frontend; null if it has one or no package.json. */
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

/** Why Vitest 5 can't run here (needs Node 22.12+ and Vite 6.4+), or null. The vite range is checked by major only. */
export function vitestProblem(node, vite) {
  const [major, minor] = String(node).split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) return `Vitest needs Node 22.12 or newer, and this is Node ${node}: update Node, then run /quality-code:spec again.`
  if (Number(/\d+/.exec(String(vite ?? ''))?.[0]) < 6) return `Vitest needs Vite 6.4 or newer, and this repo has vite ${vite}: update Vite, then run /quality-code:spec again.`
  return null
}

/** Vitest config text; excludes the e2e and integration folders, which have their own configs. */
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

/** Playwright config text. With signIn, a setup project signs in once for all tests. */
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
  testDir: './${noTrailingSlash(DEFAULT_E2E_FOLDER)}',
  use: { baseURL: ${quote(url)} },
  webServer: { command: ${quote(command)}, url: ${quote(url)}, reuseExistingServer: !process.env.CI },
  projects: [
${projects}
  ],
})
`
}

// Expect messages make the first failure line name the setup problem.
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
  if (!isObject(s)) return ['scaffold: must be an object with "command", "url" and "signIn"']
  const e = []
  if (!config.frontend) e.push('scaffold: only for "frontend": "playwright"')
  else if (runnerOf(config, 'playwright') !== 'playwright') e.push(`scaffold: it sets up Playwright, and this project's e2e runner is ${runnerOf(config, 'playwright')}`)
  if (!isLine(s.command)) e.push('scaffold.command: must be the one-line command that starts the app, like "npm run dev"')
  if (typeof s.url !== 'string' || !/^https?:\/\/[^\s'"`\\]+$/.test(s.url)) e.push('scaffold.url: must be the address the app opens at, like "http://localhost:5173"')
  if (typeof s.signIn !== 'boolean') e.push('scaffold.signIn: must be true or false')
  const there = CONFIG_FILES.find(f => existsSync(join(root, f)))
  if (there) e.push(`scaffold: ${there} already exists, and setup never replaces it`)
  return e
}

function hasLine(path, line) {
  return existsSync(path) && lines(readFileSync(path, 'utf8')).some(l => l.trim() === line)
}

/** Git-ignored folders relative to root; detect skips them. Empty outside a repo. */
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

/** Any host other than GitHub or Bitbucket is taken as GitLab, the one usually self-hosted. */
export const hostKind = host => (/github/i.test(host) ? 'github' : /bitbucket/i.test(host) ? 'bitbucket' : 'gitlab')

/** gh's active account on host: { login } or { login: null, reason }. Never calls a host gh has no account on. */
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

/** Folder, repo and origin. GitHub is detected by gh's sign-in, not the hostname, so GitHub Enterprise works. */
function here(root) {
  const top = gitOut(root, ['rev-parse', '--show-toplevel'])
  if (!top) return { folder: basename(root), repoTop: null, subfolder: null, remote: null, gitlab: null, github: null }
  const prefix = gitOut(root, ['rev-parse', '--show-prefix'])
  const p = remoteProject(gitOut(root, ['remote', 'get-url', 'origin']))
  const gh = p && ghAccount(p.host)
  const kind = gh?.login ? 'github' : p && hostKind(p.host)
  const remote = p && { ...p, kind }
  return { folder: basename(root), repoTop: basename(top), subfolder: prefix ? noTrailingSlash(prefix) : null, remote, gitlab: kind === 'gitlab' ? p : null, github: kind === 'github' ? gh : null }
}

// Jira key (ABC-12) in a branch or commit subject; the project part is 2+ chars.
const JIRA_KEY = /(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]+)-\d+(?!\d)/g
// Look like keys but aren't: UTF-8, SHA-256, ISO-8601, PR-12.
const NOT_PROJECTS = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'CVE', 'HTTP', 'TLS', 'ES', 'PR', 'MR', 'WIP'])
const MAX_SUBJECTS = 200

/** Jira project prefixes in the texts, most frequent first (ties: first seen), max 5. */
export function projectCandidates(texts) {
  const count = new Map()
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(JIRA_KEY)) if (!NOT_PROJECTS.has(m[1])) count.set(m[1], (count.get(m[1]) ?? 0) + 1)
  }
  // Lookalikes (PF0 vs PFO, 1 vs I) are typos of the more frequent key: drop them.
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

/** Project keys from local branches and the last 200 commit subjects. */
function jiraCandidates(root) {
  const branches = gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? ''
  const subjects = gitOut(root, ['log', `-${MAX_SUBJECTS}`, '--format=%s']) ?? ''
  return projectCandidates([...branches.split('\n'), ...subjects.split('\n')])
}

/** develop if origin/develop exists, else origin/HEAD; setup may override it from recent MR targets. Null outside a repo. */
function baseCandidate(root) {
  if (gitOut(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/develop^{commit}'])) return { proposed: 'develop', source: 'develop' }
  const head = gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  return head ? { proposed: withoutOrigin(head), source: 'origin-head' } : null
}

/** Where new issue templates go: the remote's host, else whichever folder exists. */
function templateHost(root, remote) {
  if (remote) return remote.kind === 'gitlab' ? 'gitlab' : 'github'
  return existsSync(join(root, '.github')) && !existsSync(join(root, '.gitlab')) ? 'github' : 'gitlab'
}

/** Upgrades a v1 config (single adapter) to v2 sides; fullstack with no backend means Vitest. */
export function fromVersion1(c) {
  if (!c || typeof c !== 'object' || !('adapter' in c)) return c
  // testFlow was renamed testStyle in 0.69; a file older than that still has it.
  const { adapter, backend, testFlow, ...rest } = c
  const sides = adapter === 'fullstack' ? { frontend: 'playwright', backend: backend ?? 'vitest' }
    : adapter === 'playwright' ? { frontend: 'playwright' } : { backend: adapter }
  return { ...(testFlow === undefined ? {} : { testStyle: testFlow }), ...rest, version: 2, ...sides }
}

/** Personal config path and its current contents (null if none). */
function personalState(env) {
  const path = personalConfigPath(env)
  const state = { path, existing: null }
  if (existsSync(path)) {
    try { state.existing = fromVersion1(readJson(path)) } catch (err) { state.existingError = `${path} is not valid JSON (${err.message})` }
  }
  return state
}

// A subfolder depending on one of these is proposed first as the project root.
const TEST_DEPS = [...UNIT_RUNNERS, '@playwright/test', 'cypress']

const hasTestTool = (top, n) => { try { const pkg = readJson(join(top, n, 'package.json')); return TEST_DEPS.some(d => d in { ...pkg.dependencies, ...pkg.devDependencies }) || runsNodeTest(pkg) } catch { return false } }

/** Subfolders with a package.json, test-tool ones first: root candidates when the top has none. */
function rootCandidates(top, ignored = new Set()) {
  let names = []
  try { names = readdirSync(top, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && !ignored.has(e.name)).map(e => e.name).sort() } catch {}
  const tested = n => hasTestTool(top, n)
  const found = names.filter(n => existsSync(join(top, n, 'package.json')))
  return [...found.filter(tested), ...found.filter(n => !tested(n))]
}

/** Ranks root candidates by files changed on this branch (committed or not), then by spec count. Never by name. */
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
  // Decisive: one folder has this branch's changes, or none do and only one can run tests. Else the user picks.
  const changed = ordered.filter(c => evidence[c].changed > 0)
  const testable = ordered.filter(c => evidence[c].specs > 0 || hasTestTool(top, c))
  return { ordered, evidence, decisive: changed.length === 1 || (changed.length === 0 && testable.length === 1) }
}

/**
 * For tests next to the code (src/**\/*.unit.test.jsx): the layer plus an allow rule, since src/ is otherwise
 * protected. Null when tests live apart.
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
 * Setup's proposal. Project root: sub ("." = top), else the config's root, else the top candidate when
 * the top has no project. The config files stay at the top.
 */
export function detect(top, env = process.env, sub = null) {
  let existing = null
  let existingError
  const cp = configPath(top, env)
  if (existsSync(cp)) {
    try { existing = fromVersion1(readJson(cp)) } catch (err) { existingError = `${cp.endsWith(CONFIG_REL) ? CONFIG_REL : 'config.json'} is not valid JSON (${err.message})` }
  }
  const ignored = ignoredDirs(top)
  const topPkg = (() => { try { return readJson(join(top, 'package.json')) } catch { return null } })()
  // A workspaces root (npm, Yarn, pnpm) is one project with many test roots, not a pick of services.
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
  // Unit runner: Vitest, else Jest/Mocha/node --test. A monorepo uses the runner most workspaces use.
  const wsRunners = monorepo ? workspaceRunners(top, wsDirs) : []
  const wsRunner = majorityRunner(wsRunners)
  const wsAll = monorepo ? { ...workspaceDeps(top, wsDirs), ...deps } : deps
  const unit = wsRunner ?? UNIT_RUNNERS.find(r => r in wsAll) ?? (runsNodeTest(pkg) || importsNodeTest(root) ? 'node' : null)
  const e2e = '@playwright/test' in wsAll ? 'playwright' : 'cypress' in wsAll ? 'cypress' : null
  // Per-workspace configs: Jest at the root without --config trips over package copies in build folders.
  const unitConfigs = wsRunners.filter(w => w.runner === unit && w.config).map(w => ({ match: `${w.dir}/`, config: w.config }))
  // First backend runner found; with an e2e runner too, the adapter is 'both'.
  const backends = detectBackends(root, deps, ignored)
  if (unit && !backends.includes('vitest')) backends.unshift('vitest')
  const backend = backends[0] ?? null
  const frontend = e2e ? 'playwright' : null
  const adapter = e2e && backend ? 'both' : e2e ? 'playwright' : backend
  // Only non-default runners are named: { unit: 'jest' }, { e2e: 'cypress' }.
  const runners = { ...(backend === 'vitest' && unit && unit !== 'vitest' ? { unit } : {}), ...(e2e === 'cypress' ? { e2e } : {}) }
  const pwConfigs = playwrightConfigs(root, ignored)
  const vitest = monorepo ? null : vitestScaffold(root, pkg, adapter)
  // Backend that gets real databases: Vitest if it runs (or setup adds it), else pytest, Go or .NET.
  const containerBackend = monorepo ? null : unit === 'vitest' || (vitest && !vitest.problem) ? 'vitest' : backend && backend !== 'vitest' ? backend : null
  const templates = {}
  for (const [kind, paths] of Object.entries(TEMPLATE_CANDIDATES)) {
    templates[kind] = paths.find(p => existsSync(join(root, p))) ?? null
  }
  const result = {
    // ask: several projects and nothing decides, so the user picks.
    root: { proposed, candidates: ranking?.ordered ?? candidates, ask: Boolean(ranking && ranking.ordered.length > 1 && !ranking.decisive), evidence: ranking?.evidence ?? {} },
    frontend, backend, backends, runners, templates, existing,
    // unitConfigs: proposed vitest.configs (folder -> its own config).
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

// Paths in the proposal must stay inside the project root.
export function pathProblem(root, label, p) {
  if (typeof p !== 'string' || !p.trim()) return `${label}: must be a non-empty relative path`
  if (isAbsolute(p) || p.split(/[\\/]/).includes('..')) return `${label} "${p}" must be a relative path inside the project (no ".." or absolute paths)`
  const rel = relative(resolve(root), resolve(root, p))
  if (rel === '' || leavesFolder(rel)) return `${label} "${p}" is outside the project`
  return null
}

/** Writes the config plus optional scaffolds (Playwright + smoke test, Vitest config, containers). Never replaces a file. */
export function write(top, config, { templates, gitignoreLine, scaffold, vitestScaffold, containersScaffold, colocated, configFile } = {}) {
  // configFile: an edit to the active config goes back to that file, not the setup location.
  // colocated: tests sit next to the code, so the code folder is the test folder.
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
  // Config stays at the top; the files it names and setup adds live in the project root.
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
  // The integration config extends the project's Vitest config (existing, or the one written now).
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
  // A config-set write saves only the previewed keys, not discovered templates.
  if (!configFile && out.ticketTemplates === undefined && (paths.bug || paths.story)) out.ticketTemplates = { bug: paths.bug, story: paths.story }

  let step = ''
  try {
    for (const [p, body] of toWrite) {
      const full = join(root, p)
      step = p
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body.endsWith('\n') ? body : `${body}\n`, { flag: 'wx' })
    }
    // Config lives with the tickets and audit files in the chosen place; it never adds a line to the repo's .gitignore.
    step = 'config.json'
    const cfg = configFile ?? placeConfigPath(top)
    mkdirSync(dirname(cfg), { recursive: true })
    writeFileSync(cfg, `${JSON.stringify(out, null, 2)}\n`)
    if (!configFile && placeOf(top, 'repo') === 'repo') {
      ignoreFolder(dirname(cfg))
      ignoreFolder(join(root, cleanRelPath(config.ticketsDir ?? DEFAULTS.ticketsDir)))
    }
    // Only setup's own project files (Playwright output) get .gitignore lines.
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
  return { ok: true, config: placeConfigPath(top), ...(legacy ? { legacy, note: `${legacy} is still there: on this machine the new config wins, but CI jobs read ${legacy} from the repo. Using /quality-code:ci? Replace it with config.json. If not, delete it.` } : {}) }
}

/** Personal config only: no repo files, .gitignore or templates. */
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
 * Runs setup's smoke test. code 0 passed or skipped, 1 failed, 2 no e2e folder.
 * ifFirst: only while it's the only frontend spec.
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
  // The sign-in setup project runs first; if it fails, the smoke test never runs.
  const signIn = r.tests.find(t => t.status === 'failed' && t.file !== file)
  if (signIn) return { code: 1, line: `The sign-in failed (${signIn.file}): ${why(signIn.message)}` }
  const t = r.tests.find(x => x.file === file)
  if (!t || t.status === 'skipped') return { code: 1, line: 'The smoke test did not run: check the projects in the Playwright config' }
  if (t.status === 'failed' && t.message.includes(AUTH_STATE)) return { code: 1, line: `The smoke test found no signed-in state: the sign-in (${e2e.folder}auth.setup.${file.split('.').pop()}) is missing, or it does not save ${AUTH_STATE}` }
  if (t.status === 'failed') return { code: 1, line: `The smoke test failed: ${why(t.message)}` }
  return { code: 0, line: 'ok: the app opens' }
}

// How each unit runner lists the files it would run.
// ponytail: Mocha runs only its spec glob (./test by default), so it is taken to leave the e2e folder alone.
const LISTS = {
  vitest: { packages: ['vitest'], args: ['list', '--filesOnly', '--json'], files: list => list.map(t => t?.file) },
  jest: { packages: ['jest'], args: ['--listTests', '--json'], files: list => list },
}

/** E2E specs the unit runner also picks up, where Playwright's test() fails. { files } or { error }. */
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
