# Part 2: shared checks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five deterministic checks that grade generated tests (boundary, honesty, suite-honesty, flaky, assertion-mutation) live in the `quality-code` plugin as one merged version each, driven by the project config, with the same verdicts as both warehouse copies (Jira: AGT-42, release v0.4.0).

**Architecture:** New zero-dependency modules under `plugins/quality-code/core/checks/`. A *dialect* (`vitest` | `playwright`, from `config.adapter`) holds every syntax rule that differs between the two warehouse copies, so the merged code reproduces each copy exactly. Checks that need to run tests take an injected `runTests` function (the runners arrive with parts 3–4). Every check returns one result shape; `core/checks/cli.mjs` prints it and sets the exit code. A parity suite replays fixtures captured from the old warehouse scripts.

**Tech Stack:** Node ≥ 18 built-ins only, `node --test`, git CLI, Claude Code plugin hooks.

**Spec:** `docs/specs/2026-10-14-part-2-shared-checks-design.md` (read it first; this plan argues from it).

## Global Constraints

- No npm dependencies: imports are `node:*` or relative only.
- Style: 2-space indent, single quotes, no semicolons.
- No project values in `plugins/quality-code/core/**`: CI greps for `FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse`; this plan adds `AGT` for `core/checks/`. Keys come from `jira.projects` ∪ `jira.trackingProjects`.
- No file under `test/` may contain `U` followed by five or more digits (`test/no-ids.test.mjs`); parity fixtures are masked with `mask()` from `test/parity/sanitize-inputs.mjs` before they are written.
- Quality bars are fixed: mutation bar 100% (any survivor fails); flaky runs default 5; a stale run marker is older than 6 hours.
- Result shape (spec §5.4): `{ check, status: 'pass'|'fail'|'not_run', summary, findings: [{ file, line, test, kind, detail }], data }`.
- CLI exit codes (spec §6): `0` pass, `1` fail, `2` usage or config error, `3` not run. `--json` prints only the result; otherwise a short report and a last line `CHECK_JSON:<result>`.
- Paths the user gives (`--range`, `--base`-like values) must not start with `-`.
- Git calls are read-only and set `GIT_OPTIONAL_LOCKS=0`.
- Files written into a team repo: only `.claude/quality-code/boundary.jsonl` (hook log) and temp `mut-tmp-*.spec.ts` siblings during mutation (always removed).
- Version `0.4.0`.

## Rulings this plan makes (record them in the spec, Task 11)

1. **The dialect holds more than spec §5.1 lists.** The two warehouse copies differ in honesty (FE forgives moved/re-indented `expect(` lines and re-tagged tests, and requires a ticket tag on `@anchor`/`@finding`; BE flags a removed `describe(` and counts `.only/.concurrent/.each` declarations), in suite-honesty (BE inherits `describe.skip`; FE excludes capture tests) and in mutation (different expect regex, test regex, operators and mutant policy). Each lives in the dialect so parity is exact.
2. **`--key` with no matching block is `not_run`** (spec §5.2). Today's backend grades the whole file instead. Added to spec §9 as #7.
3. **The frontend's `HARNESS_BOUNDARY_OVERRIDE=1` is dropped.** The hook only acts during a run; to lift it, a person removes `.claude/quality-code/run.active`. Added to spec §9 as #8.
4. **Runner contract gains optional `broken: [{ file, message }]`** (files that never got collected). The backend's flaky check turns a green verdict into an error when a file never ran; the merged check returns `not_run` then.
5. **Setup's gitignore gains `mut-tmp-*`** next to the two runtime lines, so a leftover mutant can never be committed.

## Review Focus

1. **A changed path with spaces, quotes or non-ASCII characters** in boundary diff mode. Expected: matched and reported as the real path (git `-z` output). → test in Task 5.
2. **`NotebookEdit` hook payloads carry `notebook_path`, not `file_path`.** Expected: a notebook write to a forbidden path is denied during a run. → test in Task 5.
3. **The hook in a folder with no config, or with `CLAUDE_PROJECT_DIR` pointing outside a git repo.** Expected: allow, exit 0, nothing printed. → test in Task 5.
4. **Glob edge cases:** `src/` must not match `src-tauri/x`, `**/*.pem` must match a top-level `a.pem`, `.env.*` must not match `.env`. → test in Task 5.
5. **A test title with regex characters** (`a (b) + c`) handed to the runner. Expected: the runner receives the exact title (escaping is the runner's job, parts 3–4), and the mutant is graded against that test only. → test in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `core/config.mjs` (modify) | Accept and validate `boundaries`. |
| `schema/quality-code.schema.json` (modify) | Document `boundaries`. |
| `core/checks/result.mjs` | Result shape, `EXIT`. |
| `core/checks/keys.mjs` | Configured project keys as a regex source; `isProjectKey`. |
| `core/checks/git.mjs` | `specDiff`, `changedPaths` (read-only). |
| `core/checks/dialects/vitest.mjs`, `playwright.mjs`, `index.mjs` | Syntax rules per stack; `dialectFor(adapter)`. |
| `core/checks/honesty.mjs` | Removed assertions/tests, untracked skips, anchor tags. |
| `core/checks/suite-honesty.mjs` | Hollow tests, anchor scoping, groups. |
| `core/checks/boundary.mjs` | Path rules, diff mode, hook mode, run marker. |
| `core/checks/flaky.mjs` | Re-run loop and classification over an injected runner. |
| `core/checks/mutation.mjs` | Mutant planning, temp-file loop, score and gate. |
| `core/checks/cli.mjs` | `node core/checks/cli.mjs <check> …`; `runCheck()` for parts 3–4. |
| `hooks/hooks.json` | `PreToolUse` → `cli.mjs boundary --hook`. |
| `core/setup.mjs`, `commands/setup.md` (modify) | Boundary candidates, the boundaries card, gitignore lines. |
| `scripts/capture-parity.mjs` (modify) | `--checks` mode. |
| `test/checks/*.test.mjs`, `test/parity-checks.test.mjs`, `test/parity/checks/**` | Tests and parity data. |

All paths below are relative to `plugins/quality-code/` unless they start with `scripts/`, `docs/`, `.github/` or are `README.md` / `CHANGELOG.md`.

---

### Task 1: `boundaries` in the config

**Files:**
- Modify: `core/config.mjs` (`FIELDS`, and a block before `if (e.length) return { ok: false, errors: e }`)
- Modify: `schema/quality-code.schema.json`
- Test: `test/config.test.mjs` (append)

**Interfaces:**
- Produces: a validated config may carry `boundaries: { forbidden?: [{ path, why? }], allow?: string[] }`; when absent it stays absent (Task 5 supplies defaults).

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.mjs` (it already defines `good` and `bad`; read the top of the file to confirm their names before appending):

```js
test('boundaries: forbidden rules with optional why, and allow patterns', () => {
  const r = validateConfig({ ...good, boundaries: { forbidden: [{ path: 'src/' }, { path: '.env', why: 'shared systems' }], allow: ['src/**/*.spec.ts'] } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.config.boundaries.allow, ['src/**/*.spec.ts'])
})
test('boundaries: absent stays absent', () => {
  assert.equal(validateConfig(good).config.boundaries, undefined)
})
test('boundaries: each wrong part is named', () => {
  const r = validateConfig({ ...good, boundaries: { forbidden: [{ path: '../x' }, { path: '/abs' }, { path: 'ok/', why: '' }, { path: 'a', extra: 1 }], allow: ['a\nb'], other: [] } })
  assert.deepEqual(r.errors, [
    'boundaries.other: unknown field (only "forbidden" and "allow")',
    'boundaries.forbidden[0].path "../x" must be a relative path inside the project (no "..", not absolute, one line)',
    'boundaries.forbidden[1].path "/abs" must be a relative path inside the project (no "..", not absolute, one line)',
    'boundaries.forbidden[2].why: must be one non-empty line',
    'boundaries.forbidden[3].extra: unknown field (only "path" and "why")',
    'boundaries.allow[0] "a\\nb" must be a relative path inside the project (no "..", not absolute, one line)',
  ])
})
bad({ boundaries: [] }, 'boundaries')
bad({ boundaries: { forbidden: [] } }, 'boundaries.forbidden')
bad({ boundaries: { allow: 'src/' } }, 'boundaries.allow')
test('the schema documents boundaries', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const b = schema.properties.boundaries
  assert.equal(b.type, 'object')
  assert.equal(b.additionalProperties, false)
  assert.equal(b.properties.forbidden.minItems, 1)
  assert.ok(!schema.required.includes('boundaries'))
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/config.test.mjs`
Expected: FAIL (`boundaries: unknown field`).

- [ ] **Step 3: Implement**

In `core/config.mjs`, add `'boundaries'` to the `FIELDS` set. Insert directly before `if (e.length) return { ok: false, errors: e }`:

```js
  if (c.boundaries !== undefined) {
    const where = p => `must be a relative path inside the project (no "..", not absolute, one line)`
    const pathOk = p => typeof p === 'string' && p.trim() !== '' && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..') && !/[\r\n]/.test(p)
    if (!isObj(c.boundaries)) e.push('boundaries: must be an object with "forbidden" and/or "allow"')
    else {
      for (const k of Object.keys(c.boundaries)) if (k !== 'forbidden' && k !== 'allow') e.push(`boundaries.${k}: unknown field (only "forbidden" and "allow")`)
      const f = c.boundaries.forbidden
      if (f !== undefined) {
        if (!Array.isArray(f) || f.length === 0) e.push('boundaries.forbidden: must be a non-empty list of { "path", "why" }')
        else f.forEach((r, i) => {
          if (!isObj(r)) { e.push(`boundaries.forbidden[${i}]: must be an object with "path" and an optional "why"`); return }
          if (!pathOk(r.path)) e.push(`boundaries.forbidden[${i}].path ${JSON.stringify(r.path)} ${where()}`)
          if (r.why !== undefined && (typeof r.why !== 'string' || !r.why.trim() || /[\r\n]/.test(r.why))) e.push(`boundaries.forbidden[${i}].why: must be one non-empty line`)
          for (const k of Object.keys(r)) if (k !== 'path' && k !== 'why') e.push(`boundaries.forbidden[${i}].${k}: unknown field (only "path" and "why")`)
        })
      }
      const a = c.boundaries.allow
      if (a !== undefined) {
        if (!Array.isArray(a)) e.push('boundaries.allow: must be a list of path patterns')
        else a.forEach((p, i) => { if (!pathOk(p)) e.push(`boundaries.allow[${i}] ${JSON.stringify(p)} ${where()}`) })
      }
    }
  }
```

In `schema/quality-code.schema.json`, add under `properties` (after `ticketsDir`):

```json
    "boundaries": {
      "type": "object",
      "additionalProperties": false,
      "description": "Paths a test-writing run may never write. Absent: src/, .env, .env.* and the detected CI file. dist/, node_modules/, .git/ and this config are always forbidden.",
      "properties": {
        "forbidden": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["path"],
            "properties": {
              "path": { "type": "string", "pattern": "^(?!/)[^\\r\\n]+$", "description": "A prefix ending in / (src/), an exact file (.env), or a glob with * (one segment) and ** (any depth). Relative, no \"..\"." },
              "why": { "type": "string", "pattern": "^[^\\r\\n]+$", "description": "One line shown when a write is refused." }
            }
          }
        },
        "allow": { "type": "array", "items": { "type": "string", "pattern": "^(?!/)[^\\r\\n]+$" }, "description": "Exceptions inside a forbidden path, for example src/**/*.spec.ts." }
      }
    },
```

- [ ] **Step 4: Run to see them pass, then the whole suite**

Run: `cd plugins/quality-code && node --test test/config.test.mjs && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: config tests PASS; suite `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/config.mjs plugins/quality-code/schema/quality-code.schema.json plugins/quality-code/test/config.test.mjs
git commit -m "feat(checks): boundaries in the team config (AGT-42)"
```

---

### Task 2: Check foundations: result, keys, git, dialects

**Files:**
- Create: `core/checks/result.mjs`, `core/checks/keys.mjs`, `core/checks/git.mjs`, `core/checks/dialects/vitest.mjs`, `core/checks/dialects/playwright.mjs`, `core/checks/dialects/index.mjs`
- Test: `test/checks/foundation.test.mjs`, helper `test/checks/git-env.mjs`
- Modify: `package.json` (test glob must include `test/checks/`)

**Interfaces:**
- Produces:
  - `EXIT = { pass: 0, fail: 1, not_run: 3 }`; `result(check, status, summary, findings = [], data = {})`
  - `projectKeys(config): string[]`; `keySource(config): string` (regex source like `(?:ABC|TRK)-\d+`); `isProjectKey(config, key): boolean`
  - `specDiff(root, paths, range?) → { ok: true, diff } | { ok: false, error }`; `changedPaths(root, range?) → { ok: true, paths } | { ok: false, error }`
  - `dialectFor(adapter) → dialect` with `name`, `groupRe`, `honesty: { removedDecl, forgiveMoves, anchorTags }`, `suite: { testRe, notYet, skippedGroups, isCapture(title) }` (Task 7 adds `mutation`).

- [ ] **Step 1: Check the test glob**

`package.json` runs `node --test "test/**/*.test.mjs"`. Node's glob `**` covers `test/checks/`. Confirm with `cd plugins/quality-code && node --test "test/**/*.test.mjs" 2>&1 | tail -1` after Step 2 creates the folder; no change is needed if the new tests are listed. If they are not, change the script to `node --test "test/*.test.mjs" "test/**/*.test.mjs"`.

- [ ] **Step 2: Write the failing tests**

Create `test/checks/git-env.mjs` (shared by every test that builds a temp repo; a helper, not a test file, so importing it never re-runs tests):

```js
// The user's global git config may sign commits or run hooks; switch both off for temp repos.
export const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 'user@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 'user@example.test',
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
}
```

Create `test/checks/foundation.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { EXIT, result } from '../../core/checks/result.mjs'
import { keySource, isProjectKey, projectKeys } from '../../core/checks/keys.mjs'
import { specDiff, changedPaths } from '../../core/checks/git.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

import { ENV } from './git-env.mjs'

const cfg = { jira: { projects: ['ABC'], trackingProjects: ['T.K'] } }
const g = (d, ...a) => execFileSync('git', a, { cwd: d, env: ENV, encoding: 'utf8' })
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('result shape and exit codes', () => {
  assert.deepEqual(result('honesty', 'pass', 'ok'), { check: 'honesty', status: 'pass', summary: 'ok', findings: [], data: {} })
  assert.deepEqual(EXIT, { pass: 0, fail: 1, not_run: 3 })
})
test('keys come from projects and tracking projects, regex-escaped', () => {
  assert.deepEqual(projectKeys(cfg), ['ABC', 'T.K'])
  assert.equal(keySource(cfg), '(?:ABC|T\\.K)-\\d+')
  assert.equal(isProjectKey(cfg, 'ABC-12'), true)
  assert.equal(isProjectKey(cfg, 'TXK-1'), false)
  assert.equal(isProjectKey(cfg, 'ABC-12 '), false)
})
test('git: spec diff against HEAD and changed paths with spaces and untracked files', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-git-'))
  g(d, 'init', '-q', '-b', 'main')
  put(d, 'test/a.spec.ts', "it('a', () => { expect(1).toBe(1) })\n")
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init')
  put(d, 'test/a.spec.ts', "it('a', () => {})\n")
  put(d, 'src/my file.ts', 'x\n')
  const sd = specDiff(d, ['test/a.spec.ts'])
  assert.equal(sd.ok, true)
  assert.match(sd.diff, /^-it\('a', \(\) => \{ expect/m)
  assert.deepEqual(changedPaths(d).paths.sort(), ['src/my file.ts', 'test/a.spec.ts'])
  assert.equal(specDiff(d, ['x'], 'nope...HEAD').ok, false)
  assert.equal(changedPaths(mkdtempSync(join(tmpdir(), 'qc-nogit-'))).ok, false)
})
test('dialects', () => {
  const v = dialectFor('vitest')
  const p = dialectFor('playwright')
  assert.equal(v.name, 'vitest')
  assert.equal(p.name, 'playwright')
  assert.equal(v.suite.notYet, 'todo')
  assert.equal(p.suite.notYet, 'fixme')
  assert.equal(v.honesty.removedDecl.test("describe('x', () => {"), true)
  assert.equal(p.honesty.removedDecl.test("describe('x', () => {"), false)
  assert.equal(p.suite.isCapture('ABC-1 — design-conformance capture'), true)
  assert.equal(v.suite.isCapture('ABC-1 — design-conformance capture'), false)
  assert.throws(() => dialectFor('jest'), /no dialect/)
})
```

- [ ] **Step 3: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/foundation.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`core/checks/result.mjs`:

```js
// One result shape for every check (spec §5.4), and the CLI exit codes (spec §6).
export const EXIT = Object.freeze({ pass: 0, fail: 1, not_run: 3 })

export function result(check, status, summary, findings = [], data = {}) {
  return { check, status, summary, findings, data }
}
```

`core/checks/keys.mjs`:

```js
// Ticket keys of the configured projects: tracked skips, anchor tags and --key.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const projectKeys = config => [...config.jira.projects, ...(config.jira.trackingProjects ?? [])]

/** Regex source for one key of a configured project, like (?:ABC|TRK)-\d+ */
export const keySource = config => `(?:${projectKeys(config).map(esc).join('|')})-\\d+`

export const isProjectKey = (config, key) => new RegExp(`^${keySource(config)}$`).test(String(key))
```

`core/checks/git.mjs`:

```js
// The only git calls the checks make. Read-only; never takes the index lock.
import { execFileSync } from 'node:child_process'

function git(root, args) {
  try {
    const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1e8, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message).trim().split('\n')[0] }
  }
}

/** Unified diff of the given paths, against HEAD or over a range like A...B. */
export function specDiff(root, paths, range = null) {
  const r = git(root, ['diff', ...(range ? [range] : ['HEAD']), '--', ...paths])
  return r.ok ? { ok: true, diff: r.out } : r
}

/** Every path changed against HEAD (or over a range), plus untracked files; relative to root. */
export function changedPaths(root, range = null) {
  const d = git(root, ['diff', '--name-only', '--relative', '-z', ...(range ? [range] : ['HEAD'])])
  if (!d.ok) return d
  const u = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (!u.ok) return u
  const paths = `${d.out}\0${u.out}`.split('\0').filter(Boolean)
  return { ok: true, paths: [...new Set(paths)] }
}
```

`core/checks/dialects/vitest.mjs`:

```js
// Vitest syntax, as the backend checks read it.
export const name = 'vitest'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:it|test|describe)(?:\.(?:only|concurrent|each))?\s*\(/,
  forgiveMoves: false,
  anchorTags: false,
}

export const suite = {
  testRe: /\b(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'todo',
  skippedGroups: true,
  isCapture: () => false,
}
```

`core/checks/dialects/playwright.mjs`:

```js
// Playwright syntax, as the frontend checks read it.
export const name = 'playwright'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^test\.describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:test|it)(?:\.(?:describe|only))?\s*\(/,
  forgiveMoves: true,
  anchorTags: true,
}

export const suite = {
  testRe: /\b(?:test|it)(?:\.(skip|fixme|only))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'fixme',
  skippedGroups: false,
  // Design-conformance captures screenshot and never assert; they are not graded.
  isCapture: title => /conformance|capture/i.test(title),
}
```

`core/checks/dialects/index.mjs`:

```js
import * as playwright from './playwright.mjs'
import * as vitest from './vitest.mjs'

const DIALECTS = { playwright, vitest }

export function dialectFor(adapter) {
  const d = DIALECTS[adapter]
  if (!d) throw new Error(`no dialect for adapter "${adapter}"`)
  return d
}
```

- [ ] **Step 5: Run to see them pass; run the glob check of Step 1**

Run: `cd plugins/quality-code && node --test test/checks/foundation.test.mjs && npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: 4 PASS; the suite total grows by 4 and `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/quality-code/core/checks plugins/quality-code/test/checks plugins/quality-code/package.json
git commit -m "feat(checks): result shape, project keys, git helpers and dialects (AGT-42)"
```

---

### Task 3: `honesty.mjs`

**Files:**
- Create: `core/checks/honesty.mjs`
- Test: `test/checks/honesty.test.mjs`

**Interfaces:**
- Consumes: `result`, `keySource`, `specDiff`, dialect `honesty`.
- Produces: `scanDiff(diff, dialect, keySrc) → [{ file, kind, line }]` (kinds: `assertion removed`, `test removed`, `test newly skipped`, `anchor tag without a ticket tag`); `run({ specs, range }, ctx) → result` with `data: { removedAssertions, removedTests, newSkips, untaggedAnchors }`.

- [ ] **Step 1: Write the failing tests (both warehouse self-tests, ported)**

Create `test/checks/honesty.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanDiff } from '../../core/checks/honesty.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

const KEYS = '(?:FIC|AGT)-\\d+'
const be = s => scanDiff(`+++ b/x.spec.ts\n${s}`, dialectFor('vitest'), KEYS)
const fe = s => scanDiff(`+++ b/x.spec.ts\n${s}`, dialectFor('playwright'), KEYS)
const kinds = v => v.map(x => x.kind)

test('vitest: the backend self-test', () => {
  assert.equal(be("+  expect(x).toBe(1)\n+it('n', () => {})").length, 0)
  assert.ok(kinds(be('-  expect(x).toBe(1)')).includes('assertion removed'))
  assert.ok(kinds(be("-it('t', () => {})")).includes('test removed'))
  assert.ok(kinds(be("-describe('t', () => {})")).includes('test removed'))
  assert.ok(kinds(be("+it.skip('t', () => {})")).includes('test newly skipped'))
  assert.ok(kinds(be("+describe.skip('t', () => {})")).includes('test newly skipped'))
  assert.equal(be("+it.todo('t')").length, 0)
  assert.equal(be("+it.skip('flaky (AGT-8)', () => {})").length, 0)
  assert.ok(kinds(be("+it.skip('flaky', () => {})")).includes('test newly skipped'))
  assert.equal(be("-it.skip('t', () => {})").length, 0)
  assert.equal(be("-it.skip('t', () => {})\n+it('t', () => {})").length, 0)
})
test('vitest: no move forgiveness (backend behaviour)', () => {
  assert.ok(kinds(be('-  expect(x).toBe(1)\n+    expect(x).toBe(1)')).includes('assertion removed'))
})
test('playwright: the frontend self-test', () => {
  assert.equal(fe("+  await expect(x).toBeVisible()\n+test('n', async () => {})").length, 0)
  assert.ok(kinds(fe('-  await expect(x).toBeVisible()')).includes('assertion removed'))
  assert.ok(kinds(fe("-test('t', async () => {})")).includes('test removed'))
  assert.ok(kinds(fe("+test.skip('t', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("+test.fixme('t', async () => {})").length, 0)
  assert.equal(fe("-test.skip('t', async () => {})").length, 0)
  assert.ok(kinds(fe("-it('t', async () => {})")).includes('test removed'))
  assert.ok(kinds(fe("+it.skip('t', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("+test.skip('flaky (AGT-8)', async () => {})").length, 0)
  assert.equal(fe("+it.skip('flaky (FIC-1234)', async () => {})").length, 0)
  assert.ok(kinds(fe("+test.skip('flaky', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("-test('FIC-1-1-a', async ({ page }) => {\n+test('FIC-1-1-a', { tag: ['@anchor', '@FIC-1'] }, async ({ page }) => {").length, 0)
  assert.equal(fe("-test('FIC-1-1-a', async () => {\n+test(\n+  'FIC-1-1-a',\n+  ANCHOR,").length, 0)
  assert.ok(kinds(fe("-test('FIC-1-1-a', async () => {\n+test('FIC-1-1-b', async () => {")).includes('test removed'))
  assert.equal(fe('-  await expect(x).toBeVisible()\n+    await expect(x).toBeVisible()').length, 0)
  assert.equal(fe('-  await expect(x).toBeVisible()\n-  await expect(x).toBeVisible()\n+    await expect(x).toBeVisible()').filter(v => v.kind === 'assertion removed').length, 1)
  assert.ok(kinds(fe('-  await expect(x).toBeVisible()\n+    await expect(x).toBeHidden()')).includes('assertion removed'))
  assert.ok(kinds(fe("-test('t', async () => {\n+++ b/y.spec.ts\n+test('t', async () => {")).includes('test removed'))
  assert.equal(fe("+test('FIC-1-1-a', { tag: ['@anchor', '@FIC-1'] }, async () => {})").length, 0)
  assert.equal(fe("+  { tag: ['@finding', '@AGT-7'] },").length, 0)
  assert.ok(kinds(fe("+test('a', { tag: '@anchor' }, async () => {})")).includes('anchor tag without a ticket tag'))
})
test('tracked keys come from the config, not from fixed projects', () => {
  const v = scanDiff("+++ b/x.spec.ts\n+it.skip('flaky (ABC-3)', () => {})\n+it.skip('flaky (AGT-3)', () => {})", dialectFor('vitest'), '(?:ABC)-\\d+')
  assert.deepEqual(v.map(x => x.line), ["it.skip('flaky (AGT-3)', () => {})"])
})
test('violations carry no internal title field', () => {
  assert.deepEqual(Object.keys(be("-it('t', () => {})")[0]).sort(), ['file', 'kind', 'line'])
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/honesty.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `core/checks/honesty.mjs`:

```js
// Honesty: did the change to a spec remove an assertion or a test, or skip one without a ticket?
// Static analysis of a git diff. The dialect decides what counts as a test declaration and
// whether moved lines are forgiven (see the plan's Ruling 1).
import { keySource } from './keys.mjs'
import { specDiff } from './git.mjs'
import { result } from './result.mjs'

const SKIP = [/\b(?:it|test|describe)\.skip\b/, /\.skip\s*\(/]

/** The title of a test(/it( declaration on the same line; else null. */
function testTitle(line) {
  return /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])(.+?)\1/.exec(line)?.[2] ?? null
}

export function scanDiff(diff, dialect, keySrc) {
  const h = dialect.honesty
  const tracked = new RegExp(`\\b${keySrc}\\b`)
  const taggedKey = new RegExp(`['"\`]@${keySrc}['"\`]`)
  const out = []
  const added = new Set()
  const addedLines = new Map()
  let file = null
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) continue
    if (raw.startsWith('-')) {
      const body = raw.slice(1)
      if (/\bexpect\s*\(/.test(body)) out.push({ file, kind: 'assertion removed', line: body.trim() })
      else if (h.removedDecl.test(body)) out.push({ file, kind: 'test removed', line: body.trim(), title: testTitle(body) })
    } else if (raw.startsWith('+')) {
      const body = raw.slice(1)
      if (h.forgiveMoves) {
        const lineKey = `${file}\0${body.trim()}`
        addedLines.set(lineKey, (addedLines.get(lineKey) ?? 0) + 1)
        // Formatters put a long title on its own line, so a bare string-literal line is a title too.
        const title = testTitle(body) ?? /^\s*(['"`])(.+?)\1,\s*$/.exec(body)?.[2]
        if (title) added.add(`${file}\0${title}`)
      }
      if (h.anchorTags && /['"`]@(?:anchor|finding)['"`]/.test(body) && !taggedKey.test(body))
        out.push({ file, kind: 'anchor tag without a ticket tag', line: body.trim() })
      if (SKIP.some(re => re.test(body)) && !tracked.test(body))
        out.push({ file, kind: 'test newly skipped', line: body.trim() })
    }
  }
  const kept = !h.forgiveMoves ? out : out.filter(v => {
    // A removed test( re-added with the same title was edited; a removed expect( re-added verbatim
    // (bar indentation) only moved. Each re-add covers one removal.
    if (v.kind === 'test removed') return !(v.title && added.has(`${v.file}\0${v.title}`))
    if (v.kind !== 'assertion removed') return true
    const key = `${v.file}\0${v.line}`
    const left = addedLines.get(key) ?? 0
    if (!left) return true
    addedLines.set(key, left - 1)
    return false
  })
  return kept.map(({ title, ...v }) => v)
}

export function run({ specs, range = null }, ctx) {
  const d = specDiff(ctx.root, specs, range)
  if (!d.ok) return result('honesty', 'not_run', `cannot read the git diff: ${d.error}`)
  const v = scanDiff(d.diff, ctx.dialect, keySource(ctx.config))
  const count = k => v.filter(x => x.kind === k).length
  const data = {
    removedAssertions: count('assertion removed'),
    removedTests: count('test removed'),
    newSkips: count('test newly skipped'),
    untaggedAnchors: count('anchor tag without a ticket tag'),
  }
  const findings = v.map(x => ({ file: x.file, kind: x.kind, detail: x.line }))
  if (!v.length) return result('honesty', 'pass', 'no assertion or test removed, no skip without a ticket', [], data)
  return result('honesty', 'fail', `${v.length} honesty problem(s): ${[...new Set(v.map(x => x.kind))].join(', ')}`, findings, data)
}
```

- [ ] **Step 4: Run to see them pass**

Run: `cd plugins/quality-code && node --test test/checks/honesty.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/checks/honesty.mjs plugins/quality-code/test/checks/honesty.test.mjs
git commit -m "feat(checks): honesty check merged from both warehouse copies (AGT-42)"
```

---

### Task 4: `suite-honesty.mjs`

**Files:**
- Create: `core/checks/suite-honesty.mjs`
- Test: `test/checks/suite-honesty.test.mjs`

**Interfaces:**
- Consumes: `result`, dialect `groupRe` and `suite`.
- Produces: `groups(src, dialect)`, `skippedGroupRanges(src, dialect)`, `anchorRange(src, key, dialect) → [start, end] | null`, `scoreSpec(src, dialect) → [{ title, mod, expects, idx, capture }]`, `grade(files: [{ path, src }], { key }, dialect) → result`, `run({ specs, key }, ctx) → result` with `data: { tests, withAssertion, hollow, todo, skipped, capture, percent }`. Task 7 imports `anchorRange`.

- [ ] **Step 1: Write the failing tests**

Create `test/checks/suite-honesty.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorRange, grade, scoreSpec, skippedGroupRanges } from '../../core/checks/suite-honesty.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

const V = dialectFor('vitest')
const P = dialectFor('playwright')

test('vitest: the backend self-test', () => {
  const t = scoreSpec("it('a', () => { expect(x).toBe(1) });it.skip('b', () => { expect(y).toBe(2) });it.todo('c');test('d', () => { doThing() })", V)
  assert.equal(t.length, 4)
  assert.ok(t[0].expects === 1 && !t[0].mod)
  assert.equal(t[1].mod, 'skip')
  assert.ok(t[2].mod === 'todo' && t[2].expects === 0)
  assert.ok(!t[3].mod && t[3].expects === 0)
  const wrapped = scoreSpec('describe.skip("FIC-1 — bug", () => {' + "it('a', () => { expect(x).toBe(1) });it('b', () => { expect(y).toBe(2) });})", V)
  assert.ok(wrapped.every(w => w.mod === 'skip'))
  assert.equal(scoreSpec(`describe("FIC-1 — bug", () => { it('a', () => { expect(x).toBe(1) }); })`, V)[0].mod, null)
  assert.equal(skippedGroupRanges(`describe("A", () => {});\ndescribe.skip("B", () => {});`, V).length, 1)
  assert.notEqual(anchorRange('describe.skip("FIC-9 — x", () => {});', 'FIC-9', V), null)
  const scoped = "it('legacy-hollow', () => { doLegacy() });\ndescribe('FIC-9 — anchor', () => {\n  it('inside', () => { expect(z).toBe(3) });\n});\ndescribe('OTHER — later', () => { it('other-hollow', () => {}) });\n"
  const r = anchorRange(scoped, 'FIC-9', V)
  const inside = scoreSpec(scoped, V).filter(x => x.idx >= r[0] && x.idx < r[1])
  assert.deepEqual(inside.map(x => x.title), ['inside'])
  assert.equal(anchorRange(scoped, 'FIC-404', V), null)
})
test('playwright: the frontend self-test', () => {
  const t = scoreSpec("test('a', () => { expect(x).toBe(1) });test.skip('b', () => { expect(y).toBe(2) });test('c capture', () => { page.screenshot() });test.fixme('d', () => {});test('e', () => { page.goto('/x') })", P)
  assert.equal(t.length, 5)
  assert.ok(t[0].expects === 1 && !t[0].capture && !t[0].mod)
  assert.equal(t[1].mod, 'skip')
  assert.ok(t[2].capture)
  assert.ok(t[3].mod === 'fixme' && t[3].expects === 0)
  assert.ok(!t[4].mod && !t[4].capture && t[4].expects === 0)
  const it = scoreSpec("it('f', () => { expect(z).toBe(3) });it('g', () => { doNothing() })", P)
  assert.ok(it[0].expects === 1 && !it[0].mod && !it[1].mod && it[1].expects === 0)
})
test('grade: a hollow test fails and is named', () => {
  const r = grade([{ path: 'a.spec.ts', src: "it('ok', () => { expect(1).toBe(1) });it('empty', () => { run() })" }], {}, V)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings, [{ file: 'a.spec.ts', test: 'empty', kind: 'hollow test', detail: 'runs but has no expect()' }])
  assert.equal(r.data.percent, 50)
})
test('grade: nothing asserting at all fails; one todo next to a real test passes', () => {
  assert.equal(grade([{ path: 'a', src: "it.todo('x');it.todo('y')" }], {}, V).status, 'fail')
  const ok = grade([{ path: 'a', src: "it('x', () => { expect(1).toBe(1) });it.todo('y')" }], {}, V)
  assert.equal(ok.status, 'pass')
  assert.deepEqual(ok.data, { tests: 2, withAssertion: 1, hollow: 0, todo: 1, skipped: 0, capture: 0, percent: 50 })
})
test('grade: capture tests are left out (playwright)', () => {
  const r = grade([{ path: 'a', src: "test('ABC-1 — design-conformance capture', () => { shot() });test('b', () => { expect(1).toBe(1) })" }], {}, P)
  assert.equal(r.status, 'pass')
  assert.equal(r.data.capture, 1)
  assert.equal(r.data.tests, 1)
})
test('grade --key: only the anchor block; a missing block is not_run (Ruling 2)', () => {
  const src = "it('old-hollow', () => {});\ndescribe('ABC-9 — anchor', () => {\n  it('in', () => { expect(1).toBe(1) })\n})\n"
  assert.equal(grade([{ path: 'a', src }], { key: 'ABC-9' }, V).status, 'pass')
  const miss = grade([{ path: 'a', src }], { key: 'ABC-10' }, V)
  assert.equal(miss.status, 'not_run')
  assert.match(miss.summary, /no ABC-10 block/)
})
test('grade --key works for playwright groups too', () => {
  const src = "test('old', () => {});\ntest.describe('ABC-9 — anchor', () => {\n  test('in', async () => { await expect(x).toBeVisible() })\n})\n"
  assert.equal(grade([{ path: 'a', src }], { key: 'ABC-9' }, P).status, 'pass')
  assert.equal(grade([{ path: 'a', src }], {}, P).status, 'fail')
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/suite-honesty.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `core/checks/suite-honesty.mjs`:

```js
// Suite honesty: does every test that runs carry an assertion? Static; no model opinion.
// A hollow test (runs, asserts nothing) fails the check; so does a run where no test asserts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { result } from './result.mjs'

/** Top-level groups (column 0): { idx, mod, title }. */
export function groups(src, dialect) {
  const re = new RegExp(dialect.groupRe.source, 'gm')
  const out = []
  let m
  while ((m = re.exec(src))) out.push({ idx: m.index, mod: m[1] || null, title: m[3] })
  return out
}

/** Char ranges of top-level skipped groups: a test inside one never runs. */
export function skippedGroupRanges(src, dialect) {
  const tops = groups(src, dialect)
  return tops.map((t, i) => (t.mod === 'skip' ? [t.idx, i + 1 < tops.length ? tops[i + 1].idx : src.length] : null)).filter(Boolean)
}

/** [start, end) of the top-level group whose title holds the key, up to the next top-level group. */
export function anchorRange(src, key, dialect) {
  const tops = groups(src, dialect)
  const start = tops.find(t => t.title.includes(key))
  if (!start) return null
  const next = tops.find(t => t.idx > start.idx)
  return [start.idx, next ? next.idx : src.length]
}

export function scoreSpec(src, dialect) {
  const s = dialect.suite
  const re = new RegExp(s.testRe.source, 'g')
  const skipRanges = s.skippedGroups ? skippedGroupRanges(src, dialect) : []
  const marks = []
  let m
  while ((m = re.exec(src))) marks.push({ mod: m[1] || null, title: m[3], idx: m.index })
  return marks.map((mk, i) => {
    // A test's slice runs up to the next test, so strip comments before counting expect( calls.
    const body = src
      .slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const expects = (body.match(/\bexpect\s*\(/g) || []).length
    const inSkipped = skipRanges.some(([a, b]) => mk.idx >= a && mk.idx < b)
    return { title: mk.title, mod: inSkipped ? 'skip' : mk.mod, expects, idx: mk.idx, capture: s.isCapture(mk.title) }
  })
}

export function grade(files, { key = null } = {}, dialect) {
  let behavioral = 0
  let honest = 0
  let skipped = 0
  let notYet = 0
  let capture = 0
  const hollow = []
  for (const { path, src } of files) {
    let tests = scoreSpec(src, dialect)
    if (key) {
      const r = anchorRange(src, key, dialect)
      if (!r) return result('suite-honesty', 'not_run', `no ${key} block in ${path}`, [{ file: path, kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
      tests = tests.filter(t => t.idx >= r[0] && t.idx < r[1])
    }
    for (const t of tests) {
      if (t.capture) { capture++; continue }
      if (t.mod === dialect.suite.notYet) notYet++
      if (t.mod === 'skip') skipped++
      behavioral++
      if (!t.mod && t.expects >= 1) honest++
      if (!t.mod && t.expects === 0) hollow.push({ file: path, test: t.title })
    }
  }
  const percent = behavioral ? Math.round((honest / behavioral) * 100) : 100
  const data = { tests: behavioral, withAssertion: honest, hollow: hollow.length, todo: notYet, skipped, capture, percent }
  if (hollow.length) {
    return result('suite-honesty', 'fail', `${hollow.length} test(s) run but assert nothing`,
      hollow.map(h => ({ file: h.file, test: h.test, kind: 'hollow test', detail: 'runs but has no expect()' })), data)
  }
  if (behavioral > 0 && honest === 0) {
    return result('suite-honesty', 'fail', `none of the ${behavioral} test(s) carries an assertion, so nothing here can fail`,
      [{ kind: 'nothing asserts', detail: `${notYet} not written yet, ${skipped} skipped` }], data)
  }
  return result('suite-honesty', 'pass', `${honest}/${behavioral} tests carry assertions (${percent}%)`, [], data)
}

export function run({ specs, key = null }, ctx) {
  const files = specs.map(p => ({ path: p, src: readFileSync(resolve(ctx.root, p), 'utf8') }))
  return grade(files, { key }, ctx.dialect)
}
```

- [ ] **Step 4: Run to see them pass**

Run: `cd plugins/quality-code && node --test test/checks/suite-honesty.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/checks/suite-honesty.mjs plugins/quality-code/test/checks/suite-honesty.test.mjs
git commit -m "feat(checks): suite-honesty merged from both warehouse copies (AGT-42)"
```

---

### Task 5: `boundary.mjs` and the hook

**Files:**
- Create: `core/checks/boundary.mjs`, `hooks/hooks.json`
- Test: `test/checks/boundary.test.mjs`

**Interfaces:**
- Consumes: `result`, `changedPaths`.
- Produces: `ALWAYS`, `DEFAULT_WHY`, `RUN_MARKER = '.claude/quality-code/run.active'`, `BOUNDARY_LOG = '.claude/quality-code/boundary.jsonl'`, `STALE_MS`, `matches(pattern, path)`, `defaultForbidden(root)`, `rulesFor(config, root) → { forbidden, allow }`, `violation(relPath, rules) → { path, why } | null`, `runActive(root, now?)`, `hookDecision(payload, { root, config, now? }) → { decision: 'allow' } | { decision: 'deny', path, why }`, `hookReason(path, why)`, `logBlocked(root, entry)`, `run({ range }, ctx) → result` with `data: { mode: 'diff', paths }`. Task 6's CLI wires `--hook`.

- [ ] **Step 1: Write the failing tests**

Create `test/checks/boundary.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { ALWAYS, DEFAULT_WHY, RUN_MARKER, defaultForbidden, hookDecision, matches, rulesFor, run, runActive, violation } from '../../core/checks/boundary.mjs'
import { ENV } from './git-env.mjs'

const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const dir = () => mkdtempSync(join(tmpdir(), 'qc-b-'))
const cfg = boundaries => ({ jira: { projects: ['ABC'] }, adapter: 'vitest', ...(boundaries ? { boundaries } : {}) })

test('matches: prefix, exact and globs (review focus 4)', () => {
  assert.ok(matches('src/', 'src/a.ts') && matches('src/', 'src'))
  assert.ok(!matches('src/', 'src-tauri/x') && !matches('src/', 'e2e/src/x'))
  assert.ok(matches('.env', '.env') && !matches('.env', '.env.example'))
  assert.ok(matches('.env.*', '.env.local') && !matches('.env.*', '.env'))
  assert.ok(matches('**/*.pem', 'a.pem') && matches('**/*.pem', 'x/y/a.pem'))
  assert.ok(matches('src/**/*.spec.ts', 'src/a.spec.ts') && matches('src/**/*.spec.ts', 'src/x/y/a.spec.ts'))
  assert.ok(!matches('src/*.ts', 'src/x/a.ts'))
})
test('violation: always-forbidden paths win over allow; allow wins over forbidden; default why', () => {
  const rules = { forbidden: [{ path: 'src/' }, { path: '.env', why: 'shared systems' }], allow: ['src/**/*.spec.ts', 'dist/**'] }
  assert.deepEqual(violation('src/a.ts', rules), { path: 'src/a.ts', why: DEFAULT_WHY })
  assert.equal(violation('src/a.spec.ts', rules), null)
  assert.deepEqual(violation('.env', rules), { path: '.env', why: 'shared systems' })
  for (const p of ['dist/x.js', 'node_modules/a/b.js', '.git/config', '.claude/quality-code.json']) assert.ok(violation(p, rules), p)
  assert.equal(violation('../other/src/a.ts', rules), null)
  assert.equal(violation('./test/a.spec.ts', rules), null)
  assert.ok(violation('src\\win.ts', rules))
  assert.deepEqual(ALWAYS, ['dist/', 'node_modules/', '.git/', '.claude/quality-code.json'])
})
test('defaults: src/, .env, .env.* and the CI file that exists', () => {
  const d = dir()
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', '.env', '.env.*'])
  put(d, '.gitlab-ci.yml'); put(d, '.github/workflows/ci.yml')
  assert.deepEqual(defaultForbidden(d).map(r => r.path), ['src/', '.env', '.env.*', '.gitlab-ci.yml', '.github/workflows/'])
  assert.deepEqual(rulesFor(cfg(), d).allow, [])
  assert.deepEqual(rulesFor(cfg({ forbidden: [{ path: 'lib/' }] }), d).forbidden, [{ path: 'lib/' }])
})
test('hook: allows without a run, denies a forbidden write during a run, ignores a stale marker', () => {
  const d = dir()
  const write = p => ({ tool_name: 'Write', tool_input: { file_path: join(d, p) } })
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  put(d, RUN_MARKER, '')
  assert.equal(runActive(d), true)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'deny', path: 'src/a.ts', why: DEFAULT_WHY })
  assert.deepEqual(hookDecision(write('test/a.spec.ts'), { root: d, config: cfg() }), { decision: 'allow' })
  const old = new Date(Date.now() - 7 * 3600 * 1000)
  utimesSync(join(d, RUN_MARKER), old, old)
  assert.deepEqual(hookDecision(write('src/a.ts'), { root: d, config: cfg() }), { decision: 'allow' })
})
test('hook: notebook writes, no file path, no config (review focus 2 and 3)', () => {
  const d = dir()
  put(d, RUN_MARKER, '')
  assert.equal(hookDecision({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(d, 'src/n.ipynb') } }, { root: d, config: cfg() }).decision, 'deny')
  assert.equal(hookDecision({ tool_name: 'Bash', tool_input: { command: 'ls' } }, { root: d, config: cfg() }).decision, 'allow')
  assert.equal(hookDecision({}, { root: d, config: cfg() }).decision, 'allow')
  assert.equal(hookDecision({ tool_input: { file_path: join(d, 'src/a.ts') } }, { root: d, config: null }).decision, 'allow')
})
test('diff mode: changed and untracked paths, including spaces (review focus 1)', () => {
  const d = dir()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'test/a.spec.ts'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/b.spec.ts')
  assert.equal(run({}, { root: d, config: cfg() }).status, 'pass')
  put(d, 'src/my file.ts')
  const r = run({}, { root: d, config: cfg() })
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings, [{ file: 'src/my file.ts', kind: 'forbidden write', detail: DEFAULT_WHY }])
  assert.equal(r.data.mode, 'diff')
  assert.equal(run({}, { root: dir(), config: cfg() }).status, 'not_run')
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/boundary.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `core/checks/boundary.mjs`:

```js
// Boundary: a test-writing run writes tests, never the code under test. Path rules from the
// config; a hook that only acts while a run is active; a diff mode that is the check that counts.
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { changedPaths } from './git.mjs'
import { result } from './result.mjs'

export const ALWAYS = ['dist/', 'node_modules/', '.git/', '.claude/quality-code.json']
export const DEFAULT_WHY = 'application code: a test run writes tests, it never changes the code under test.'
export const RUN_MARKER = '.claude/quality-code/run.active'
export const BOUNDARY_LOG = '.claude/quality-code/boundary.jsonl'
export const STALE_MS = 6 * 3600 * 1000
const CI_FILES = ['.gitlab-ci.yml', '.github/workflows/']

const globRe = pattern => new RegExp(`^${pattern
  .split(/(\*\*\/|\*\*|\*)/)
  .map(part => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
  .join('')}$`)

/** A prefix ending in / (also matches the folder itself), a glob with * or **, or an exact path. */
export function matches(pattern, path) {
  if (pattern.includes('*')) return globRe(pattern).test(path)
  if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern)
  return path === pattern
}

export function defaultForbidden(root) {
  return [{ path: 'src/' }, { path: '.env' }, { path: '.env.*' }, ...CI_FILES.filter(p => existsSync(join(root, p))).map(path => ({ path }))]
}

export function rulesFor(config, root) {
  return { forbidden: config.boundaries?.forbidden ?? defaultForbidden(root), allow: config.boundaries?.allow ?? [] }
}

export function violation(relPath, rules) {
  const p = String(relPath ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p || p.startsWith('../') || p === '..' || isAbsolute(p)) return null
  if (ALWAYS.some(a => matches(a, p))) return { path: p, why: 'never written by a test run.' }
  if (rules.allow.some(a => matches(a, p))) return null
  const rule = rules.forbidden.find(r => matches(r.path, p))
  return rule ? { path: p, why: rule.why ?? DEFAULT_WHY } : null
}

export function runActive(root, now = Date.now()) {
  try { return now - statSync(join(root, RUN_MARKER)).mtimeMs < STALE_MS } catch { return false }
}

export function hookDecision(payload, { root, config, now = Date.now() }) {
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  if (!target || !config || !runActive(root, now)) return { decision: 'allow' }
  const v = violation(relative(root, resolve(root, target)), rulesFor(config, root))
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

export function run({ range = null }, ctx) {
  const c = changedPaths(ctx.root, range)
  if (!c.ok) return result('boundary', 'not_run', `cannot read the changed files: ${c.error}`)
  const rules = rulesFor(ctx.config, ctx.root)
  const hits = c.paths.map(p => violation(p, rules)).filter(Boolean)
  const data = { mode: 'diff', paths: c.paths.length }
  if (!hits.length) return result('boundary', 'pass', `${c.paths.length} changed file(s), none outside the boundary`, [], data)
  return result('boundary', 'fail', `${hits.length} write(s) outside the boundary`, hits.map(h => ({ file: h.path, kind: 'forbidden write', detail: h.why })), data)
}
```

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs\" boundary --hook" }
        ]
      }
    ]
  }
}
```

(`cli.mjs` arrives in Task 6; until then the hook is not exercised by tests, and Task 6's tests cover it end to end.)

- [ ] **Step 4: Run to see them pass**

Run: `cd plugins/quality-code && node --test test/checks/boundary.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/checks/boundary.mjs plugins/quality-code/hooks/hooks.json plugins/quality-code/test/checks/boundary.test.mjs
git commit -m "feat(checks): boundary rules, run-scoped hook and diff mode (AGT-42)"
```

---

### Task 6: `cli.mjs` for the static checks and the hook

**Files:**
- Create: `core/checks/cli.mjs`
- Test: `test/checks/cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–5; `loadConfig`, `projectRoot` from `core/config.mjs`.
- Produces: `runCheck(name, input, ctx) → Promise<result>` (`name` ∈ `boundary | honesty | suite-honesty | flaky | mutation`; `ctx = { config, dialect, root, runTests? }`), `main(argv, env, cwd, stdin?) → Promise<number>`. Tasks 7–8 register `flaky` and `mutation`.

- [ ] **Step 1: Write the failing tests**

Create `test/checks/cli.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from './git-env.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../core/checks/cli.mjs')
const put = (d, p, s = 'x') => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const CFG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'qc-cli-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, '.claude/quality-code.json', JSON.stringify(CFG))
  put(d, 'test/a.spec.ts', "it('a', () => { expect(1).toBe(1) })\n")
  g('add', '-A'); g('commit', '-qm', 'i')
  return d
}
const cli = (d, args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, env: { ...ENV, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8', input })
const json = r => JSON.parse(r.stdout)

test('honesty: pass exits 0, fail exits 1, --json prints only the result', () => {
  const d = repo()
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts']).status, 0)
  put(d, 'test/a.spec.ts', "it('a', () => {})\n")
  const r = cli(d, ['honesty', 'test/a.spec.ts', '--json'])
  assert.equal(r.status, 1)
  assert.equal(json(r).check, 'honesty')
  assert.equal(json(r).data.removedAssertions, 1)
})
test('human output ends with a CHECK_JSON line', () => {
  const d = repo()
  const r = cli(d, ['suite-honesty', 'test/a.spec.ts'])
  assert.equal(r.status, 0)
  const last = r.stdout.trim().split('\n').at(-1)
  assert.ok(last.startsWith('CHECK_JSON:'))
  assert.equal(JSON.parse(last.slice(11)).status, 'pass')
  assert.match(r.stdout, /^✅ suite-honesty: /)
})
test('not_run exits 3', () => {
  const d = repo()
  const r = cli(d, ['honesty', 'test/a.spec.ts', '--range', 'nope...HEAD', '--json'])
  assert.equal(r.status, 3)
  assert.equal(json(r).status, 'not_run')
})
test('usage and config errors exit 2', () => {
  const d = repo()
  assert.equal(cli(d, []).status, 2)
  assert.equal(cli(d, ['nope']).status, 2)
  assert.equal(cli(d, ['honesty']).status, 2)
  assert.equal(cli(d, ['honesty', 'missing.spec.ts']).status, 2)
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts', '--range', '--output=x']).status, 2)
  assert.equal(cli(d, ['suite-honesty', 'test/a.spec.ts', '--key', 'XYZ-1']).status, 2)
  assert.equal(cli(d, ['honesty', 'test/a.spec.ts', '--what']).status, 2)
  const bare = mkdtempSync(join(tmpdir(), 'qc-cli-'))
  const r = cli(bare, ['honesty', 'x'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /quality-code:setup/)
})
test('flaky and mutation need a runner from the CLI', () => {
  const d = repo()
  for (const c of ['flaky', 'mutation']) {
    const r = cli(d, [c, 'test/a.spec.ts'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /needs the test runner/)
  }
})
test('hook: silent allow without a run or without a config; deny JSON and a log line during a run', () => {
  const d = repo()
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(d, 'src/a.ts') }, session_id: 's1' })
  let r = cli(d, ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  r = cli(mkdtempSync(join(tmpdir(), 'qc-cli-')), ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  put(d, '.claude/quality-code/run.active', '')
  r = cli(d, ['boundary', '--hook'], payload)
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /src\/a\.ts is off limits during a test run/)
  const log = readFileSync(join(d, '.claude/quality-code/boundary.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual({ ...log[0], ts: 'x' }, { ts: 'x', decision: 'deny', tool: 'Edit', path: 'src/a.ts', session: 's1' })
  r = cli(d, ['boundary', '--hook'], '{not json')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})
test('boundary diff mode from the CLI', () => {
  const d = repo()
  put(d, 'src/a.ts')
  const r = cli(d, ['boundary', '--json'])
  assert.equal(r.status, 1)
  assert.equal(json(r).findings[0].file, 'src/a.ts')
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/cli.test.mjs`
Expected: FAIL (cli.mjs missing).

- [ ] **Step 3: Implement**

Create `core/checks/cli.mjs`:

```js
// Entry point for every check: node core/checks/cli.mjs <check> [args] [--json]
// Exit 0 pass, 1 fail, 2 usage or config error, 3 not run.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from '../config.mjs'
import * as boundary from './boundary.mjs'
import { dialectFor } from './dialects/index.mjs'
import * as honesty from './honesty.mjs'
import { isProjectKey, projectKeys } from './keys.mjs'
import { EXIT } from './result.mjs'
import * as suite from './suite-honesty.mjs'

const CHECKS = {
  boundary: { run: boundary.run, specs: 'none' },
  honesty: { run: honesty.run, specs: 'many' },
  'suite-honesty': { run: suite.run, specs: 'many' },
}
const NEEDS_RUNNER = new Set(['flaky', 'mutation'])
const USAGE = 'usage: cli.mjs <boundary|honesty|suite-honesty|flaky|mutation> [spec...] [--range A...B] [--key KEY] [--json] | boundary --hook'
const ICON = { pass: '✅', fail: '❌', not_run: '⚠️' }

/** For parts 3–4: run one check with a ready context. */
export async function runCheck(name, input, ctx) {
  const c = CHECKS[name]
  if (!c) throw new Error(`unknown check: ${name}`)
  if (NEEDS_RUNNER.has(name) && typeof ctx.runTests !== 'function') throw new Error(`${name} needs ctx.runTests`)
  return c.run(input, ctx)
}

export function registerCheck(name, run, specs) {
  CHECKS[name] = { run, specs }
}

function parse(argv) {
  const a = { flags: new Set(), specs: [] }
  const VALUE = new Set(['--range', '--key', '--runs', '--timeout', '--test', '--baseline', '--max'])
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (VALUE.has(x)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--json' || x === '--hook' || x === '--thorough') a.flags.add(x)
    else if (x.startsWith('-')) throw new Error(`unknown option ${x}`)
    else a.specs.push(x)
  }
  return a
}

async function hook(root, stdin) {
  let payload = {}
  try { payload = JSON.parse(stdin || '{}') } catch { return 0 }
  const c = loadConfig(root)
  const d = boundary.hookDecision(payload, { root, config: c.ok ? c.config : null })
  if (d.decision !== 'deny') return 0
  boundary.logBlocked(root, { decision: 'deny', tool: payload.tool_name ?? null, path: d.path, session: payload.session_id ?? null })
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: boundary.hookReason(d.path, d.why) } })}\n`)
  return 0
}

const readStdin = () => new Promise(done => {
  let s = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { s += d })
  process.stdin.on('end', () => done(s))
  process.stdin.on('error', () => done(''))
})

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdin = null) {
  const err = m => { process.stderr.write(`${m}\n`); return 2 }
  const [name, ...rest] = argv
  const root = projectRoot(env, cwd)
  if (name === 'boundary' && rest.includes('--hook')) {
    try { return await hook(root, stdin ?? await readStdin()) } catch { return 0 }
  }
  if (!name || (!CHECKS[name] && !NEEDS_RUNNER.has(name))) return err(USAGE)
  let a
  try { a = parse(rest) } catch (e) { return err(e.message) }
  const cfg = loadConfig(root)
  if (!cfg.ok) return err(cfg.errors.join('\n'))
  const config = cfg.config
  if (NEEDS_RUNNER.has(name)) return err(`${name} needs the test runner from the Vitest or Playwright adapter (coming in parts 3–4).`)
  const check = CHECKS[name]
  if (check.specs === 'many' && !a.specs.length) return err(`${name} needs at least one spec path. ${USAGE}`)
  for (const s of a.specs) if (!existsSync(resolve(root, s))) return err(`spec not found: ${s}`)
  if (a.key && !isProjectKey(config, a.key)) return err(`--key ${a.key} is not a key of ${projectKeys(config).join(', ')}`)
  const ctx = { config, dialect: dialectFor(config.adapter), root }
  const r = await check.run({ specs: a.specs, range: a.range ?? null, key: a.key ?? null }, ctx)
  if (a.flags.has('--json')) process.stdout.write(`${JSON.stringify(r)}\n`)
  else {
    const lines = [`${ICON[r.status]} ${r.check}: ${r.summary}`]
    for (const f of r.findings) lines.push(`   ${[f.file, f.test && `'${f.test}'`].filter(Boolean).join(' › ')}${f.kind ? ` [${f.kind}]` : ''}${f.detail ? `: ${f.detail}` : ''}`)
    lines.push(`CHECK_JSON:${JSON.stringify(r)}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  return EXIT[r.status]
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
```

- [ ] **Step 4: Run to see them pass, then the whole suite and the CI grep**

Run: `cd plugins/quality-code && node --test test/checks/cli.test.mjs && npm test 2>&1 | grep -E '^ℹ (pass|fail)' && ! grep -rn -E 'AGT|FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' core/checks`
Expected: 7 PASS; suite `fail 0`; grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/checks/cli.mjs plugins/quality-code/test/checks/cli.test.mjs
git commit -m "feat(checks): checks CLI with JSON results, exit codes and the boundary hook (AGT-42)"
```

---

### Task 7: `mutation.mjs` and the dialects' mutation rules

**Files:**
- Modify: `core/checks/dialects/vitest.mjs`, `core/checks/dialects/playwright.mjs` (append `mutation`)
- Create: `core/checks/mutation.mjs`
- Modify: `core/checks/cli.mjs` (register `mutation`)
- Test: `test/checks/mutation.test.mjs`, `test/checks/fake-runner.mjs`

**Interfaces:**
- Consumes: `result`, `anchorRange` (Task 4), `registerCheck` (Task 6).
- Produces: dialect `mutation: { expectRe, testRe, rank(kind), flips(expectSrc), plan({ src, passedTitles, range, thorough, blocks, expects }) }`; `tempSpecPath(specPath)`, `findExpectRanges(src, dialect)`, `findTestBlocks(src, dialect)`, `planMutants(src, passedTitles, { key, thorough }, dialect) → mutants | null` (null = key block missing), `applyMutant(src, m)`, `sweepStale(dir) → number`, `run({ spec, key, baseline, max, thorough, timeoutMs }, ctx) → Promise<result>` with `data: { killed, survived, errors, total, score, survivors }`.
- Runner contract used (spec §5.3 plus Ruling 4): `runTests({ files, testName, timeoutMs }) → Promise<{ ran, tests: [{ title, file, status, message }], error?, broken? }>`; `testName` is the exact title (the runner escapes it).

- [ ] **Step 1: Write the fake runner and the failing tests**

Create `test/checks/fake-runner.mjs`:

```js
// A runner for tests: decides each test's status from the spec file's current text.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** verdict(src, title) → 'passed' | 'failed' | 'skipped'. Records every call. */
export function fakeRunner(root, verdict, { ran = true, error } = {}) {
  const calls = []
  const runTests = async ({ files, testName, timeoutMs }) => {
    calls.push({ files, testName, timeoutMs })
    if (!ran) return { ran: false, tests: [], error }
    const src = readFileSync(resolve(root, files[0]), 'utf8')
    const titles = [...src.matchAll(/\b(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])(.*?)\1/g)].map(m => m[2])
    const picked = testName === undefined ? titles : titles.filter(t => t === testName)
    return { ran: true, tests: picked.map(title => ({ title, file: files[0], status: verdict(src, title) })) }
  }
  return { runTests, calls }
}
```

Create `test/checks/mutation.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMutant, findExpectRanges, planMutants, run, sweepStale, tempSpecPath } from '../../core/checks/mutation.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'
import { fakeRunner } from './fake-runner.mjs'

const V = dialectFor('vitest')
const P = dialectFor('playwright')
const HERE = dirname(fileURLToPath(import.meta.url))

test('vitest: the backend self-test', () => {
  const f = V.mutation.flips
  assert.ok(f('expect(result).toBe(80)').some(x => x.kind === 'invert-matcher' && x.text === 'expect(result).not.toBe(80)'))
  assert.ok(f('expect(result).toBe(80)').some(x => x.kind === 'num→n+1' && x.text === 'expect(result).toBe(81)'))
  assert.ok(f("expect(row.code).toBe('ABC')").some(x => x.kind === 'corrupt-string' && x.text.includes('ABC★MUT')))
  assert.ok(f('expect(x).not.toBe(1)').some(x => x.kind === 'drop-not' && x.text === 'expect(x).toBe(1)'))
  assert.ok(f('expect(flag).toBeTruthy()').some(x => x.kind === 'truthy→falsy'))
  const f5 = f('expect(spy).toHaveBeenCalledTimes(2)')
  assert.ok(f5.some(x => x.kind === 'invert-matcher') && f5.some(x => x.text.includes('toHaveBeenCalledTimes(3)')))
  const src = "describe('FIC-9 — anchor', () => {\n  it('green', () => { expect(compute(a, b)).toBe(80); expect(name).toBe('x') });\n  it('red', () => { expect(compute()).toBe(999) });\n});\ndescribe('OTHER', () => { it('legacy', () => { expect(z).toBe(1) }) });\n"
  const ranges = findExpectRanges(src, V)
  assert.equal(ranges.length, 4)
  assert.equal(src.slice(ranges[0].start, ranges[0].end), 'expect(compute(a, b)).toBe(80);')
  const plan = planMutants(src, ['green'], { key: 'FIC-9' }, V)
  assert.equal(plan.length, 2)
  assert.ok(plan.every(p => p.title === 'green'))
  const applied = applyMutant(src, plan.find(p => p.kind === 'invert-matcher'))
  assert.ok(applied.includes('.not.toBe(80)') && applied.includes('expect(compute()).toBe(999)'))
  assert.ok(planMutants(src, ['green', 'legacy'], { key: 'FIC-9' }, V).every(p => p.title === 'green'))
  assert.ok(planMutants(src, ['green'], { key: 'FIC-9', thorough: true }, V).length > plan.length)
  assert.ok(plan.every(p => V.mutation.rank(p.kind) === 0))
  assert.equal(planMutants(src, ['green'], { key: 'FIC-404' }, V), null)
})
test('playwright: the frontend self-test', () => {
  const src = "\ntest('T-1-green', async ({ page }) => {\n  await expect(page.getByText('a')).toBeVisible()\n  await expect(page.getByText('b')).toHaveCount(0)\n})\ntest('T-2 — design-conformance capture', async ({ page }) => {\n  await expect(page.getByText('x')).toBeVisible()\n})\ntest.fixme('T-3', async () => {\n  await expect(page.getByText('y')).toBeVisible()\n})\ntest('T-4-red', async ({ page }) => {\n  await expect(page.getByText('z')).toBeVisible()\n})\n"
  const flips = P.mutation.flips("await expect(page.getByText('a')).toBeVisible()")
  assert.ok(flips.some(f => f.kind === 'flip-visible→count-999' && f.text.includes('toHaveCount(999')))
  assert.ok(flips.some(f => f.kind === 'corrupt-getBy-string' && f.text.includes('★MUT')))
  const plan = planMutants(src, ['T-1-green'], {}, P)
  assert.ok(plan.length >= 3)
  assert.ok(plan.every(p => p.title === 'T-1-green'))
  const mut = applyMutant(src, plan.find(p => p.kind === 'flip-visible→count-999'))
  assert.ok(mut.includes('toHaveCount(999') && mut.includes("getByText('a')"))
})
test('temp spec is a sibling, never the original', () => {
  const tp = tempSpecPath('/x/src/a/kpi.service.spec.ts')
  assert.equal(dirname(tp), '/x/src/a')
  assert.match(tp, /\/mut-tmp-\d+-[a-z0-9]+-[a-z0-9]+\.spec\.ts$/)
})

const SPEC = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n  it('weak', () => { expect(add(1, 1)).toBeDefined() })\n})\n"
function spec(text = SPEC) {
  const d = mkdtempSync(join(tmpdir(), 'qc-mut-'))
  mkdirSync(join(d, 'test'))
  writeFileSync(join(d, 'test/a.spec.ts'), text)
  return d
}
// A mutant is killed when the test's assertion line was changed in a way the "real code" notices:
// 'adds' fails when its expect changed; 'weak' never fails (toBeDefined binds nothing).
const verdict = (src, title) => (title === 'adds' && !src.includes('expect(add(1, 1)).toBe(2)') ? 'failed' : 'passed')

test('run: a survivor fails the check at the 100% bar and is named', async () => {
  const d = spec()
  const { runTests } = fakeRunner(d, verdict)
  const r = await run({ spec: 'test/a.spec.ts', key: 'ABC-1' }, { root: d, dialect: V, runTests })
  assert.equal(r.status, 'fail')
  assert.deepEqual({ ...r.data, survivors: r.data.survivors.length }, { killed: 1, survived: 1, errors: 0, total: 2, score: 50, survivors: 1 })
  assert.deepEqual(r.findings.map(f => f.test), ['weak'])
  assert.equal(readFileSync(join(d, 'test/a.spec.ts'), 'utf8'), SPEC)
  assert.deepEqual(readdirSync(join(d, 'test')), ['a.spec.ts'])
})
test('run: all killed passes; nothing eligible passes with score null', async () => {
  const d = spec("describe('ABC-1', () => { it('adds', () => { expect(add(1, 1)).toBe(2) }) })\n")
  assert.equal((await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })).status, 'pass')
  const none = spec("it.todo('later')\n")
  const r = await run({ spec: 'test/a.spec.ts' }, { root: none, dialect: V, runTests: fakeRunner(none, verdict).runTests })
  assert.equal(r.status, 'pass')
  assert.equal(r.data.score, null)
})
test('run: baseline red tests are never mutated; --baseline skips the baseline run', async () => {
  const d = spec()
  const { runTests, calls } = fakeRunner(d, verdict)
  const r = await run({ spec: 'test/a.spec.ts', baseline: ['adds'] }, { root: d, dialect: V, runTests })
  assert.equal(r.data.total, 1)
  assert.ok(calls.every(c => c.testName === 'adds'))
})
test('run: runner could not run → not_run; mutants that ran nothing are errors, not survivors', async () => {
  const d = spec()
  const r = await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict, { ran: false, error: 'db down' }).runTests })
  assert.equal(r.status, 'not_run')
  assert.match(r.summary, /db down/)
  let first = true
  const flaky = async args => (first ? ((first = false), { ran: true, tests: [{ title: 'adds', file: args.files[0], status: 'passed' }] }) : { ran: true, tests: [] })
  const e = await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: flaky })
  assert.equal(e.status, 'not_run')
  assert.equal(e.data.errors, 1)
})
test('run: --max keeps the strongest; a missing --key block is not_run', async () => {
  const d = spec()
  const r = await run({ spec: 'test/a.spec.ts', max: 1, thorough: true }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })
  assert.equal(r.data.total, 1)
  const m = await run({ spec: 'test/a.spec.ts', key: 'ABC-2' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })
  assert.equal(m.status, 'not_run')
})
test('run: the runner gets the exact title, regex characters and all (review focus 5)', async () => {
  const d = spec("it('a (b) + c', () => { expect(x).toBe(1) })\n")
  const { runTests, calls } = fakeRunner(d, () => 'passed')
  await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests })
  assert.ok(calls.slice(1).every(c => c.testName === 'a (b) + c'))
})
test('sweepStale removes temp mutants of dead processes only', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-sweep-'))
  writeFileSync(join(d, 'mut-tmp-999999-abc-def.spec.ts'), 'x')
  writeFileSync(join(d, `mut-tmp-${process.pid}-abc-def.spec.ts`), 'x')
  writeFileSync(join(d, 'a.spec.ts'), 'x')
  assert.equal(sweepStale(d), 1)
  assert.deepEqual(readdirSync(d).sort(), ['a.spec.ts', `mut-tmp-${process.pid}-abc-def.spec.ts`])
})
test('SIGINT mid-run leaves the original spec byte-identical and no temp file', async () => {
  const d = spec()
  const child = spawn(process.execPath, [join(HERE, 'mutation-interrupt.fixture.mjs'), d], { stdio: 'ignore' })
  const tempSeen = await new Promise(done => {
    const t0 = Date.now()
    const tick = setInterval(() => {
      const temp = readdirSync(join(d, 'test')).some(n => n.startsWith('mut-tmp-'))
      if (temp || Date.now() - t0 > 5000) { clearInterval(tick); done(temp) }
    }, 20)
  })
  assert.ok(tempSeen)
  child.kill('SIGINT')
  await new Promise(done => child.on('exit', done))
  assert.equal(readFileSync(join(d, 'test/a.spec.ts'), 'utf8'), SPEC)
  assert.deepEqual(readdirSync(join(d, 'test')), ['a.spec.ts'])
})
```

Create `test/checks/mutation-interrupt.fixture.mjs` (a child process for the SIGINT test; its runner answers the baseline, then hangs on the first mutant):

```js
import { run } from '../../core/checks/mutation.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

const root = process.argv[2]
let calls = 0
const runTests = async ({ files }) => {
  calls++
  if (calls === 1) return { ran: true, tests: [{ title: 'adds', file: files[0], status: 'passed' }, { title: 'weak', file: files[0], status: 'passed' }] }
  return new Promise(done => setTimeout(() => done({ ran: true, tests: [] }), 60_000))
}
await run({ spec: 'test/a.spec.ts' }, { root, dialect: dialectFor('vitest'), runTests })
```

(The file name ends in `.fixture.mjs`, so `npm test`'s `*.test.mjs` glob does not run it on its own.)

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/mutation.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Append the mutation rules to the dialects**

Append to `core/checks/dialects/vitest.mjs` (ported verbatim from the backend's `mutate-generated.mjs`: `mutantRank`, `flipMutations`, and `planMutants` with its range and lists passed in):

```js
// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const mutantRank = k =>
  k === 'invert-matcher' || k === 'drop-not' || k === 'truthy→falsy' || k === 'falsy→truthy' ? 0 : k === 'num→n+1' ? 1 : 2

function flipMutations(expectSrc) {
  const out = []
  const add = (kind, text) => { if (text !== expectSrc) out.push({ kind, text }) }
  if (/\.not\./.test(expectSrc)) {
    add('drop-not', expectSrc.replace(/\.not\./, '.'))
  } else {
    const mm = expectSrc.match(/\.(toBe|toEqual|toStrictEqual|toContain|toContainEqual|toMatch|toMatchObject|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveBeenCalled|toHaveLength|toHaveProperty|toBeNull|toBeUndefined|toBeDefined|toBeNaN|toBeInstanceOf|toBeGreaterThanOrEqual|toBeLessThanOrEqual|toBeGreaterThan|toBeLessThan|toThrowError|toThrow|toBeCloseTo)\b/)
    if (mm) add('invert-matcher', `${expectSrc.slice(0, mm.index)}.not${expectSrc.slice(mm.index)}`)
  }
  if (/\.toBeTruthy\s*\(/.test(expectSrc)) add('truthy→falsy', expectSrc.replace(/\.toBeTruthy\s*\(/, '.toBeFalsy('))
  if (/\.toBeFalsy\s*\(/.test(expectSrc)) add('falsy→truthy', expectSrc.replace(/\.toBeFalsy\s*\(/, '.toBeTruthy('))
  add('num→n+1', expectSrc.replace(
    /(\.(?:toBe|toEqual|toBeCloseTo|toHaveLength|toHaveBeenCalledTimes|toBeGreaterThan|toBeLessThan)\s*\(\s*)(-?\d+(?:\.\d+)?)/,
    (_, pre, n) => `${pre}${Number(n) + 1}`))
  add('corrupt-string', expectSrc.replace(
    /(\.(?:toBe|toEqual|toContain|toMatch|toHaveProperty|toHaveBeenCalledWith)\s*\(\s*)(['"`])([^'"`★]+)\2/,
    (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  return out
}

/** One mutant per expect (the strongest) unless thorough; baseline-green tests only, inside the range. */
function plan({ src, passedTitles, range, thorough, blocks, expects }) {
  const passed = new Set(passedTitles)
  const all = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block) continue
    if (block.mod === 'todo' || block.mod === 'skip') continue
    if (!passed.has(block.title)) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flipMutations(original)) {
      all.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
    }
  }
  if (thorough) return all
  const best = new Map()
  for (const m of all) {
    const cur = best.get(m.start)
    if (!cur || mutantRank(m.kind) < mutantRank(cur.kind)) best.set(m.start, m)
  }
  return [...best.values()].sort((a, b) => a.start - b.start)
}

export const mutation = {
  expectRe: /\b(?:await\s+)?expect\s*\(/,
  testRe: /\b(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?\s*\(\s*(['"`])(.*?)\2/,
  rank: mutantRank,
  flips: flipMutations,
  plan,
}
```

Append to `core/checks/dialects/playwright.mjs` (ported verbatim from the frontend's `mutate-generated.mjs`; `plan` gains the range filter, Ruling: spec §9 #1):

```js
function flipMutations(expectSrc) {
  const out = []
  const add = (kind, text) => { if (text !== expectSrc) out.push({ kind, text }) }
  // toBeHidden / toHaveCount(0) can pass during load; an impossible count always fails.
  if (/\.toBeVisible\s*\(/.test(expectSrc)) add('flip-visible→count-999', expectSrc.replace(/\.toBeVisible\s*\([^)]*\)/, '.toHaveCount(999, { timeout: 2000 })'))
  if (/\.toBeHidden\s*\(/.test(expectSrc)) add('flip-hidden→count-999', expectSrc.replace(/\.toBeHidden\s*\([^)]*\)/, '.toHaveCount(999, { timeout: 2000 })'))
  if (/\.toBeEnabled\s*\(/.test(expectSrc)) add('flip-enabled→disabled', expectSrc.replace(/\.toBeEnabled\s*\(/g, '.toBeDisabled('))
  if (/\.toBeDisabled\s*\(/.test(expectSrc)) add('flip-disabled→enabled', expectSrc.replace(/\.toBeDisabled\s*\(/g, '.toBeEnabled('))
  if (/\.toBeChecked\s*\(/.test(expectSrc)) add('flip-checked→unchecked', expectSrc.replace(/\.toBeChecked\s*\(/g, '.not.toBeChecked('))
  if (/\.toHaveCount\s*\(\s*0\s*\)/.test(expectSrc)) add('flip-count-0→1', expectSrc.replace(/\.toHaveCount\s*\(\s*0\s*\)/, '.toHaveCount(1)'))
  if (/\.toHaveCount\s*\(\s*([1-9]\d*)\s*\)/.test(expectSrc)) add('flip-count-n→n+1', expectSrc.replace(/\.toHaveCount\s*\(\s*([1-9]\d*)\s*\)/, (_, n) => `.toHaveCount(${Number(n) + 1})`))
  if (/\.toBeTruthy\s*\(/.test(expectSrc)) add('flip-truthy→falsy', expectSrc.replace(/\.toBeTruthy\s*\(/g, '.toBeFalsy('))
  if (/\.toBeFalsy\s*\(/.test(expectSrc)) add('flip-falsy→truthy', expectSrc.replace(/\.toBeFalsy\s*\(/g, '.toBeTruthy('))
  add('corrupt-getBy-string', expectSrc.replace(/(getBy(?:Text|Label|Placeholder|AltText|Title)\(\s*)(['"`])([^'"`★]+)\2/, (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  add('corrupt-role-name', expectSrc.replace(/(name:\s*)(['"`])([^'"`★]+)\2/, (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  return out
}

/** Every flip of every expect in a baseline-green test (by title or title prefix), inside the range. */
function plan({ src, passedTitles, range, blocks, expects }) {
  const passed = new Set(passedTitles)
  const mutants = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block) continue
    if (block.mod === 'fixme' || block.mod === 'skip') continue
    if (/conformance|capture/i.test(block.title)) continue
    const key = block.title.split(' — ')[0]
    const green = passed.has(block.title) || [...passed].some(t => t === key || t.startsWith(key))
    if (!green) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flipMutations(original)) {
      mutants.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
    }
  }
  return mutants
}

export const mutation = {
  expectRe: /\bawait\s+expect\s*\(/,
  testRe: /\btest(?:\.(skip|fixme|only))?\s*\(\s*(['"`])(.*?)\2/,
  rank: () => 0,
  flips: flipMutations,
  plan,
}
```

- [ ] **Step 4: Implement `mutation.mjs`**

Create `core/checks/mutation.mjs`:

```js
// Assertion mutation: does each generated assertion bind the value it checks? Strict mutants of the
// expect statements in baseline-green tests, each run alone from a temp sibling of the spec.
// Any survivor fails (the bar is 100%). The original spec is never written.
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { result } from './result.mjs'
import { anchorRange } from './suite-honesty.mjs'

const TEMP = /^mut-tmp-(\d+)-[a-z0-9]+-[a-z0-9]+\.spec\.ts$/

export function tempSpecPath(specPath) {
  return resolve(dirname(specPath), `mut-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.spec.ts`)
}

/** { start, end } of each expect(...).matcher...; statement, nested parens and chains included. */
export function findExpectRanges(src, dialect) {
  const ranges = []
  const re = new RegExp(dialect.mutation.expectRe.source, 'g')
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    let i = start + m[0].length - 1
    let depth = 0
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) { i++; break } }
    }
    while (i < src.length && /\s|\./.test(src[i])) {
      if (src[i] === '.') {
        i++
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++
        if (src[i] === '(') {
          let d = 0
          for (; i < src.length; i++) {
            if (src[i] === '(') d++
            else if (src[i] === ')') { d--; if (d === 0) { i++; break } }
          }
        }
      } else i++
    }
    if (src[i] === ';') i++
    ranges.push({ start, end: i })
  }
  return ranges
}

export function findTestBlocks(src, dialect) {
  const re = new RegExp(dialect.mutation.testRe.source, 'g')
  const marks = []
  let m
  while ((m = re.exec(src))) marks.push({ mod: m[1] || null, title: m[3], idx: m.index })
  return marks.map((mk, i) => ({ ...mk, start: mk.idx, end: i + 1 < marks.length ? marks[i + 1].idx : src.length }))
}

/** Mutants for the baseline-green tests; null when --key names a block that is not there. */
export function planMutants(src, passedTitles, { key = null, thorough = false } = {}, dialect) {
  const range = key ? anchorRange(src, key, dialect) : null
  if (key && !range) return null
  return dialect.mutation.plan({ src, passedTitles, range, thorough, blocks: findTestBlocks(src, dialect), expects: findExpectRanges(src, dialect) })
}

export function applyMutant(src, m) {
  return `${src.slice(0, m.start)}${m.replacement}${src.slice(m.end)}`
}

/** Remove temp mutants left by processes that are gone. */
export function sweepStale(dir) {
  let names = []
  try { names = readdirSync(dir) } catch { return 0 }
  let n = 0
  for (const name of names) {
    const m = TEMP.exec(name)
    if (!m || Number(m[1]) === process.pid) continue
    try { process.kill(Number(m[1]), 0); continue } catch (e) { if (e.code === 'EPERM') continue }
    try { unlinkSync(join(dir, name)); n++ } catch {}
  }
  return n
}

export async function run({ spec, key = null, baseline = null, max = null, thorough = false, timeoutMs = 300_000 }, ctx) {
  const specPath = resolve(ctx.root, spec)
  const src = readFileSync(specPath, 'utf8')
  sweepStale(dirname(specPath))
  let passed = baseline
  if (!passed) {
    const b = await ctx.runTests({ files: [spec], timeoutMs })
    if (!b.ran) return result('mutation', 'not_run', `could not run the baseline: ${b.error ?? 'unknown error'}`)
    passed = b.tests.filter(t => t.status === 'passed').map(t => t.title)
  }
  let mutants = planMutants(src, passed, { key, thorough }, ctx.dialect)
  if (mutants === null) return result('mutation', 'not_run', `no ${key} block in ${spec}`, [{ file: spec, kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  const rank = ctx.dialect.mutation.rank
  mutants = [...mutants].sort((a, b) => rank(a.kind) - rank(b.kind))
  if (max != null && mutants.length > max) mutants = mutants.slice(0, Number(max))

  const tmp = tempSpecPath(specPath)
  const relTmp = join(dirname(spec), basename(tmp))
  const cleanup = () => { try { if (existsSync(tmp)) unlinkSync(tmp) } catch {} }
  const onSignal = () => { cleanup(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const outcomes = []
  try {
    for (const m of mutants) {
      writeFileSync(tmp, applyMutant(src, m))
      const r = await ctx.runTests({ files: [relTmp], testName: m.title, timeoutMs })
      const executed = r.ran ? r.tests.filter(t => t.status === 'passed' || t.status === 'failed') : []
      if (!executed.length) outcomes.push({ ...m, error: true })
      else outcomes.push({ ...m, killed: executed.some(t => t.status === 'failed') })
    }
  } finally {
    cleanup()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
  const graded = outcomes.filter(o => !o.error)
  const killed = graded.filter(o => o.killed).length
  const survivedList = graded.filter(o => !o.killed)
  const errors = outcomes.length - graded.length
  const score = graded.length ? Math.round((100 * killed) / graded.length) : null
  const data = { killed, survived: survivedList.length, errors, total: graded.length, score, survivors: survivedList.map(o => o.snippet) }
  if (!graded.length && errors) return result('mutation', 'not_run', `${errors} mutant(s) ran no test`, [], data)
  if (score === null) return result('mutation', 'pass', 'no eligible assertions to mutate', [], data)
  if (survivedList.length) {
    return result('mutation', 'fail', `${survivedList.length} of ${graded.length} mutant(s) survived: an assertion that cannot fail`,
      survivedList.map(o => ({ file: spec, test: o.title, kind: 'survived', detail: o.snippet })), data)
  }
  return result('mutation', 'pass', `${killed}/${graded.length} mutants killed`, [], data)
}
```

Register it in `core/checks/cli.mjs`: add `import * as mutation from './mutation.mjs'` and, after the `CHECKS` object, `CHECKS.mutation = { run: mutation.run, specs: 'one' }`. Keep `NEEDS_RUNNER` as is; the CLI still exits 2 for it (no runner in part 2), and `runCheck('mutation', …)` works with `ctx.runTests`.

- [ ] **Step 5: Run to see them pass, then the suite**

Run: `cd plugins/quality-code && node --test test/checks/mutation.test.mjs && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: 11 PASS; suite `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/quality-code/core/checks plugins/quality-code/test/checks
git commit -m "feat(checks): assertion mutation over an injected runner, 100% bar, interrupt-safe (AGT-42)"
```

---

### Task 8: `flaky.mjs`

**Files:**
- Create: `core/checks/flaky.mjs`
- Modify: `core/checks/cli.mjs` (register `flaky`)
- Test: `test/checks/flaky.test.mjs`

**Interfaces:**
- Consumes: `result`, runner contract (Task 7).
- Produces: `classify(passes, fails)`, `overall(verdicts)`, `run({ specs, testName, runs, timeoutMs }, ctx) → Promise<result>` with `data: { runs, executed, tests: [{ title, pass, fail, verdict }], broken }`.

- [ ] **Step 1: Write the failing tests**

Create `test/checks/flaky.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, overall, run } from '../../core/checks/flaky.mjs'

test('classify and overall (both warehouse self-tests)', () => {
  assert.equal(classify(5, 0), 'green')
  assert.equal(classify(0, 5), 'real')
  assert.equal(classify(3, 2), 'flaky')
  assert.equal(classify(4, 1), 'flaky')
  assert.equal(overall(['green', 'real', 'flaky']), 'flaky')
  assert.equal(overall(['green', 'real']), 'real')
  assert.equal(overall(['green', 'green']), 'green')
})
const runner = script => {
  let i = 0
  const calls = []
  return { calls, runTests: async args => { calls.push(args); return script(i++) } }
}
const t = (title, status) => ({ title, file: 'a.spec.ts', status })

test('green, flaky and real verdicts; retries are the runner\'s job but runs is 5 by default', async () => {
  const g = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  const green = await run({ specs: ['a.spec.ts'] }, { runTests: g.runTests })
  assert.equal(green.status, 'pass')
  assert.equal(g.calls.length, 5)
  const f = runner(i => ({ ran: true, tests: [t('a', i % 2 ? 'failed' : 'passed'), t('b', 'passed')] }))
  const flaky = await run({ specs: ['a.spec.ts'], runs: 4 }, { runTests: f.runTests })
  assert.equal(flaky.status, 'fail')
  assert.match(flaky.summary, /^flaky/)
  assert.deepEqual(flaky.data.tests.find(x => x.title === 'a.spec.ts > a'), { title: 'a.spec.ts > a', pass: 2, fail: 2, verdict: 'flaky' })
  const real = await run({ specs: ['a.spec.ts'], runs: 3 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'failed')] })).runTests })
  assert.equal(real.status, 'fail')
  assert.match(real.summary, /^real/)
})
test('could not run, no tests ran, every test skipped: not_run, never green', async () => {
  const a = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: false, tests: [], error: 'build error' })).runTests })
  assert.equal(a.status, 'not_run')
  assert.match(a.summary, /build error/)
  const b = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [] })).runTests })
  assert.equal(b.status, 'not_run')
  assert.match(b.summary, /no tests ran/)
  const c = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'skipped')] })).runTests })
  assert.equal(c.status, 'not_run')
})
test('a file that never ran turns green into not_run (Ruling 4)', async () => {
  const r = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'passed')], broken: [{ file: 'b.spec.ts', message: 'import error' }] })).runTests })
  assert.equal(r.status, 'not_run')
  assert.deepEqual(r.data.broken, [{ file: 'b.spec.ts', message: 'import error' }])
})
test('the runner gets the spec files, the test name and the timeout', async () => {
  const g = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  await run({ specs: ['a.spec.ts'], testName: 'a', runs: 1, timeoutMs: 1000 }, { runTests: g.runTests })
  assert.deepEqual(g.calls[0], { files: ['a.spec.ts'], testName: 'a', timeoutMs: 1000 })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/checks/flaky.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `core/checks/flaky.mjs`:

```js
// Flaky: re-run the same tests N times with retries off and classify each test from its tally.
// Judged from the runner's per-test results, never from an exit code. Not a proof: a local
// re-run does not reproduce CI load or cross-file interference.
import { result } from './result.mjs'

export function classify(passes, fails) {
  if (fails > 0 && passes > 0) return 'flaky'
  if (fails > 0) return 'real'
  return 'green'
}

export function overall(verdicts) {
  if (verdicts.includes('flaky')) return 'flaky'
  if (verdicts.includes('real')) return 'real'
  return 'green'
}

export async function run({ specs, testName, runs = 5, timeoutMs = 300_000 }, ctx) {
  const perTest = new Map()
  const broken = new Map()
  let executed = 0
  let couldNotRun = 0
  let lastError = ''
  for (let i = 0; i < Number(runs); i++) {
    const r = await ctx.runTests({ files: specs, testName, timeoutMs })
    if (!r.ran) { couldNotRun++; lastError = r.error || lastError; continue }
    const ranTests = r.tests.filter(t => t.status === 'passed' || t.status === 'failed')
    if (!ranTests.length) continue
    executed++
    for (const t of ranTests) {
      const name = `${t.file} > ${t.title}`
      const row = perTest.get(name) ?? { pass: 0, fail: 0 }
      row[t.status === 'passed' ? 'pass' : 'fail']++
      perTest.set(name, row)
    }
    for (const b of r.broken ?? []) broken.set(b.file, b.message)
  }
  const brokenList = [...broken].map(([file, message]) => ({ file, message }))
  const base = { runs: Number(runs), executed, tests: [], broken: brokenList }
  if (!executed) {
    return result('flaky', 'not_run', couldNotRun
      ? `could not run: ${lastError || 'a build, config or environment error, not a code failure'}`
      : 'no tests ran: nothing matched, or every match is skipped', [], base)
  }
  const tests = [...perTest].map(([title, r]) => ({ title, pass: r.pass, fail: r.fail, verdict: classify(r.pass, r.fail) }))
  const data = { ...base, tests }
  const v = overall(tests.map(t => t.verdict))
  const named = verdict => tests.filter(t => t.verdict === verdict).map(t => ({ test: t.title, kind: verdict, detail: `${t.pass} pass / ${t.fail} fail` }))
  if (v === 'flaky') return result('flaky', 'fail', `flaky: ${named('flaky').length} test(s) passed and failed on the same code`, [...named('flaky'), ...named('real')], data)
  if (v === 'real') return result('flaky', 'fail', `real: ${named('real').length} test(s) failed every run`, named('real'), data)
  if (brokenList.length) return result('flaky', 'not_run', `${brokenList.length} file(s) never ran (import or build error)`, brokenList.map(b => ({ file: b.file, kind: 'never ran', detail: b.message })), data)
  return result('flaky', 'pass', `green: every test passed all ${executed} run(s)`, [], data)
}
```

Register it in `core/checks/cli.mjs`: `import * as flaky from './flaky.mjs'` and `CHECKS.flaky = { run: flaky.run, specs: 'many' }`.

- [ ] **Step 4: Run to see them pass, then the suite and the CI grep**

Run: `cd plugins/quality-code && node --test test/checks/flaky.test.mjs && npm test 2>&1 | grep -E '^ℹ (pass|fail)' && ! grep -rn -E 'AGT|FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' core/checks`
Expected: 5 PASS; suite `fail 0`; grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add plugins/quality-code/core/checks plugins/quality-code/test/checks/flaky.test.mjs
git commit -m "feat(checks): flaky check over an injected runner (AGT-42)"
```

---

### Task 9: Parity with both warehouse copies

**Files:**
- Modify: `scripts/capture-parity.mjs` (add `--checks` mode)
- Modify: `test/parity/configs/warehouse-frontend.json`, `test/parity/configs/warehouse-backend.json` (add `boundaries`)
- Create: `test/parity/checks/` (captured data), `test/parity-checks.test.mjs`

**Interfaces:**
- Consumes: every check module; `mask` from `test/parity/sanitize-inputs.mjs`.
- Produces: `test/parity/checks/expected.json` and fixture files; the replay test.

- [ ] **Step 1: Add the boundaries to the two parity configs**

In `test/parity/configs/warehouse-frontend.json` add (the `why` texts are the frontend's own `OFF_LIMITS` texts, verbatim):

```json
  "boundaries": {
    "forbidden": [
      { "path": "src/", "why": "src/ is application code. This harness generates tests, it never changes the code under test — a generator that can edit the app can make a red test green the wrong way (Quality Program §6)." },
      { "path": ".gitlab-ci.yml", "why": "the shared team pipeline. A change here lands on every merge request. Propose it in the e2e README instead and let a human wire it." },
      { "path": ".env", "why": ".env points at shared remote systems; the root CLAUDE.md warns that pointing local dev back at *-test.teamsystem.cloud writes to an environment other people use. Edit .env.example if you need to document a variable." }
    ]
  }
```

In `test/parity/configs/warehouse-backend.json` add:

```json
  "boundaries": {
    "forbidden": [{ "path": "src/" }, { "path": "prisma/" }, { "path": "dapr/" }, { "path": ".gitlab-ci.yml" }, { "path": ".env" }, { "path": ".env.*" }]
  }
```

Run `cd plugins/quality-code && node --test test/parity.test.mjs` — Expected: PASS (score parity is unaffected by the new field).

- [ ] **Step 2: Add the `--checks` capture mode**

In `scripts/capture-parity.mjs`, add below the existing `SOURCES`:

```js
// --checks: the five checks. Old scripts run their CLI on import, so each is cut at its entry
// point (CUT) and the pure functions are imported from the cut copy; suite-honesty's verdict
// comes from running the whole old CLI, as the pipeline does.
const CHECK_FILES = {
  fe: { harness: ['honesty-check.mjs', 'suite-honesty.mjs', 'flaky-check.mjs', 'mutate-generated.mjs'], guard: '.claude/boundary-guard.mjs', dirs: ['e2e/tests'], spec: p => /^e2e\/tests\/.*FIC-\d+\.spec\.ts$/.test(p) },
  be: { harness: ['honesty-check.mjs', 'suite-honesty.mjs', 'flaky-check.mjs', 'mutate-generated.mjs'], guard: '.claude/boundary-guard.mjs', dirs: ['test/unit', 'test/integration', 'test/range'], spec: p => /^test\/(unit|integration|range)\/.*\.spec\.ts$/.test(p) },
}
const CUT = /^(?:const (?:args|rawArgs) = process\.argv|if \(process\.argv|main\(\);?\s*$)/m
const DIFFS_PER_REPO = 15
const KEY_GROUP = /^describe(?:\.(?:skip|only))?\s*\(\s*['"`]((?:FIC|AGT)-\d+)/gm

function show(repo, ref, path) {
  return execFileSync('git', ['-C', repo, 'show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 1e8 })
}

async function loadOld(tmp, name, repo, ref, path) {
  const src = show(repo, ref, path)
  const full = join(tmp, name, `${basename(path, '.mjs')}.full.mjs`)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, src)
  const m = CUT.exec(src)
  const cut = join(tmp, name, basename(path))
  writeFileSync(cut, m ? src.slice(0, m.index) : src)
  return { full, mod: await import(pathToFileURL(cut).href) }
}

async function captureChecks() {
  const { mask } = await import(pathToFileURL(join(PARITY, 'sanitize-inputs.mjs')).href)
  const out = join(PARITY, 'checks')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'parity-checks-')))
  const expected = { source: {}, honesty: [], suite: [], boundary: [], flaky: { classify: [], overall: [] }, mutation: [] }
  try {
    for (const [name, files] of Object.entries(CHECK_FILES)) {
      const { repo, ref } = SOURCES[name]
      expected.source[name] = { ref, commit: execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim() }
      const old = {}
      for (const f of files.harness) old[f] = await loadOld(tmp, name, repo, ref, `.claude/harness/${f}`)
      old.guard = await loadOld(tmp, name, repo, ref, files.guard)

      // specs: suite-honesty (whole old CLI) and mutation plans
      const specs = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' }).split('\n').filter(files.spec)
      for (const p of specs) {
        const src = mask(show(repo, ref, p))
        const fixture = `${name}/specs/${p.replace(/\//g, '__')}.txt`
        mkdirSync(dirname(join(out, fixture)), { recursive: true })
        writeFileSync(join(out, fixture), src)
        const work = join(tmp, name, 'work.spec.ts')
        writeFileSync(work, src)
        const keys = name === 'be' ? [...new Set([...src.matchAll(KEY_GROUP)].map(m => m[1]))] : []
        for (const key of [null, ...keys]) {
          const r = spawnSync('node', [old['suite-honesty.mjs'].full, work, ...(key ? ['--key', key] : [])], { cwd: tmp, encoding: 'utf8' })
          const hollow = [...`${r.stderr}`.matchAll(/^\s+.*: (?:it|test)\('(.*)'\) has no expect\(\)$/gm)].map(m => m[1])
          expected.suite.push({ repo: name, fixture, key, exit: r.status, percent: Number(/SUITE HONESTY: (\d+)%/.exec(r.stdout)?.[1] ?? NaN), hollow })
          const blocks = old['mutate-generated.mjs'].mod.findTestBlocks(src)
          const passed = blocks.filter(b => !b.mod).map(b => b.title)
          const plans = name === 'be' ? [false, true].map(thorough => ({ thorough, mutants: old['mutate-generated.mjs'].mod.planMutants(src, passed, key, thorough) })) : key ? [] : [{ thorough: false, mutants: old['mutate-generated.mjs'].mod.planMutants(src, passed) }]
          for (const pl of plans) expected.mutation.push({ repo: name, fixture, key, passed, ...pl })
        }
      }

      // diffs: honesty on spec-touching commits; boundary on every path those commits change
      const commits = execFileSync('git', ['-C', repo, 'log', '--format=%H', '-n', String(DIFFS_PER_REPO), ref, '--', ...files.dirs], { encoding: 'utf8' }).split('\n').filter(Boolean)
      for (const c of commits) {
        if (spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${c}^`]).status !== 0) continue
        const diff = mask(execFileSync('git', ['-C', repo, 'diff', `${c}^`, c, '--', ...files.dirs], { encoding: 'utf8', maxBuffer: 1e8 }))
        const fixture = `${name}/diffs/${c.slice(0, 10)}.diff`
        mkdirSync(dirname(join(out, fixture)), { recursive: true })
        writeFileSync(join(out, fixture), diff)
        expected.honesty.push({ repo: name, fixture, violations: old['honesty-check.mjs'].mod.scanDiff(diff) })
        const paths = execFileSync('git', ['-C', repo, 'diff', '--name-only', '-z', `${c}^`, c], { encoding: 'utf8' }).split('\0').filter(Boolean).map(mask)
        for (const p of paths) {
          if (name === 'fe') {
            const v = old.guard.mod.violation(p)
            expected.boundary.push({ repo: name, variant: 'default', path: p, forbidden: Boolean(v), why: v?.why ?? null })
          } else {
            for (const variant of ['default', 'mocked']) expected.boundary.push({ repo: name, variant, path: p, forbidden: old.guard.mod.isForbidden(p, { allowSrcSpecs: variant === 'mocked' }), why: null })
          }
        }
      }

      // flaky: the pure classification over every tally of up to 5 runs
      if (name === 'be') {
        for (let p = 0; p <= 5; p++) for (let f = 0; p + f <= 5; f++) expected.flaky.classify.push([p, f, old['flaky-check.mjs'].mod.classify(p, f)])
        for (const vs of [['green'], ['real'], ['flaky'], ['green', 'real'], ['green', 'flaky'], ['real', 'flaky'], ['green', 'real', 'flaky'], []]) expected.flaky.overall.push([vs, old['flaky-check.mjs'].mod.overall(vs)])
      }
    }
    writeFileSync(join(out, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`)
    console.log(`checks: ${expected.suite.length} suite runs, ${expected.honesty.length} diffs, ${expected.boundary.length} paths, ${expected.mutation.length} mutation plans`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
```

Add `basename` and `dirname` to the `node:path` import if they are missing, and change the last line of the file to:

```js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await (process.argv.includes('--checks') ? captureChecks() : main())
```

- [ ] **Step 3: Capture**

Run (from the repo root, with `../warehouse-frontend` and `../warehouse-backend` cloned; `git -C ../warehouse-frontend fetch origin` and the same for the backend first):

```bash
node scripts/capture-parity.mjs --checks
```

Expected: one `checks: … suite runs, … diffs, … paths, … mutation plans` line with every count above 0. Then:

```bash
grep -rlE 'U[0-9]{5,}' plugins/quality-code/test/parity/checks || echo NO-IDS
```

Expected: `NO-IDS`. If the capture fails on a `CUT` miss for a file, the file's CLI entry point changed: add its first top-level CLI line to `CUT` and record a `Ruling:` in the ledger.

- [ ] **Step 4: Write the replay test**

Create `test/parity-checks.test.mjs`:

```js
// Parity for the shared checks: the merged modules, under the warehouse configs, give the verdicts
// the old warehouse scripts gave on the captured fixtures. Allowed differences: spec §9.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanDiff } from '../core/checks/honesty.mjs'
import { grade } from '../core/checks/suite-honesty.mjs'
import { violation, rulesFor } from '../core/checks/boundary.mjs'
import { classify, overall } from '../core/checks/flaky.mjs'
import { planMutants } from '../core/checks/mutation.mjs'
import { keySource } from '../core/checks/keys.mjs'
import { dialectFor } from '../core/checks/dialects/index.mjs'

const DIR = new URL('./parity/', import.meta.url).pathname
const read = p => readFileSync(join(DIR, p), 'utf8')
const CONFIGS = { fe: JSON.parse(read('configs/warehouse-frontend.json')), be: JSON.parse(read('configs/warehouse-backend.json')) }
const D = { fe: dialectFor('playwright'), be: dialectFor('vitest') }
const E = JSON.parse(read('checks/expected.json'))

describe('honesty', () => {
  for (const h of E.honesty) test(h.fixture, () => {
    assert.deepEqual(scanDiff(read(`checks/${h.fixture}`), D[h.repo], keySource(CONFIGS[h.repo])), h.violations)
  })
})
describe('suite-honesty', () => {
  for (const s of E.suite) test(`${s.fixture}${s.key ? ` --key ${s.key}` : ''}`, () => {
    const r = grade([{ path: 'work.spec.ts', src: read(`checks/${s.fixture}`) }], { key: s.key }, D[s.repo])
    assert.equal(r.status, s.exit === 0 ? 'pass' : 'fail')
    assert.equal(r.data.percent, s.percent)
    assert.deepEqual(r.findings.filter(f => f.kind === 'hollow test').map(f => f.test), s.hollow)
  })
})
describe('boundary', () => {
  for (const b of E.boundary) test(`${b.repo} ${b.variant} ${b.path}`, () => {
    const rules = rulesFor(CONFIGS[b.repo], '/nonexistent')
    if (b.variant === 'mocked') rules.allow = ['src/**/*.spec.ts']
    const v = violation(b.path, rules)
    assert.equal(Boolean(v), b.forbidden)
    if (b.why) assert.equal(v.why, b.why)
  })
})
test('flaky classification', () => {
  for (const [p, f, v] of E.flaky.classify) assert.equal(classify(p, f), v, `${p}/${f}`)
  for (const [vs, v] of E.flaky.overall) assert.equal(overall(vs), v, vs.join())
})
describe('mutation plans', () => {
  for (const m of E.mutation) test(`${m.fixture}${m.key ? ` --key ${m.key}` : ''}${m.thorough ? ' thorough' : ''}`, () => {
    assert.deepEqual(planMutants(read(`checks/${m.fixture}`), m.passed, { key: m.key, thorough: m.thorough }, D[m.repo]), m.mutants)
  })
})
```

- [ ] **Step 5: Run the replay**

Run: `cd plugins/quality-code && node --test test/parity-checks.test.mjs 2>&1 | grep -E '^not ok|^ℹ (tests|pass|fail)'`
Expected: `fail 0`. A mismatch is a finding: either the merged code differs from the old script (fix the code, never the expected file), or it is a difference spec §9 allows — then add the transform to this test with a comment naming the §9 item, exactly as `test/parity.test.mjs` does.

Note on the BE `.env.*` rule: `.env.example` is forbidden by the backend (`p.startsWith('.env.')`) and allowed by the frontend; both configs reproduce that.

- [ ] **Step 6: Run the whole suite and the guards**

Run: `cd plugins/quality-code && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: `fail 0` (includes `no-ids.test.mjs` over the new fixtures).

- [ ] **Step 7: Commit**

```bash
git add scripts/capture-parity.mjs plugins/quality-code/test/parity plugins/quality-code/test/parity-checks.test.mjs
git commit -m "test(checks): parity of the merged checks with both warehouse copies (AGT-42)"
```

---

### Task 10: Setup: boundary candidates, the card, gitignore lines

**Files:**
- Modify: `core/setup.mjs` (`detect`, `write`)
- Modify: `commands/setup.md` (step 5 and step 6)
- Test: `test/setup.test.mjs`, `test/setup-command.test.mjs` (append)

**Interfaces:**
- Produces: `detect(root)` adds `boundaries: string[]` (candidate paths that exist) and `specsBesideCode: boolean`; `write()` adds the runtime gitignore lines `RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*']`.

- [ ] **Step 1: Write the failing tests**

Append to `test/setup.test.mjs` (it defines `repo`, `cfg`, `write`, `detect`, `readFileSync`, `join`, `mkdirSync`, `writeFileSync`):

```js
test('detect lists the boundary candidates that exist, and specs next to the code', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  for (const p of ['src/a.ts', 'prisma/schema.prisma', '.env.local', '.gitlab-ci.yml', '.github/workflows/ci.yml']) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), 'x') }
  const r = detect(d)
  assert.deepEqual(r.boundaries, ['src/', 'prisma/', '.env.*', '.gitlab-ci.yml', '.github/workflows/'])
  assert.equal(r.specsBesideCode, false)
  writeFileSync(join(d, 'src/a.spec.ts'), 'x')
  assert.equal(detect(d).specsBesideCode, true)
})
test('write adds the runtime gitignore lines once', () => {
  const d = repo({})
  write(d, cfg, {})
  write(d, cfg, {})
  const lines = readFileSync(join(d, '.gitignore'), 'utf8').trim().split('\n')
  assert.deepEqual(lines, ['.claude/quality-code/tickets/*/raw.json', '.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*'])
})
test('write keeps boundaries', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, boundaries: { forbidden: [{ path: 'src/' }] } }, {}).ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).boundaries, { forbidden: [{ path: 'src/' }] })
})
```

Append to `test/setup-command.test.mjs`:

```js
test('step 5: the boundaries card', () => {
  const s = step(5)
  assert.match(s, /Paths a test run must never change/)
  for (const o of ['1. Keep this list', '2. Add a path', '3. Remove a path']) assert.ok(s.includes(o), o)
  assert.match(s, /specsBesideCode/)
  assert.ok(s.includes('src/**/*.spec.ts'))
  assert.match(step(6), /boundaries/)
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/quality-code && node --test test/setup.test.mjs test/setup-command.test.mjs`
Expected: FAIL (no `boundaries` in detect; one gitignore line; no card).

- [ ] **Step 3: Implement in `core/setup.mjs`**

Add `readdirSync` to the `node:fs` import. Below `TEMPLATE_CANDIDATES` add:

```js
export const RUNTIME_GITIGNORE = ['.claude/quality-code/*.jsonl', '.claude/quality-code/run.active', 'mut-tmp-*']

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

function hasSpecBesideCode(dir, budget = { n: 5000 }) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (--budget.n < 0) return false
    if (e.isDirectory()) { if (e.name !== 'node_modules' && hasSpecBesideCode(join(dir, e.name), budget)) return true }
    else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(e.name)) return true
  }
  return false
}
```

In `detect`, extend the result object:

```js
  const result = {
    adapter, templates, existing,
    gitignore: hasLine(join(root, '.gitignore'), rawLine(existing?.ticketsDir)),
    boundaries: boundaryCandidates(root),
    specsBesideCode: hasSpecBesideCode(join(root, 'src')),
  }
```

In `write`, replace the gitignore block (from `const line = gitignoreLine ?? rawLine(config.ticketsDir)` to the closing `}` of `if (!hasLine(gi, line))`) with:

```js
    const gi = join(root, '.gitignore')
    step = '.gitignore'
    for (const line of [gitignoreLine ?? rawLine(config.ticketsDir), ...RUNTIME_GITIGNORE]) {
      if (hasLine(gi, line)) continue
      const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
      writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
    }
```


- [ ] **Step 4: The card in `commands/setup.md`**

At the end of step 5 (Templates), before the line that starts `6. **Preview.**`, add:

```markdown
   **Paths a test run must never change.** Show `boundaries` from the detect result as a numbered list (they exist in this repo: application code, environment files, the CI file), then this card and end the turn:

   ```
   1. Keep this list
   2. Add a path
   3. Remove a path
   ```

   A path is a folder ending in `/` (`src/`), an exact file (`.env`) or a pattern with `*` / `**`. Repeat the card until the user keeps the list. For `vitest` with `specsBesideCode` true, also ask once: `Do your specs live next to the code (src/**/*.spec.ts)? 1. Yes / 2. No`; a yes adds `"allow": ["src/**/*.spec.ts"]`. Put the result in the proposal as `boundaries: { "forbidden": [{ "path": "<p>" }, …], "allow"?: [...] }`. An empty list leaves `boundaries` out (the plugin then uses its defaults). `dist/`, `node_modules/`, `.git/` and the config file are always protected; do not list them.
```

In step 6 (Preview), in the sentence that lists what the config has, add `boundaries` when the user kept any path: change `and for \`playwright\` \`confluenceSpaces\` when spaces were picked)` to `for \`playwright\` \`confluenceSpaces\` when spaces were picked, and \`boundaries\` when any path was kept)`.

- [ ] **Step 5: Run to see them pass, then the suite**

Run: `cd plugins/quality-code && node --test test/setup.test.mjs test/setup-command.test.mjs && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS; suite `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/quality-code/core/setup.mjs plugins/quality-code/commands/setup.md plugins/quality-code/test/setup.test.mjs plugins/quality-code/test/setup-command.test.mjs
git commit -m "feat(setup): boundaries card, candidates from the repo, runtime gitignore lines (AGT-42)"
```

---

### Task 11: Guards, spec record, docs, release 0.4.0

**Files:**
- Modify: `.github/workflows/test.yml`, `docs/specs/2026-10-14-part-2-shared-checks-design.md` (§9), `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: CI guard for `core/checks`**

In `.github/workflows/test.yml`, after the `no project values in core` step, add:

```yaml
      - name: no project keys in the checks
        run: "! grep -rn -E 'AGT|FIC' plugins/quality-code/core/checks"
```

Run locally: `! grep -rn -E 'AGT|FIC' plugins/quality-code/core/checks && echo CLEAN` — Expected: `CLEAN`.

- [ ] **Step 2: Record the rulings in the spec**

In `docs/specs/2026-10-14-part-2-shared-checks-design.md` §9, append:

```markdown
7. `--key` naming a block that is not in the spec is `not_run` (§5.2) for both stacks. Today's backend
   graded the whole file instead.
8. The frontend's `HARNESS_BOUNDARY_OVERRIDE=1` is gone: the hook only acts during a run, and removing
   `.claude/quality-code/run.active` lifts it.
9. The runner contract (§5.3) carries an optional `broken: [{ file, message }]`; a green flaky run with
   a file that never ran is `not_run`, as the backend's error verdict was.
10. The dialect also carries each stack's honesty, suite-honesty and mutation rules (§5.1 lists the
    syntax only), so both warehouse copies keep their exact verdicts.
```

And in §4.4, add `mut-tmp-*` to the gitignore lines setup writes.

- [ ] **Step 3: README**

- "What you can do today": change the checks row to `| Deterministic checks on generated tests (honesty, assertions, mutation, boundaries, flakiness) | building blocks for the test-writing pipeline; run by hand with \`core/checks/cli.mjs\` | ✅ available (building blocks) |`.
- Roadmap: part 2 row status `✅ available`.
- The config table: add `| \`boundaries\` | paths a test run may never write: \`forbidden\` (\`{ path, why? }\`) and \`allow\` exceptions | \`src/\`, \`.env\`, \`.env.*\`, the CI file |`.
- Developing: add under the tree a short block:

````markdown
Run a check by hand (from a set-up repo):

```bash
node <plugin>/core/checks/cli.mjs honesty test/orders.spec.ts
```

`boundary`, `honesty`, `suite-honesty` run as they are; `flaky` and `mutation` need the test runner
that the Vitest and Playwright adapters bring.
````

- The tree's `core/` line: add `checks/ (boundary, honesty, suite-honesty, flaky, mutation)`; add `hooks/hooks.json` under the plugin.

- [ ] **Step 4: CHANGELOG and version**

In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.4.0] - <today's date>` and add above its `### Removed`:

```markdown
### Added

- Five deterministic checks for generated tests, one version for Vitest and Playwright, driven by
  the config: `boundary` (no writes to application code, environment or CI files during a test
  run), `honesty` (no removed assertion or test, no skip without a ticket), `suite-honesty` (every
  test that runs asserts something), `flaky` and `assertion-mutation` (every generated assertion can
  fail; any survivor fails the check). Run by hand with `core/checks/cli.mjs`; the test-writing
  pipeline uses them from part 4.
- `boundaries` in `.claude/quality-code.json`, and a setup card that proposes them from your repo.
- A boundary hook that only acts while a test-writing run is active; outside a run Claude edits your
  code as usual.

### Upgrade

Update the plugin before re-running setup: a config with `boundaries` is refused by 0.3.0. Re-run
`/quality-code:setup` to get the boundaries card and the new `.gitignore` lines; without it the
checks use the defaults.
```

Set `"version": "0.4.0"` in `plugins/quality-code/.claude-plugin/plugin.json`.

- [ ] **Step 5: Run everything**

```bash
cd plugins/quality-code && npm test 2>&1 | grep -E '^ℹ (pass|fail)' && cd ../.. && claude plugin validate plugins/quality-code && claude plugin validate . && ! grep -rn -E 'FIC|teamsystem\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' plugins/quality-code/core && ! grep -rn -E 'AGT|FIC' plugins/quality-code/core/checks && echo ALL-CLEAN
```

Expected: `fail 0`, both validations pass, `ALL-CLEAN`. Then the link check from the start plan's Task 5 Step 6 on `README.md` and `CHANGELOG.md`: no `BAD` lines.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/test.yml docs/specs/2026-10-14-part-2-shared-checks-design.md README.md CHANGELOG.md plugins/quality-code/.claude-plugin/plugin.json
git commit -m "release: quality-code 0.4.0 with the shared checks (AGT-42)"
```

- [ ] **Step 7: Release (ask the user first; it publishes to every team)**

After the user says yes: merge to `main`, `claude plugin tag plugins/quality-code`, `git push origin main --follow-tags`.
