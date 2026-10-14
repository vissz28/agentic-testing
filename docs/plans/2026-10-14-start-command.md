# `/agentic-testing:start` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily `/agentic-testing:start` command that checks the connectors, confirms the local repo and what the feature branch changed, takes the Jira key from the branch, and evaluates the ticket; setup gets the same connectors check first. Ships as v0.2.1 (Jira: AGT-43).

**Architecture:** One new zero-dependency script, `core/branch.mjs`, reads local git (read-only, no network) and prints one `BRANCH_JSON:` line. The connectors check is written once as `core/connectors.md` and read by both `commands/setup.md` (new step 0) and the new `commands/start.md`. Commands are prompts: their rules are pinned by string tests, as `setup-command.test.mjs` already does.

**Tech Stack:** Node ≥ 18 built-ins only (`node:child_process`, `node:fs`, `node:path`, `node:url`), `node --test`, git CLI, Claude Code plugin commands.

**Spec:** `docs/specs/2026-10-14-start-command-design.md` (read it first; this plan argues from it).

## Global Constraints

- No npm dependencies: imports are `node:*` or relative only.
- Style: 2-space indent, single quotes, no semicolons.
- No project values in `plugins/agentic-testing/core/**`: CI greps for `FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse`. Examples in `core/` and `commands/` use `ABC` / `DEMO` keys.
- No file under `test/` may contain `U` followed by five or more digits (`test/no-ids.test.mjs` scans `test/`); build such a string at runtime (`'U' + '123456'`) when a test needs one. Commit identities in tests use `user@example.test`.
- `branch.mjs` never touches the network and never writes: only `git rev-parse`, `symbolic-ref`, `remote get-url`, `for-each-ref`, `merge-base`, `rev-list`, `diff`, `status`, `log`.
- Diff contents are never read or printed. Only paths, statuses, counts and key candidates leave `branch.mjs`. Commit subjects are used only for key candidates.
- Every path and commit subject goes through `redact(config, text)` from `core/sanitize.mjs` before use or output.
- Jira tools are named by operation (`getAccessibleAtlassianResources`, `getJiraIssue`), never by an `mcp__` name, in every command and in `core/connectors.md`.
- No token, key or password is ever asked for in the chat.
- Root: `projectRoot(env, cwd)` from `core/config.mjs` (`$CLAUDE_PROJECT_DIR`, else cwd).
- Exit codes for `branch.mjs`: `0` with a `BRANCH_JSON:` line; `2` for usage or config errors (message on stderr). Git situations are reported in the JSON, never as an error exit.
- Version `0.2.1` in `plugins/agentic-testing/.claude-plugin/plugin.json`.

## Review Focus

1. **A `--base` value that starts with `-`** (for example `--base --output=x`) would be read by git as an option. Expected: `branch.mjs` refuses it with exit 2 and a plain message. → test in Task 2.
2. **Ticket key written in lower case or joined with `_`** in the branch name (`feature/demo-12_export`, `DEMO-12_export`). Expected: `DEMO-12` is still found. → tests in Task 1 (`keyCandidates`) and Task 2 (lower-case branch).
3. **Paths with spaces or non-ASCII characters** in the change (git quotes them in non-`-z` output). Expected: the real path, unquoted. → test in Task 2 (a file named `docs/my notes.md`).
4. **The user's global git config signs commits or runs hooks** while the tests build temp repos. Expected: tests still pass on a developer machine. → the test helper sets `commit.gpgsign=false` and `core.hooksPath=/dev/null` through `GIT_CONFIG_COUNT` (Task 2).
5. **Local `develop` that is ahead of `origin/develop`, with the user on `develop`.** Expected: `onBase` is true (the user is on the base branch by name), not a list of their unpushed commits as a feature. → test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/agentic-testing/core/branch.mjs` (new) | Pure helpers (`stripCredentials`, `keyCandidates`, `kindOf`, `playwrightTestDirs`, `parseStatusZ`, `parseNameStatusZ`), `detect(root, config, opts)`, CLI `--detect [--base <name>]`. |
| `plugins/agentic-testing/test/branch.test.mjs` (new) | Unit tests for the helpers; `detect` against real temp git repos; CLI exit codes. |
| `plugins/agentic-testing/core/connectors.md` (new) | The connectors check: which connectors, how each is checked, the card, the fixes. |
| `plugins/agentic-testing/commands/setup.md` (modify) | New step 0 that reads `core/connectors.md`. Steps 1–7 unchanged. |
| `plugins/agentic-testing/commands/start.md` (new) | The `start` flow: config, connectors, repo card, key, action. |
| `plugins/agentic-testing/test/connectors.test.mjs` (new) | Pins `core/connectors.md` and setup's step 0. |
| `plugins/agentic-testing/test/start-command.test.mjs` (new) | Pins `commands/start.md`. |
| `plugins/agentic-testing/.claude-plugin/plugin.json` (modify) | Version 0.2.1, description. |
| `README.md`, `docs/GETTING_STARTED.md` (modify) | `start` as the daily command; the connectors card. |

---

### Task 1: Pure helpers in `core/branch.mjs`

**Files:**
- Create: `plugins/agentic-testing/core/branch.mjs`
- Test: `plugins/agentic-testing/test/branch.test.mjs`

**Interfaces:**
- Consumes: nothing yet.
- Produces (exported from `core/branch.mjs`):
  - `stripCredentials(url: string | null): string | null`
  - `keyCandidates(texts: (string | null | undefined)[], projects: string[]): string[]`
  - `kindOf(path: string, adapter: 'playwright' | 'vitest', testDirs?: string[]): 'code' | 'test' | 'other'`
  - `playwrightTestDirs(root: string): string[]` (each entry ends with `/`)
  - `parseStatusZ(out: string): { path: string, status: 'A' | 'M' | 'D' | 'R' }[]`
  - `parseNameStatusZ(out: string): { path: string, status: 'A' | 'M' | 'D' | 'R' }[]`

- [ ] **Step 1: Write the failing tests**

Create `plugins/agentic-testing/test/branch.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { stripCredentials, keyCandidates, kindOf, playwrightTestDirs, parseStatusZ, parseNameStatusZ } from '../core/branch.mjs'

const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('stripCredentials drops user:password@ from URLs and leaves the rest', () => {
  assert.equal(stripCredentials('https://u:p@gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials('https://oauth2@gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials('git@gitlab.example:x.git'), 'git@gitlab.example:x.git')
  assert.equal(stripCredentials('https://gitlab.example/x.git'), 'https://gitlab.example/x.git')
  assert.equal(stripCredentials(null), null)
})
test('keyCandidates keeps configured projects only, in order, without duplicates', () => {
  assert.deepEqual(keyCandidates(['DEMO-12-ADD-EXPORT', 'TRK-7 export', 'OTHER-1 x', 'DEMO-12 again'], ['DEMO', 'TRK']), ['DEMO-12', 'TRK-7'])
  assert.deepEqual(keyCandidates([null, undefined, ''], ['DEMO']), [])
})
test('keyCandidates finds a key joined with _ or / and ignores a longer prefix', () => {
  assert.deepEqual(keyCandidates(['FEATURE/DEMO-12_EXPORT'], ['DEMO']), ['DEMO-12'])
  assert.deepEqual(keyCandidates(['XDEMO-12'], ['DEMO']), [])
  assert.deepEqual(keyCandidates(['DEMO-123'], ['DEMO']), ['DEMO-123'])
})
test('kindOf: tests by name, code by extension, the rest other', () => {
  assert.equal(kindOf('src/a.spec.ts', 'vitest'), 'test')
  assert.equal(kindOf('src/a.test.js', 'vitest'), 'test')
  assert.equal(kindOf('src/a.ts', 'vitest'), 'code')
  assert.equal(kindOf('src/App.vue', 'vitest'), 'code')
  assert.equal(kindOf('README.md', 'vitest'), 'other')
  assert.equal(kindOf('e2e/helpers.ts', 'vitest'), 'code')
  assert.equal(kindOf('e2e/helpers.ts', 'playwright', ['e2e/']), 'test')
})
test('playwrightTestDirs reads a plain testDir, else e2e/ and tests/', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-pw-'))
  assert.deepEqual(playwrightTestDirs(d), ['e2e/', 'tests/'])
  put(d, 'playwright.config.ts', "export default defineConfig({ testDir: './e2e/specs', retries: 0 })")
  assert.deepEqual(playwrightTestDirs(d), ['e2e/specs/'])
  put(d, 'playwright.config.ts', 'export default defineConfig({ testDir: process.env.DIR })')
  assert.deepEqual(playwrightTestDirs(d), ['e2e/', 'tests/'])
})
test('parseStatusZ: untracked is A, renames skip the old path, paths keep spaces', () => {
  const out = ['?? docs/my notes.md', ' M src/a.ts', 'R  src/c.ts', 'src/b.ts', ' D src/gone.ts', 'A  src/new.ts', ''].join('\0')
  assert.deepEqual(parseStatusZ(out), [
    { path: 'docs/my notes.md', status: 'A' },
    { path: 'src/a.ts', status: 'M' },
    { path: 'src/c.ts', status: 'R' },
    { path: 'src/gone.ts', status: 'D' },
    { path: 'src/new.ts', status: 'A' },
  ])
  assert.deepEqual(parseStatusZ(''), [])
})
test('parseNameStatusZ: renames keep the new path, copies count as added', () => {
  const out = ['M', 'src/a.ts', 'R100', 'src/old.ts', 'src/new.ts', 'D', 'src/gone.ts', 'C75', 'src/x.ts', 'src/y.ts', 'T', 'src/t.ts', ''].join('\0')
  assert.deepEqual(parseNameStatusZ(out), [
    { path: 'src/a.ts', status: 'M' },
    { path: 'src/new.ts', status: 'R' },
    { path: 'src/gone.ts', status: 'D' },
    { path: 'src/y.ts', status: 'A' },
    { path: 'src/t.ts', status: 'M' },
  ])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/agentic-testing && node --test test/branch.test.mjs`
Expected: FAIL, `Cannot find module '…/core/branch.mjs'`.

- [ ] **Step 3: Write the helpers**

Create `plugins/agentic-testing/core/branch.mjs`:

```js
// Local git facts for /agentic-testing:start: the branch, its base, what changed, and ticket keys.
// Read-only and offline. Never reads diff contents. --detect prints one BRANCH_JSON: line.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/
const TEST_NAME = /\.(spec|test)\.[^/]+$/
const PW_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']
const KEY = /(?<![A-Z0-9])([A-Z][A-Z0-9]+)-(\d+)(?!\d)/g

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/agentic-testing && node --test test/branch.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/agentic-testing/core/branch.mjs plugins/agentic-testing/test/branch.test.mjs
git commit -m "feat(start): branch helpers for keys, file kinds and git -z parsing (AGT-43)"
```

---

### Task 2: `detect()` and the `--detect` CLI

**Files:**
- Modify: `plugins/agentic-testing/core/branch.mjs` (append)
- Test: `plugins/agentic-testing/test/branch.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 helpers; `loadConfig(root)` and `projectRoot(env, cwd)` from `core/config.mjs`; `redact(config, text)` from `core/sanitize.mjs`.
- Produces:
  - `detect(root: string, config: ValidConfig, opts?: { base?: string }): BranchFacts` where `BranchFacts` is
    `{ repo, remote, isRepo, branch, detached, head, base, baseSource: 'flag'|'origin-head'|'fallback'|null, mergeBase, onBase, shallow, ahead, behind, files: [{ path, status, kind, committed }], counts: { code, test, other, uncommitted }, keys, branches }`.
    `mergeBase` is a short sha or `null` (an addition to the spec's JSON: `start` needs it to tell "no shared history" apart from "no base").
  - `main(argv, env, cwd): number` — `--detect [--base <name>]`.
  - stdout line `BRANCH_JSON:<json>`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/agentic-testing/test/branch.test.mjs` (add the new imports to the top import lines):

```js
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detect } from '../core/branch.mjs'

const BRANCH = join(dirname(fileURLToPath(import.meta.url)), '../core/branch.mjs')
// The user's global git config may sign commits or run hooks; switch both off for the temp repos.
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 'user@example.test',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 'user@example.test',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
}
const g = (d, ...a) => execFileSync('git', a, { cwd: d, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const cfg = (over = {}) => ({
  version: 1, adapter: 'vitest',
  jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], trackingProjects: ['TRK'], acceptanceCriteriaField: null },
  languages: ['en'], features: [], redact: { customerId: '\\bU\\d{5,}\\b' }, ...over,
})
const commit = (d, msg, files) => { for (const [p, s] of Object.entries(files)) put(d, p, s); g(d, 'add', '-A'); g(d, 'commit', '-qm', msg) }
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'at-br-'))
  g(d, 'init', '-q', '-b', 'main')
  commit(d, 'init', { 'src/a.ts': 'a\n', 'src/old.ts': 'old\n' })
  return d
}

test('not a git repo: isRepo false and nothing else', () => {
  const r = detect(mkdtempSync(join(tmpdir(), 'at-nogit-')), cfg())
  assert.equal(r.isRepo, false)
  assert.deepEqual(r.files, [])
  assert.equal(r.base, null)
})
test('feature branch: fallback base, counts, committed and uncommitted files, key from the branch', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-12-add-export')
  commit(d, 'add export', { 'src/b.ts': 'b\n', 'test/b.spec.ts': 't\n', 'README.md': 'r\n' })
  put(d, 'src/a.ts', 'changed\n')
  put(d, 'docs/my notes.md', 'n\n')
  const r = detect(d, cfg())
  assert.equal(r.isRepo, true)
  assert.equal(r.branch, 'DEMO-12-add-export')
  assert.equal(r.base, 'main')
  assert.equal(r.baseSource, 'fallback')
  assert.equal(r.onBase, false)
  assert.equal(r.ahead, 1)
  assert.equal(r.behind, 0)
  assert.ok(r.mergeBase)
  assert.deepEqual(r.counts, { code: 2, test: 1, other: 2, uncommitted: 2 })
  assert.deepEqual(r.files.find(f => f.path === 'docs/my notes.md'), { path: 'docs/my notes.md', status: 'A', kind: 'other', committed: false })
  assert.deepEqual(r.files.find(f => f.path === 'src/a.ts'), { path: 'src/a.ts', status: 'M', kind: 'code', committed: false })
  assert.deepEqual(r.files.find(f => f.path === 'test/b.spec.ts'), { path: 'test/b.spec.ts', status: 'A', kind: 'test', committed: true })
  assert.deepEqual(r.keys, ['DEMO-12'])
  assert.deepEqual(r.files.map(f => f.path), [...r.files.map(f => f.path)].sort())
})
test('behind counts commits on the base after the branch started', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-1-x')
  commit(d, 'x', { 'src/x.ts': 'x\n' })
  g(d, 'checkout', '-q', 'main')
  commit(d, 'other', { 'src/y.ts': 'y\n' })
  g(d, 'checkout', '-q', 'DEMO-1-x')
  const r = detect(d, cfg())
  assert.equal(r.ahead, 1)
  assert.equal(r.behind, 1)
  assert.deepEqual(r.files.map(f => f.path), ['src/x.ts'])
})
test('fallback prefers develop over main', () => {
  const d = repo()
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-2-x')
  assert.equal(detect(d, cfg()).base, 'develop')
})
test('--base wins; an unknown --base gives no base', () => {
  const d = repo()
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-3-x')
  const r = detect(d, cfg(), { base: 'main' })
  assert.equal(r.base, 'main')
  assert.equal(r.baseSource, 'flag')
  const n = detect(d, cfg(), { base: 'nope' })
  assert.equal(n.base, null)
  assert.equal(n.baseSource, null)
  assert.ok(n.branches.includes('develop') && n.branches.includes('main'))
})
test('origin/HEAD wins over the fallback and origin/HEAD is not listed as a branch', () => {
  const d = repo()
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  g(bare, 'init', '-q', '--bare')
  g(d, 'remote', 'add', 'origin', bare)
  g(d, 'push', '-q', 'origin', 'main')
  g(d, 'remote', 'set-head', 'origin', 'main')
  g(d, 'branch', 'develop')
  g(d, 'checkout', '-qb', 'DEMO-4-x')
  const r = detect(d, cfg())
  assert.equal(r.base, 'origin/main')
  assert.equal(r.baseSource, 'origin-head')
  assert.ok(r.branches.includes('origin/main'))
  assert.ok(!r.branches.includes('origin/HEAD') && !r.branches.includes('origin'))
})
test('renames and deletes in committed changes', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'DEMO-5-x')
  g(d, 'mv', 'src/a.ts', 'src/c.ts')
  g(d, 'rm', '-q', 'src/old.ts')
  g(d, 'commit', '-qm', 'move')
  const r = detect(d, cfg())
  assert.deepEqual(r.files.map(f => [f.path, f.status]), [['src/c.ts', 'R'], ['src/old.ts', 'D']])
})
test('key from a commit subject when the branch has none; other projects ignored', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'feature/export')
  commit(d, 'TRK-7 export', { 'src/e.ts': 'e\n' })
  commit(d, 'OTHER-1 nothing', { 'src/f.ts': 'f\n' })
  assert.deepEqual(detect(d, cfg()).keys, ['TRK-7'])
})
test('a lower-case key in the branch name is found', () => {
  const d = repo()
  g(d, 'checkout', '-qb', 'feature/demo-12_export')
  assert.deepEqual(detect(d, cfg()).keys, ['DEMO-12'])
})
test('detached HEAD', () => {
  const d = repo()
  g(d, 'checkout', '-q', '--detach')
  const r = detect(d, cfg())
  assert.equal(r.detached, true)
  assert.equal(r.branch, null)
  assert.ok(r.head)
})
test('on the base branch, even when it is ahead of origin', () => {
  const d = repo()
  assert.equal(detect(d, cfg()).onBase, true)
  const bare = mkdtempSync(join(tmpdir(), 'at-bare-'))
  g(bare, 'init', '-q', '--bare')
  g(d, 'remote', 'add', 'origin', bare)
  g(d, 'branch', 'develop')
  g(d, 'push', '-q', 'origin', 'develop')
  g(d, 'checkout', '-q', 'develop')
  commit(d, 'local only', { 'src/l.ts': 'l\n' })
  assert.equal(detect(d, cfg(), { base: 'origin/develop' }).onBase, true)
})
test('shallow clone with no merge base', () => {
  const src = repo()
  g(src, 'checkout', '-qb', 'DEMO-6-x')
  commit(src, 'feature', { 'src/f.ts': 'f\n' })
  g(src, 'checkout', '-q', 'main')
  commit(src, 'main moves', { 'src/m.ts': 'm\n' })
  const dst = mkdtempSync(join(tmpdir(), 'at-shallow-'))
  g(dst, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${src}`, '.')
  g(dst, 'checkout', '-q', 'DEMO-6-x')
  const r = detect(dst, cfg())
  assert.equal(r.shallow, true)
  assert.equal(r.base, 'origin/main')
  assert.equal(r.mergeBase, null)
  assert.deepEqual(r.files, [])
})
test('remote credentials are stripped and paths are redacted', () => {
  const d = repo()
  g(d, 'remote', 'add', 'origin', 'https://u:p@gitlab.example/x.git')
  g(d, 'checkout', '-qb', 'DEMO-8-x')
  const id = 'U' + '123456'
  commit(d, 'x', { [`fixtures/${id}.json`]: '{}\n' })
  const r = detect(d, cfg())
  assert.equal(r.remote, 'https://gitlab.example/x.git')
  assert.deepEqual(r.files.map(f => f.path), ['fixtures/U######.json'])
})
test('playwright: files under the configured testDir are tests', () => {
  const d = repo()
  commit(d, 'pw', { 'playwright.config.ts': "export default { testDir: './e2e/specs' }\n" })
  g(d, 'checkout', '-qb', 'DEMO-9-x')
  commit(d, 'spec', { 'e2e/specs/orders.ts': 'o\n', 'e2e/helpers.ts': 'h\n' })
  const r = detect(d, cfg({ adapter: 'playwright' }))
  assert.equal(r.files.find(f => f.path === 'e2e/specs/orders.ts').kind, 'test')
  assert.equal(r.files.find(f => f.path === 'e2e/helpers.ts').kind, 'code')
})

const run = (d, ...args) => spawnSync(process.execPath, [BRANCH, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
const withConfig = d => { put(d, '.claude/agentic-testing.json', JSON.stringify(cfg())); return d }

test('CLI: no config exits 2 and says how to set up', () => {
  const r = run(repo(), '--detect')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /agentic-testing:setup/)
})
test('CLI: prints one BRANCH_JSON line', () => {
  const d = withConfig(repo())
  g(d, 'checkout', '-qb', 'DEMO-10-x')
  const r = run(d, '--detect')
  assert.equal(r.status, 0)
  const line = r.stdout.trim().split('\n').find(l => l.startsWith('BRANCH_JSON:'))
  assert.equal(JSON.parse(line.slice('BRANCH_JSON:'.length)).branch, 'DEMO-10-x')
})
test('CLI: usage errors exit 2; a --base that looks like an option is refused', () => {
  const d = withConfig(repo())
  assert.equal(run(d).status, 2)
  assert.equal(run(d, '--detect', '--what').status, 2)
  assert.equal(run(d, '--detect', '--base').status, 2)
  const r = run(d, '--detect', '--base', '--output=x')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /base/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/agentic-testing && node --test test/branch.test.mjs`
Expected: FAIL, `detect` is not exported.

- [ ] **Step 3: Write `detect` and the CLI**

Add to the imports at the top of `plugins/agentic-testing/core/branch.mjs`:

```js
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from './config.mjs'
import { redact } from './sanitize.mjs'
```

(merge `basename` into the existing `node:path` import: `import { basename, join } from 'node:path'`.)

Append:

```js
const FALLBACK_BASES = ['develop', 'main', 'master']

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '')
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
    if (exists(baseFlag)) Object.assign(out, { base: baseFlag, baseSource: 'flag' })
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
    out.onBase = rawBranch === out.base.replace(/^origin\//, '') || git(root, ['rev-parse', 'HEAD']) === git(root, ['rev-parse', out.base])
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

  const dirs = config.adapter === 'playwright' ? playwrightTestDirs(root) : []
  out.files = [...files.values()]
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
```

Notes for the implementer:
- In the shallow test there is no merge base, so neither committed nor uncommitted files are listed: `start` stops on that card anyway (`files` must be `[]`, as the test expects).
- Uppercasing the subjects after redaction keeps `U######` and the key pattern intact.
- `onBase` skips the committed diff, so a user on `develop` ahead of `origin/develop` sees "on the base branch", not their unpushed commits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/agentic-testing && node --test test/branch.test.mjs`
Expected: PASS, all tests (7 from Task 1 plus 17 here).

- [ ] **Step 5: Run the whole suite and the CI grep**

Run: `cd plugins/agentic-testing && npm test && ! grep -rn -E 'FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' core`
Expected: all tests pass; the grep prints nothing.

- [ ] **Step 6: Commit**

```bash
git add plugins/agentic-testing/core/branch.mjs plugins/agentic-testing/test/branch.test.mjs
git commit -m "feat(start): branch.mjs --detect reads base, changes and keys from local git (AGT-43)"
```

---

### Task 3: Connectors check, used by setup

**Files:**
- Create: `plugins/agentic-testing/core/connectors.md`
- Modify: `plugins/agentic-testing/commands/setup.md` (insert step 0 above `1. **Detect.**`)
- Test: `plugins/agentic-testing/test/connectors.test.mjs`

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` (existing; `SETUP_JSON:` line with `adapter`).
- Produces: `core/connectors.md`, which Task 4's `start.md` reads; the card texts below are pinned by tests.

- [ ] **Step 1: Write the failing tests**

Create `plugins/agentic-testing/test/connectors.test.mjs`:

```js
// The connectors check is a prompt read by setup and start: these pin what keeps it safe and usable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../core/connectors.md', import.meta.url), 'utf8')
const setup = readFileSync(new URL('../commands/setup.md', import.meta.url), 'utf8')
const step = (d, n) => d.slice(d.indexOf(`\n${n}. **`), d.indexOf(`\n${n + 1}. **`))

test('Jira is checked with getAccessibleAtlassianResources and blocks', () => {
  assert.match(doc, /getAccessibleAtlassianResources/)
  assert.ok(doc.includes('Jira is required. Type /mcp, choose atlassian-rovo and sign in'))
  assert.ok(doc.includes('1. Check again'))
  assert.match(doc, /Never go past this card without Jira/)
})
test('GitLab and Figma never block', () => {
  assert.match(doc, /GitLab and Figma never block/)
  assert.ok(doc.includes('2. Continue without it'))
})
test('Figma only for playwright', () => {
  assert.match(doc, /Figma only when the adapter is `playwright`/)
  assert.match(doc, /For `vitest`, leave Figma off the card/)
})
test('the card has the three states and the two choices', () => {
  for (const s of ['✅', '⚠️', '➖', '1. Continue', '2. Fix one first']) assert.ok(doc.includes(s), s)
})
test('no token is ever asked for or shown; fixes go through the plugin settings', () => {
  assert.match(doc, /Never ask for a token, key or password in the chat/)
  assert.match(doc, /`gitlab_mcp_url`/)
  assert.match(doc, /`figma_api_key`/)
  assert.match(doc, /Do not paste it here/)
})
test('connector status is not written to the config', () => {
  assert.match(doc, /Nothing here is written to `\.claude\/agentic-testing\.json`/)
})
test('tools are named by operation, never by an mcp__ name', () => {
  assert.doesNotMatch(doc, /mcp__/)
})
test('setup step 0 reads the connectors check before detecting', () => {
  const s = step(setup, 0)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/core/connectors.md'))
  assert.ok(setup.indexOf('\n0. **Connectors.**') < setup.indexOf('\n1. **Detect.**'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/agentic-testing && node --test test/connectors.test.mjs`
Expected: FAIL, `ENOENT … core/connectors.md`.

- [ ] **Step 3: Write `core/connectors.md`**

Create `plugins/agentic-testing/core/connectors.md` with exactly this content:

````markdown
# Connectors check

Shared by `/agentic-testing:setup` (step 0) and `/agentic-testing:start` (step 1). Check, show one card, fix what the user picks. Never ask for a token, key or password in the chat, and never repeat one: personal values live in the plugin settings, which keep secrets in the system keychain. Nothing here is written to `.claude/agentic-testing.json`.

**Which connectors.** Jira (Atlassian) and GitLab always. Figma only when the adapter is `playwright`: read `adapter` from `.claude/agentic-testing.json`; without a config, run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read `adapter` from its `SETUP_JSON:` line (`both` counts as `playwright`). For `vitest`, leave Figma off the card.

**Check each one with a single read-only call:**

| Connector | Check | ✅ when |
|---|---|---|
| Jira (Atlassian) | `getAccessibleAtlassianResources`, on whichever Atlassian connection is available (the plugin's `atlassian-rovo` or one connected in claude.ai) | it returns at least one site; show its host |
| GitLab | find a GitLab connector tool in this session and make one read-only call with it (the current user, or one project) | the call answers |
| Figma | find a Figma connector tool in this session and make one read-only call with it | the call answers |

A connector whose tools are missing, that asks to sign in, or whose call errors is not ✅. Do not retry a failed call during this check.

**The card.** Show it and end the turn:

```
Connectors
  ✅ Jira (Atlassian)   <site host>
  ⚠️ GitLab             <one-line reason>; optional now, needed later for merge-request links
  ➖ Figma              <one-line reason>; optional, used for frontend design comparison
1. Continue
2. Fix one first
```

✅ connected, ⚠️ configured but failing, ➖ not set up or not available.

- **Jira not ✅.** Show this card instead, with no way to continue, and end the turn:

  ```
  Jira is required. Type /mcp, choose atlassian-rovo and sign in (or connect Atlassian in claude.ai).
  1. Check again
  2. Stop
  ```

  `1` runs this check again. `2` stops the command. Never go past this card without Jira.
- **1. Continue:** go on. GitLab and Figma never block.
- **2. Fix one first:** list the connectors that are not ✅ as a numbered card, end the turn, and show the fix for the one picked:
  - Jira: the sign-in line above.
  - GitLab: "The GitLab address is the `gitlab_mcp_url` plugin setting. Change it from the `/plugin` menu (agentic-testing, configure), then type /mcp to reconnect gitlab." If you know the address the check tried, show it; never show a token.
  - Figma: "The Figma key is the `figma_api_key` plugin setting. Set it from the `/plugin` menu (agentic-testing, configure). Do not paste it here."

  Then show `1. Check again / 2. Continue without it` and end the turn. `1` runs the whole check again.
````

- [ ] **Step 4: Add step 0 to setup**

In `plugins/agentic-testing/commands/setup.md`, insert this line directly above the line that starts `1. **Detect.**`:

```markdown
0. **Connectors.** Read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it. Go on to step 1 only when its card lets you continue.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd plugins/agentic-testing && node --test test/connectors.test.mjs test/setup-command.test.mjs`
Expected: PASS (the existing setup-command tests are unchanged: their `step(n)` slices for n ≥ 1 still start at `\n1. **`).

- [ ] **Step 6: Run the CI grep**

Run: `cd plugins/agentic-testing && ! grep -rn -E 'FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' core`
Expected: prints nothing.

- [ ] **Step 7: Commit**

```bash
git add plugins/agentic-testing/core/connectors.md plugins/agentic-testing/commands/setup.md plugins/agentic-testing/test/connectors.test.mjs
git commit -m "feat(setup): check Jira, GitLab and Figma connectors first (AGT-43)"
```

---

### Task 4: The `start` command

**Files:**
- Create: `plugins/agentic-testing/commands/start.md`
- Test: `plugins/agentic-testing/test/start-command.test.mjs`

**Interfaces:**
- Consumes: `cli.mjs config check` (prints `ok` or error lines); `core/connectors.md` (Task 3); `branch.mjs --detect [--base]` and its `BRANCH_JSON` fields (Task 2: `isRepo`, `detached`, `head`, `branch`, `remote`, `repo`, `base`, `mergeBase`, `shallow`, `onBase`, `ahead`, `behind`, `files`, `counts`, `keys`, `branches`); `commands/setup.md` and `commands/ticket-eval.md` (existing).
- Produces: `/agentic-testing:start`; Part 4 later replaces the "available with part 4" branch of step 4.

- [ ] **Step 1: Write the failing tests**

Create `plugins/agentic-testing/test/start-command.test.mjs`:

```js
// The start command is a prompt, not code: these pin its flow and its safety rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../commands/start.md', import.meta.url), 'utf8')
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? undefined : doc.indexOf(`\n${n + 1}. **`))

test('steps come in order: config, connectors, repo, ticket, action', () => {
  const at = ['\n0. **Config.**', '\n1. **Connectors.**', '\n2. **Repo.**', '\n3. **Ticket.**', '\n4. **Action.**'].map(s => doc.indexOf(s))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('step 0: no config offers setup, then continues at the repo card', () => {
  const s = step(0)
  assert.ok(s.includes('cli.mjs" config check'))
  assert.ok(s.includes('This repo is not set up yet.'))
  assert.ok(s.includes('1. Run setup now'))
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/setup.md'))
  assert.match(s, /continue at step 2/)
})
test('step 1 reads the shared connectors check', () => {
  assert.ok(step(1).includes('${CLAUDE_PLUGIN_ROOT}/core/connectors.md'))
})
test('step 2: branch script, merge-request base, and every git situation has its card', () => {
  const s = step(2)
  assert.ok(s.includes('core/branch.mjs" --detect'))
  assert.match(s, /target branch/)
  assert.match(s, /`--base` in `\$ARGUMENTS` wins/)
  for (const t of [
    'This folder is not a git repo.',
    'No branch is checked out',
    'No base branch found.',
    'History is too short to compare. Run `git fetch --unshallow`, then start again.',
    'shares no history with',
    'No feature-branch changes against',
    'Work on this repo?',
    '1. Yes, use this',
    '2. Use a different base branch',
    '1. Evaluate a ticket by key',
  ]) assert.ok(s.includes(t), t)
})
test('step 3: key from the branch first, then the merge-request title, then commits; always confirmed', () => {
  const s = step(3)
  assert.match(s, /appears in the branch name/)
  assert.match(s, /merge request title/)
  assert.ok(s.includes('1. Use <KEY>'))
  assert.ok(s.includes('2. A different ticket'))
})
test('step 4: evaluate runs ticket-eval unchanged; the pipeline waits for part 4', () => {
  const s = step(4)
  assert.ok(s.includes('1. Evaluate the ticket'))
  assert.ok(s.includes('2. Run the full pipeline (available with part 4)'))
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md'))
  assert.match(s, /Writing and grading tests for any project comes with part 4/)
})
test('the change never feeds the score, and no diff content is shown', () => {
  assert.match(doc, /never changes the score/)
  assert.match(doc, /Never read or show diff contents/)
})
test('no token in the chat; tools by operation name', () => {
  assert.match(doc, /Never ask for a token/)
  assert.doesNotMatch(doc, /mcp__/)
})
test('examples use neutral keys', () => {
  assert.doesNotMatch(doc, /FIC|warehouse/i)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/agentic-testing && node --test test/start-command.test.mjs`
Expected: FAIL, `ENOENT … commands/start.md`.

- [ ] **Step 3: Write `commands/start.md`**

Create `plugins/agentic-testing/commands/start.md` with exactly this content:

````markdown
---
description: Start from your feature branch. Checks the connectors, confirms the repo and what your branch changed, finds the Jira ticket from the branch name, and evaluates it.
argument-hint: [--base <branch>]
---

Daily entry point. You ask and relay; the scripts detect and score. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Scripts decide.** `branch.mjs` reads git; `cli.mjs` scores. Never compute a count, a base or a score yourself.
- **Never read or show diff contents**, file contents of the change or commit subjects. Use only what `BRANCH_JSON` gives: paths, statuses, kinds and counts. The change never changes the score.
- **Never ask for a token**, key or password in the chat.
- Refer to Jira tools by operation name on the Atlassian connector; GitLab tools by what they do.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/<script>" …`. Drop the machine lines (`BRANCH_JSON:`, `TICKET_EVAL_JSON:`) when you show output.

## Steps

0. **Config.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config check`. If it prints `ok`, go to step 1. Otherwise show its lines, then this card and end the turn:

   ```
   This repo is not set up yet.
   1. Run setup now
   2. Stop
   ```

   On `1`, read `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` and follow it. When setup is done, continue at step 2 (setup has just checked the connectors). On `2`, stop.
1. **Connectors.** Read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it. Go on only when its card lets you continue.
2. **Repo.** If GitLab is connected, look for an open merge request whose source branch is the current branch (`git branch --show-current`). If there is exactly one, its target branch is the base: remember the merge request's title for step 3 and pass `--base <target branch>`. A `--base` in `$ARGUMENTS` wins over it. Run `node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect [--base <name>]` and read the `BRANCH_JSON:` line. Then the first case that applies, each as a card, ending the turn:
   - `isRepo` is false: `This folder is not a git repo.` then `1. Evaluate a ticket by key / 2. Stop`.
   - `detached` is true: `No branch is checked out (at <head>).` then `1. Evaluate a ticket by key / 2. Stop`.
   - `base` is null: `No base branch found.` then the `branches` as a numbered list. Run detect again with `--base <picked>`.
   - `mergeBase` is null and `shallow` is true: say History is too short to compare. Run `git fetch --unshallow`, then start again. Then stop.
   - `mergeBase` is null: `This branch shares no history with <base>.` then `1. Pick another base / 2. Evaluate a ticket by key / 3. Stop`.
   - `onBase` is true, or `files` is empty: `No feature-branch changes against <base>.` then `1. Evaluate a ticket by key / 2. Pick another base / 3. Stop`.
   - Otherwise the repo card (leave out the `(origin: …)` part when `remote` is null, and the `+ … not committed yet` part when `counts.uncommitted` is 0):

     ```
     Work on this repo?
       Repo      <repo>   (origin: <remote>)
       Branch    <branch>
       Base      <base>   (<ahead> commits ahead, <behind> behind)
       Changes   <files.length> files: <counts.code> code, <counts.test> tests, <counts.other> other   + <counts.uncommitted> not committed yet
     1. Yes, use this
     2. Use a different base branch
     3. Stop
     ```

   "Pick another base" and `2. Use a different base branch` show `branches` as a numbered list and run detect again with `--base <picked>`. "Evaluate a ticket by key" asks `Which ticket? Type its key, for example ABC-123.` and goes to step 4, option 1, with that key.
3. **Ticket.** Propose one key, the first that applies: `keys[0]` when it appears in the branch name (ignoring case); else the first key in the merge request title from step 2 whose project is in `jira.projects` or `jira.trackingProjects`; else `keys[0]`. Show `1. Use <KEY>` / `2. A different ticket` and end the turn. With no key at all, ask `Which ticket? Type its key, for example ABC-123.` A key from a project not in the config is handled by ticket-eval's project check.
4. **Action.** Show this card and end the turn:

   ```
   <KEY> on <branch> (<files.length> files changed against <base>)
   1. Evaluate the ticket
   2. Run the full pipeline (available with part 4)
   3. Stop
   ```

   - **1:** read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow it with `<KEY>` as `$ARGUMENTS`, no flags. After its result, add one line: `Branch <branch>: <files.length> files changed against <base> (<counts.code> code, <counts.test> tests, <counts.other> other).` The branch never changes the score.
   - **2:** say `Writing and grading tests for any project comes with part 4. For now you can evaluate the ticket.` and show the card again as `1. Evaluate the ticket / 2. Stop`.
   - **3:** stop.
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/agentic-testing && node --test test/start-command.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/agentic-testing/commands/start.md plugins/agentic-testing/test/start-command.test.mjs
git commit -m "feat(start): /agentic-testing:start from the feature branch to the ticket (AGT-43)"
```

---

### Task 5: Version, docs, and validation

**Files:**
- Modify: `plugins/agentic-testing/.claude-plugin/plugin.json`
- Modify: `README.md` (Quick start, "What you can do today", "Set up your project", Developing tree)
- Modify: `docs/GETTING_STARTED.md` (sections 3 and 4)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: release v0.2.1.

- [ ] **Step 1: Bump the plugin**

In `plugins/agentic-testing/.claude-plugin/plugin.json` set `"version": "0.2.1"` and the description to:

```
"From a Jira ticket to graded tests, for any project. Setup, a daily start from your feature branch (connectors, branch changes, ticket from the branch name), the readiness gate (70 points, Gherkin or 150+ characters of plain criteria), guided fill-in, Jira comment and push."
```

- [ ] **Step 2: README, Quick start**

In `README.md`, replace step 3 of "Quick start" (the block starting `**3. Check a ticket.**` up to the code block that follows it) with:

````markdown
**3. Every day, start from your feature branch.**

```
/agentic-testing:start
```

It checks your connectors, shows the branch and what it changed, takes the ticket key from the
branch name (`ABC-123-add-export`), and evaluates that ticket. To check any ticket directly:
`/agentic-testing:ticket-eval ABC-123`.
````

- [ ] **Step 3: README, other sections**

- In "What you can do today", add this row directly under the "Guided setup" row:
  `| Start from your feature branch: connectors, branch changes, ticket from the branch name | \`/agentic-testing:start\` | ✅ available |`
- In "Set up your project", add above the numbered list: `Setup first checks the connectors (Jira required; GitLab and Figma optional) and shows what is connected, missing or broken, with the fix for each. Keys are set in the plugin settings, never typed in the chat.`
- In the Developing tree, change `commands/                     setup.md, ticket-eval.md` to `commands/                     setup.md, start.md, ticket-eval.md` and add `branch, connectors.md` to the `core/` list.

- [ ] **Step 4: GETTING_STARTED**

In `docs/GETTING_STARTED.md`:
- At the start of section 3 add: `Setup first shows a Connectors card: Jira must be connected; GitLab and Figma are optional and never stop you. Keys go in the plugin settings, never in the chat.`
- Rename section 4 to `## 4. Every day: start from your branch` and put this first in it:

````markdown
Check out your feature branch (named with the ticket key, for example `ABC-123-add-export`), then:

```
/agentic-testing:start
```

You confirm the repo card (branch, base, how many files changed), confirm the ticket key, and pick
`1. Evaluate the ticket`. The rest of this section is what you then see. To check a ticket that has
no branch yet, use `/agentic-testing:ticket-eval ABC-123`.
````

- [ ] **Step 5: Run everything**

Run:
```bash
cd plugins/agentic-testing && npm test && cd ../.. && claude plugin validate plugins/agentic-testing && claude plugin validate . && ! grep -rn -E 'FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' plugins/agentic-testing/core
```
Expected: all tests pass (405 existing + the new ones), both validations pass, the grep prints nothing.

- [ ] **Step 6: Check the README links**

Run:
```bash
node -e 'const fs=require("fs");const t=fs.readFileSync("README.md","utf8");const slug=h=>h.toLowerCase().replace(/[^\w\- ]/g,"").replace(/ /g,"-");const heads=new Set([...t.matchAll(/^#+ (.+)$/gm)].map(m=>slug(m[1])));let bad=0;for(const m of t.matchAll(/\]\(([^)]+)\)/g)){const l=m[1];if(l.startsWith("http"))continue;if(l.startsWith("#")?!heads.has(l.slice(1)):!fs.existsSync(l.split("#")[0])){console.log("BAD",l);bad++}}process.exit(bad?1:0)'
```
Expected: exit 0, nothing printed.

- [ ] **Step 7: Commit**

```bash
git add plugins/agentic-testing/.claude-plugin/plugin.json README.md docs/GETTING_STARTED.md
git commit -m "release: agentic-testing 0.2.1 with /agentic-testing:start (AGT-43)"
```

- [ ] **Step 8: Release (ask the user first; it publishes to every team)**

After the user says yes:

```bash
claude plugin tag plugins/agentic-testing
git push origin main --follow-tags
```

Then move AGT-43 to the status the user asks for.

- [ ] **Step 9: Try it by hand (no commit)**

In the plugin repo itself (it has no `.claude/agentic-testing.json`), run `node plugins/agentic-testing/core/branch.mjs --detect`. Expected: exit 2 with `This repo is not set up. Run /agentic-testing:setup.` Then in a scratch copy of a set-up repo on a `DEMO-1-x` branch, run it again and check that `BRANCH_JSON` names the branch, the base and the changed files.
