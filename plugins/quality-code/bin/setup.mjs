// Deterministic half of the setup command: --detect scans the repo (read-only), --write validates and writes.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripCredentials } from './branch.mjs'
import { CONFIG_REL, DEFAULTS, configPath, normaliseTicketsDir, personalConfigPath, validateConfig } from '../lib/base/config.mjs'
import { FIELDS_REL } from '../lib/ticket/fields.mjs'
import { CONFIG_FILES, readTestDir } from '../lib/base/e2e-folder.mjs'
import { PLAIN } from '../lib/base/git.mjs'
import { CI_FILES } from '../lib/base/boundary.mjs'

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

// The files that name a Python project's test runner; any of them that mentions pytest makes it pytest.
const PYTHON_FILES = /^(?:pyproject\.toml|pytest\.ini|setup\.cfg|tox\.ini|requirements[\w.-]*\.txt)$/
const DOTNET_FILES = /\.(?:csproj|fsproj|sln)$/

/**
 * The backend runners a repo shows, in the order setup proposes them: Vitest (package.json), pytest,
 * JUnit (Maven or Gradle), Go (go.mod), .NET (a project or solution file, at the top or one folder down).
 */
export function detectBackends(root, deps = {}) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const read = n => { try { return readFileSync(join(root, n), 'utf8').slice(0, 1 << 20) } catch { return '' } }
  const oneDown = re => names.some(n => re.test(n)) || names.some(n => {
    if (n.startsWith('.') || n === 'node_modules') return false
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
  let deps = {}
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJson(pkgPath)
      deps = { ...pkg.dependencies, ...pkg.devDependencies }
    } catch { deps = {} }
  }
  // The backend runner: the first one found; with Playwright too the repo is both (fullstack + backend).
  const backends = detectBackends(root, deps)
  const backend = backends[0] ?? null
  const pw = '@playwright/test' in deps
  const adapter = pw && backend ? 'both' : pw ? 'playwright' : backend
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
    adapter, backend, backends, templates, existing,
    gitignore: hasLine(join(root, '.gitignore'), rawLine(existing?.ticketsDir)),
    boundaries: boundaryCandidates(root),
    vitestConfigs: vitestConfigs(root),
    specsBesideCode: hasSpecBesideCode(join(root, 'src')),
    specFolders: specFolders(root),
    playwrightConfigs: playwrightConfigs(root),
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

export function write(root, config, { templates, gitignoreLine } = {}) {
  const v = validateConfig(config)
  if (!v.ok) return { ok: false, errors: v.errors }
  const errors = []
  const named = [['ticketsDir', config.ticketsDir], ...Object.entries(config.ticketTemplates ?? {}).filter(([, p]) => p !== null).map(([k, p]) => [`ticketTemplates.${k}`, p])]
  for (const [label, p] of named) if (p !== undefined) { const m = pathProblem(root, label, p); if (m) errors.push(m) }
  if (gitignoreLine !== undefined && typeof gitignoreLine !== 'string') errors.push('gitignoreLine: must be text')
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
    for (const line of [gitignoreLine ?? rawLine(config.ticketsDir), FIELDS_REL, ...RUNTIME_GITIGNORE]) {
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
    const r = write(root, proposal?.config, { templates: proposal?.templates })
    if (!r.ok) { process.stdout.write(`${r.errors.join('\n')}\n`); return 2 }
    process.stdout.write('ok\n')
    return 0
  }
  process.stdout.write("usage: setup.mjs --detect | --write '<proposal json>'|@proposal.json | --write-personal '<proposal json>'|@proposal.json\n")
  return 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main(process.argv.slice(2))
