// Local git facts for /quality-code:start: the branch, its base, what changed, and ticket keys.
// Read-only and offline. Never reads diff contents. --detect prints one BRANCH_JSON: line.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from './config.mjs'
import { redact } from './sanitize.mjs'

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/
const TEST_NAME = /\.(spec|test)\.[^/]+$/
const PW_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']
const KEY = /(?<![A-Z0-9])([A-Z][A-Z0-9]+)[-_](\d+)(?!\d)/g

/** The origin URL without any user:password@ part. */
export function stripCredentials(url) {
  if (!url) return null
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/** Ticket keys of the configured projects, in the order found, each once. */
export function keyCandidates(texts, projects) {
  const allowed = new Set(projects)
  const out = []
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(KEY)) {
      const key = `${m[1]}-${m[2]}`
      if (allowed.has(m[1]) && !out.includes(key)) out.push(key)
    }
  }
  return out
}

/** Playwright test folders: testDir from the config when it is a plain string, else e2e/ and tests/. */
export function playwrightTestDirs(root) {
  for (const name of PW_CONFIGS) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(/testDir\s*:\s*['"`]([^'"`$]+)['"`]/)
    if (m) return [m[1].replace(/^\.\//, '').replace(/\/?$/, '/')]
  }
  return ['e2e/', 'tests/']
}

export function kindOf(path, adapter, testDirs = []) {
  if (TEST_NAME.test(path)) return 'test'
  if (adapter === 'playwright' && testDirs.some(d => path.startsWith(d))) return 'test'
  return CODE_EXT.test(path) ? 'code' : 'other'
}

/** `git status --porcelain=v1 -z` → files. Untracked counts as added; a rename is followed by its old path. */
export function parseStatusZ(out) {
  const t = String(out ?? '').split('\0')
  const files = []
  for (let i = 0; i < t.length; i++) {
    const e = t[i]
    if (!e) continue
    const xy = e.slice(0, 2)
    if (/[RC]/.test(xy)) i++
    const status = xy === '??' ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M'
    files.push({ path: e.slice(3), status })
  }
  return files
}

/** `git diff --name-status -z -M` → files. Renames keep the new path; copies count as added. */
export function parseNameStatusZ(out) {
  const t = String(out ?? '').split('\0')
  const files = []
  for (let i = 0; i < t.length; i++) {
    const code = t[i]
    if (!code) continue
    if (/^[RC]/.test(code)) {
      files.push({ path: t[i + 2], status: code[0] === 'R' ? 'R' : 'A' })
      i += 2
    } else {
      files.push({ path: t[i + 1], status: 'ADM'.includes(code[0]) ? code[0] : 'M' })
      i += 1
    }
  }
  return files
}

const FALLBACK_BASES = ['develop', 'main', 'master']

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).replace(/\n$/, '')
  } catch {
    return null
  }
}

export function detect(root, config, { base: baseFlag } = {}) {
  const projects = [...config.jira.projects, ...(config.jira.trackingProjects ?? [])]
  const clean = t => redact(config, t)
  const out = {
    repo: basename(root), remote: null, isRepo: false, branch: null, detached: false, head: null,
    base: null, baseSource: null, mergeBase: null, onBase: false, shallow: false, ahead: 0, behind: 0,
    files: [], counts: { code: 0, test: 0, other: 0, uncommitted: 0 }, keys: [], branches: [],
  }
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return out
  out.isRepo = true
  out.remote = stripCredentials(git(root, ['remote', 'get-url', 'origin']))
  out.head = git(root, ['rev-parse', '--short', 'HEAD'])
  const rawBranch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  out.detached = rawBranch === null && out.head !== null
  out.shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true'
  out.branches = (git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']) ?? '')
    .split('\n').filter(b => b && b !== 'origin' && b !== 'origin/HEAD')

  const exists = ref => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null
  if (baseFlag) {
    const ref = exists(baseFlag) ? baseFlag : exists(`origin/${baseFlag}`) ? `origin/${baseFlag}` : null
    if (ref) Object.assign(out, { base: ref, baseSource: 'flag' })
  } else {
    const originHead = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (originHead && exists(originHead)) Object.assign(out, { base: originHead, baseSource: 'origin-head' })
    else {
      for (const name of FALLBACK_BASES) {
        const ref = exists(name) ? name : exists(`origin/${name}`) ? `origin/${name}` : null
        if (ref) { Object.assign(out, { base: ref, baseSource: 'fallback' }); break }
      }
    }
  }

  const files = new Map()
  if (out.base && out.head) {
    out.onBase = rawBranch === out.base.replace(/^origin\//, '')
    out.mergeBase = git(root, ['merge-base', out.base, 'HEAD'])
    if (out.mergeBase) {
      const [behind, ahead] = (git(root, ['rev-list', '--left-right', '--count', `${out.base}...HEAD`]) ?? '0 0').split(/\s+/).map(Number)
      Object.assign(out, { ahead, behind })
      if (!out.onBase) {
        for (const f of parseNameStatusZ(git(root, ['diff', '--name-status', '-z', '-M', out.mergeBase, 'HEAD']))) files.set(f.path, { ...f, committed: true })
      }
      out.mergeBase = out.mergeBase.slice(0, 7)
    }
  }
  if (out.mergeBase || !out.base) {
    for (const f of parseStatusZ(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))) files.set(f.path, { ...f, committed: false })
  }

  // git prints paths from the repo top; a project in a subfolder keeps only its own files, relative to itself.
  const prefix = git(root, ['rev-parse', '--show-prefix']) ?? ''
  const dirs = config.adapter === 'playwright' ? playwrightTestDirs(root) : []
  out.files = [...files.values()]
    .filter(f => f.path.startsWith(prefix))
    .map(f => ({ ...f, path: f.path.slice(prefix.length) }))
    .map(f => ({ path: clean(f.path), status: f.status, kind: kindOf(f.path, config.adapter, dirs), committed: f.committed }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const f of out.files) {
    out.counts[f.kind]++
    if (!f.committed) out.counts.uncommitted++
  }
  const subjects = out.mergeBase && !out.onBase ? (git(root, ['log', '--format=%s', `${out.mergeBase}..HEAD`]) ?? '').split('\n') : []
  out.branch = rawBranch === null ? null : clean(rawBranch)
  out.keys = keyCandidates([out.branch?.toUpperCase(), ...subjects.map(s => clean(s).toUpperCase())], projects)
  return out
}

const USAGE = 'usage: branch.mjs --detect [--base <branch>]'

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  if (argv[0] !== '--detect') { process.stderr.write(`${USAGE}\n`); return 2 }
  const opts = {}
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1] !== undefined) {
      opts.base = argv[++i]
      if (opts.base.startsWith('-') || !opts.base.trim()) { process.stderr.write(`--base needs a branch name, not "${opts.base}"\n`); return 2 }
    } else { process.stderr.write(`${USAGE}\n`); return 2 }
  }
  const root = projectRoot(env, cwd)
  const c = loadConfig(root)
  if (!c.ok) { process.stderr.write(`${c.errors.join('\n')}\n`); return 2 }
  process.stdout.write(`BRANCH_JSON:${JSON.stringify(detect(root, c.config, opts))}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main()
