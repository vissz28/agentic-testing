// Deterministic half of the setup command: --detect scans the repo (read-only), --write validates and writes.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripCredentials } from './branch.mjs'
import { CONFIG_REL, DEFAULTS, configPath, normaliseTicketsDir, projectRoot, validateConfig } from '../lib/base/config.mjs'
import { FIELDS_REL } from '../lib/ticket/fields.mjs'
import { CONFIG_FILES, readTestDir } from '../lib/base/e2e-folder.mjs'
import { PLAIN } from '../lib/base/git.mjs'

const TEMPLATE_CANDIDATES = {
  bug: ['.gitlab/issue_templates/Bug.md', '.github/ISSUE_TEMPLATE/bug.md'],
  story: ['.gitlab/issue_templates/Story.md', '.github/ISSUE_TEMPLATE/story.md'],
}

export const RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*', '.claude/quality-code/audit/']

const rawLine = ticketsDir => `${normaliseTicketsDir(typeof ticketsDir === 'string' ? ticketsDir : DEFAULTS.ticketsDir)}/*/raw.json`

function boundaryCandidates(root) {
  let names = []
  try { names = readdirSync(root) } catch {}
  const exists = p => existsSync(join(root, p.replace(/\/$/, '')))
  // Order: code folders, environment files, CI files.
  return [
    ...['src/', 'prisma/', 'migrations/', 'dapr/'].filter(exists),
    ...(exists('.env') ? ['.env'] : []),
    ...(names.some(n => /^\.env\..+/.test(n)) ? ['.env.*'] : []),
    ...['.gitlab-ci.yml', '.github/workflows/'].filter(exists),
  ]
}

const VITEST_CONFIG = /^vitest(\.[\w-]+)?\.config\.[cm]?[jt]s$|^vitest\.config(\.[\w-]+)?\.[cm]?[jt]s$/

function vitestConfigs(root) {
  let names = []
  try { names = readdirSync(root) } catch {}
  return names.filter(n => VITEST_CONFIG.test(n)).sort()
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

/** { host, path } of a GitLab-style remote (https or scp form), credentials dropped; else null. */
export function remoteProject(url) {
  const u = stripCredentials(url)
  if (!u) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u) || /^[^@\s/]+@([^:\s]+):(.+?)(?:\.git)?\/?$/.exec(u)
  return m ? { host: m[1], path: m[2] } : null
}

/** Where the project lives: its folder, the git repo around it, and the origin's GitLab project. */
function here(root) {
  const top = gitOut(root, ['rev-parse', '--show-toplevel'])
  if (!top) return { folder: basename(root), repoTop: null, subfolder: null, gitlab: null }
  const prefix = gitOut(root, ['rev-parse', '--show-prefix'])
  return { folder: basename(root), repoTop: basename(top), subfolder: prefix ? prefix.replace(/\/$/, '') : null, gitlab: remoteProject(gitOut(root, ['remote', 'get-url', 'origin'])) }
}

export function detect(root) {
  let adapter = null
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJson(pkgPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const pw = '@playwright/test' in deps
      const vt = 'vitest' in deps
      adapter = pw && vt ? 'both' : pw ? 'playwright' : vt ? 'vitest' : null
    } catch { adapter = null }
  }
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
    playwrightConfigs: playwrightConfigs(root),
    here: here(root)
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

  const found = detect(root).templates
  const toWrite = []
  const paths = { bug: found.bug, story: found.story }
  for (const kind of ['bug', 'story']) {
    if (typeof templates?.[kind] !== 'string' || found[kind]) continue
    const p = TEMPLATE_CANDIDATES[kind][0]
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

function main(argv) {
  const root = projectRoot()
  if (argv[0] === '--detect') {
    process.stdout.write(`SETUP_JSON:${JSON.stringify(detect(root))}\n`)
    return 0
  }
  if (argv[0] === '--write' && argv[1]) {
    const ref = argv[1].startsWith('@') ? argv[1].slice(1) : argv[1]
    let proposal
    try { proposal = readJson(resolve(root, ref)) } catch (err) {
      process.stdout.write(`proposal: cannot read ${ref} (${err.message})\n`)
      return 2
    }
    const r = write(root, proposal?.config, { templates: proposal?.templates })
    if (!r.ok) { process.stdout.write(`${r.errors.join('\n')}\n`); return 2 }
    process.stdout.write('ok\n')
    return 0
  }
  process.stdout.write('usage: setup.mjs --detect | --write @proposal.json\n')
  return 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main(process.argv.slice(2))
