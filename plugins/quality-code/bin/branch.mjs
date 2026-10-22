// Local git facts for /quality-code:start: the branch, its base, what changed, and ticket keys.
// Read-only. Offline, except one `gh pr list` for the branch's GitHub pull request. Never reads diff
// contents. --detect prints one BRANCH_JSON: line.
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from '../lib/base/config.mjs'
import { redact } from '../lib/ticket/sanitize.mjs'
import { adaptersOf } from '../lib/base/stack.mjs'
import { PLAIN } from '../lib/base/git.mjs'
import { e2eFolder } from '../lib/base/e2e-folder.mjs'

const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro|html)$/
const TEST_NAME = /\.(spec|test)\.[^/]+$/

/** The origin URL without any user:password@ part. */
export function stripCredentials(url) {
  if (!url) return null
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/** Ticket keys of the configured projects, in the order found, each once. */
export function keyCandidates(texts, projects) {
  if (!projects.length) return []
  // The configured keys themselves, longest first: MY_PROJ-12 is never also read as PROJ-12.
  const names = [...new Set(projects)].sort((a, b) => b.length - a.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?<![A-Z0-9])(${names.join('|')})[-_](\\d+)(?!\\d)`, 'g')
  const out = []
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(re)) {
      const key = `${m[1]}-${m[2]}`
      if (!out.includes(key)) out.push(key)
    }
  }
  return out
}

/** Playwright test folders: the e2e folder write uses (playwright.folder, else testDir), else e2e/ and tests/. */
export function playwrightTestDirs(root, config) {
  const f = e2eFolder(root, config)
  return f.ok && f.source !== 'default' ? [f.folder] : ['e2e/', 'tests/']
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

// After origin/HEAD and init.defaultBranch; gitflow teams set git.base to their develop.
const FALLBACK_BASES = ['main', 'master', 'develop']

function git(root, args) {
  try {
    return execFileSync('git', [...PLAIN, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).replace(/\n$/, '')
  } catch {
    return null
  }
}

/** The branch's one open GitHub pull request ({ baseRefName, title, body }) from the gh CLI; null without gh, sign-in or exactly one. */
function pullRequest(root, branch) {
  try {
    const prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'baseRefName,title,body', '--limit', '2'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }))
    return prs.length === 1 ? prs[0] : null
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
    files: [], counts: { code: 0, test: 0, other: 0, uncommitted: 0 }, keys: [], subjects: [], pullRequest: null, branches: [],
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
  // Priority: an explicit --base flag, then an open pull request's base, then the configured
  // git.base (a merge request's target branch can differ from origin/HEAD, the repo's default
  // branch), then origin/HEAD, then a guess.
  const local = name => (exists(name) ? name : exists(`origin/${name}`) ? `origin/${name}` : null)
  const configured = config.git?.base
  const pr = rawBranch === null ? null : pullRequest(root, rawBranch)
  const prBase = typeof pr?.baseRefName === 'string' ? local(pr.baseRefName) : null
  if (baseFlag) {
    const ref = local(baseFlag)
    if (ref) Object.assign(out, { base: ref, baseSource: 'flag' })
  } else if (prBase) Object.assign(out, { base: prBase, baseSource: 'pull-request' })
  else if (configured && local(configured)) Object.assign(out, { base: local(configured), baseSource: 'config' })
  else {
    const originHead = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (originHead && exists(originHead)) Object.assign(out, { base: originHead, baseSource: 'origin-head' })
    else {
      const preferred = git(root, ['config', '--get', 'init.defaultBranch'])
      for (const name of [...new Set([preferred, ...FALLBACK_BASES].filter(Boolean))]) {
        const ref = local(name)
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
  // Uncommitted work counts even with no merge base (a shallow CI clone, an orphan branch).
  for (const f of parseStatusZ(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))) files.set(f.path, { ...f, committed: false })

  // git prints paths from the repo top; a project in a subfolder keeps only its own files, relative to itself.
  const prefix = git(root, ['rev-parse', '--show-prefix']) ?? ''
  const playwright = adaptersOf(config).includes('playwright')
  const dirs = playwright ? playwrightTestDirs(root, config) : []
  out.files = [...files.values()]
    .filter(f => f.path.startsWith(prefix))
    .map(f => ({ ...f, path: f.path.slice(prefix.length) }))
    .map(f => ({ path: clean(f.path), status: f.status, kind: kindOf(f.path, playwright ? 'playwright' : config.adapter, dirs), committed: f.committed }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const f of out.files) {
    out.counts[f.kind]++
    if (!f.committed) out.counts.uncommitted++
  }
  const subjects = out.mergeBase && !out.onBase ? (git(root, ['log', '--format=%s', `${out.mergeBase}..HEAD`]) ?? '').split('\n') : []
  out.branch = rawBranch === null ? null : clean(rawBranch)
  out.keys = keyCandidates([out.branch?.toUpperCase(), pr && clean(pr.title).toUpperCase(), ...subjects.map(s => clean(s).toUpperCase())], projects)
  // The branch's own commit messages, newest first and redacted: what a fill-in suggestion may quote.
  out.subjects = subjects.filter(Boolean).slice(0, 20).map(clean)
  if (pr) out.pullRequest = { base: clean(pr.baseRefName), title: clean(pr.title), description: clean(pr.body) }
  return out
}

const I18N = /(?:^|\/)i18n\/[^/]+\.json$|(?:^|\/)locales?\/[^/]+\.json$/
const MAX_COMMITS = 20

/**
 * What a ticket's change touched once it is merged, when the current branch no longer shows it: the
 * diff of the merge commit whose source branch carries the key, else the files of the commits that
 * name it (at most 20). Read-only and offline: nothing is fetched. Translation files count as code,
 * since they hold the texts a screen shows.
 */
export function merged(root, config, key) {
  const out = { key, found: null, commit: null, files: [], counts: { code: 0, test: 0, other: 0 } }
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return out
  const own = new RegExp(`(?<![A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'i')
  const prefix = git(root, ['rev-parse', '--show-prefix']) ?? ''
  const playwright = adaptersOf(config).includes('playwright')
  const dirs = playwright ? playwrightTestDirs(root, config) : []
  const take = list => {
    const seen = new Map()
    for (const f of list) if (f.path?.startsWith(prefix)) seen.set(f.path.slice(prefix.length), f.status)
    out.files = [...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, status]) => {
      const kind = I18N.test(path) ? 'code' : kindOf(path, playwright ? 'playwright' : config.adapter, dirs)
      out.counts[kind]++
      return { path, status, kind }
    })
  }
  // Branches, remotes and tags: --all would also read refs/stash, whose "index on ABC-12-x" is no change.
  const refs = ['--branches', '--remotes', '--tags']
  const merges = (git(root, ['log', ...refs, '--merges', '-i', `--grep=${key}`, '--format=%H%x09%s']) ?? '').split('\n').filter(Boolean)
  // The ticket's branch is the source, not a sync into it: "Merge branch 'ABC-12-total' into 'develop'"
  // (GitLab, git), "Merge pull request #7 from acme/ABC-12-total" (GitHub), "Merged in ABC-12-total (pull request #7)" (Bitbucket).
  const source = s => (/^merge (?:branch|remote-tracking branch) '([^']+)'/i.exec(s) ?? /^merge pull request #\d+ from [^/\s]+\/(\S+)/i.exec(s) ?? /^merged in (\S+) \(pull request #\d+\)/i.exec(s))?.[1] ?? ''
  const merge = merges.map(l => l.split('\t')).find(([, s]) => own.test(source(s)))
  if (merge) {
    out.found = 'merge'
    out.commit = merge[0].slice(0, 7)
    // Three dots: what the branch changed since it forked, not main's later work as deletions.
    take(parseNameStatusZ(git(root, ['diff', '--name-status', '-z', '-M', `${merge[0]}^1...${merge[0]}^2`])))
    return out
  }
  const commits = (git(root, ['log', ...refs, '--no-merges', '-i', `--grep=${key}`, '--format=%H%x09%s']) ?? '').split('\n').filter(Boolean)
    .map(l => l.split('\t')).filter(([, s]) => own.test(s)).slice(0, MAX_COMMITS)
  if (!commits.length) return out
  out.found = 'commits'
  out.commit = commits[0][0].slice(0, 7)
  take(commits.flatMap(([sha]) => parseNameStatusZ(git(root, ['show', '--name-status', '-z', '-M', '--format=', sha]))))
  return out
}

const USAGE = 'usage: branch.mjs --detect [--base <branch>] | --merged <KEY>'

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  if (argv[0] === '--merged') {
    const key = argv[1]
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key ?? '') || argv.length > 2) { process.stderr.write(`${USAGE}\n`); return 2 }
    const root = projectRoot(env, cwd)
    const c = loadConfig(root)
    if (!c.ok) { process.stderr.write(`${c.errors.join('\n')}\n`); return 2 }
    process.stdout.write(`MERGED_JSON:${JSON.stringify(merged(root, c.config, key))}\n`)
    return 0
  }
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
