# Part 4a: the Vitest pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade existing Vitest spec files in any Node/TS project with every quality check (boundary, honesty, suite-honesty, types, tests, mutation, optional flaky) and show one plain card; `/quality-code:check` and a new `start` option use it. Release 0.5.0 (Jira AGT-44).

**Architecture:** A Vitest runner (`core/runners/vitest.mjs`) implements the part 2 runner contract by running the project's own Vitest with a JSON report. A type-check step (`core/pipeline/types.mjs`) runs the project's `tsc`. The pipeline (`core/pipeline/vitest.mjs`) calls the part 2 checks, the type-check and the runner in a fixed order and decides one verdict. A script builds the card (`core/pipeline/card.mjs`); a CLI (`core/pipeline/cli.mjs`) and two command prompts use it.

**Tech Stack:** Node ≥ 18 built-ins only (`node:child_process` `spawn`), `node --test`, git.

**Spec:** `docs/specs/2026-10-14-part-4a-vitest-pipeline-design.md`.

## Global Constraints

- No npm dependencies; imports are `node:*` or relative.
- Style: 2-space indent, single quotes, no semicolons.
- No `AGT`, `FIC`, `warehouse` or other project values under `core/runners/` and `core/pipeline/`.
- Child processes: `spawn` with an argument list, never a shell; cwd = project root; env adds `NO_COLOR=1`, `CI=1`.
- Nothing is written into the team's repo by the runner or the pipeline; temp files live in `os.tmpdir()` and are always deleted.
- Verdicts: `green`, `checks_failed`, `not_verified`, `tests_red` (spec §5). No path gives `green` when any step is `not_run`.
- CLI exit codes: `0` green; `1` checks_failed or tests_red; `2` usage/config error or a crash; `3` not_verified.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Version `0.5.0`.

## Rulings this plan makes

1. **`-t` pattern.** Vitest matches `-t` against the test's full name (its describe titles and its own title, joined by spaces), so the pattern is `(?:^| )<escaped title>$`, not `^title$` as spec §4 says. Mutation already keeps only results with the exact title. Record in the spec (Task 9).
2. **Mutation with several specs.** The pipeline runs mutation once per spec with that file's passing tests as baseline. With `--key`, a spec without the key block is skipped (consistent with suite-honesty); if every spec is skipped, mutation is `not_run`. Results are summed; any survivor fails; otherwise any not_run makes it not_run.
3. **The Vitest-configs card** goes at the end of advanced step A4 (after the boundaries card), not as a new step, so A5 stays the preview step.

## Review Focus

1. **A spec path with spaces** passed to Vitest and matched back from the report (absolute `name` in the report vs relative spec path). → test in Task 2.
2. **Vitest writes a partial report and exits non-zero** (e.g. a thrown error in a global setup after some files ran). Expected: report parsed; files that never ran are `broken`. → test in Task 2.
3. **A spec matched by no `configs` entry next to one that is** → two groups, two processes, merged results. → test in Task 2.
4. **`tsc` prints errors on stdout, not stderr.** Expected: the first `error TS` line in the fail summary. → test in Task 3.
5. **The pipeline must not run mutation on a red-only run** where no test passed: the empty baseline gives mutation `not_run` (part 2 ruling), so the verdict is `not_verified` unless a check failed. → test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `core/config.mjs`, `schema/quality-code.schema.json` (modify) | the `vitest` block |
| `core/runners/vitest.mjs` | `titlePattern`, `configFor`, `parseReport`, `runVitest`, `vitestRunner(root, config)` |
| `core/pipeline/types.mjs` | `typeCheck(root, config, specs)` |
| `core/pipeline/vitest.mjs` | `decide(steps)`, `testsStep(run)`, `mutationStep(...)`, `runPipeline(input, ctx)` |
| `core/pipeline/card.mjs` | `formatCard(outcome, { specs, key })` |
| `core/pipeline/cli.mjs` | `main(argv, env, cwd)` |
| `commands/check.md` (new), `commands/start.md` (modify) | the prompts |
| `core/setup.mjs`, `commands/setup.md` (modify) | `vitestConfigs` in detect; the configs card in A4 |
| `test/runners/vitest.test.mjs`, `test/runners/fake-bin.mjs`, `test/pipeline/*.test.mjs`, `test/check-command.test.mjs` | tests |

All paths are relative to `plugins/quality-code/` unless they start with `docs/`, `.github/`, `README.md` or `CHANGELOG.md`.

---

### Task 1: the `vitest` config block

**Files:** Modify `core/config.mjs`, `schema/quality-code.schema.json`; Test `test/config.test.mjs` (append).

- [ ] **Step 1: Failing tests** — append to `test/config.test.mjs` (it defines `good`, a playwright config, and `bad(patch, field)`):

```js
const vgood = { ...good, adapter: 'vitest' }
test('vitest block: configs, tsconfig, timeout', () => {
  const r = validateConfig({ ...vgood, vitest: { configs: [{ match: 'test/integration/**', config: 'vitest.config.db.ts' }], tsconfig: 'tsconfig.test.json', timeoutSeconds: 120 } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.equal(r.config.vitest.timeoutSeconds, 120)
})
test('vitest block: absent stays absent; only with adapter vitest', () => {
  assert.equal(validateConfig(vgood).config.vitest, undefined)
  const r = validateConfig({ ...good, vitest: {} })
  assert.ok(r.errors.includes('vitest: only allowed with "adapter": "vitest"'))
})
test('vitest block: each wrong part is named', () => {
  const r = validateConfig({ ...vgood, vitest: { configs: [{ match: '../x', config: 'a.ts' }, { match: 'test/', config: '/abs.ts' }, { match: 'x' }, 'no'], tsconfig: '', timeoutSeconds: 5, extra: 1 } })
  assert.deepEqual(r.errors, [
    'vitest.extra: unknown field (only "configs", "tsconfig" and "timeoutSeconds")',
    'vitest.configs[0].match "../x" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[1].config "/abs.ts" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[2].config undefined must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[3]: must be an object with "match" and "config"',
    'vitest.tsconfig "" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.timeoutSeconds: must be a whole number from 10 to 3600',
  ])
})
test('the schema documents the vitest block', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const v = schema.properties.vitest
  assert.equal(v.type, 'object')
  assert.equal(v.additionalProperties, false)
  assert.deepEqual(Object.keys(v.properties).sort(), ['configs', 'timeoutSeconds', 'tsconfig'])
})
```

- [ ] **Step 2:** run `cd plugins/quality-code && node --test test/config.test.mjs` → FAIL (`vitest: unknown field`).
- [ ] **Step 3: Implement.** In `core/config.mjs` add `'vitest'` to `FIELDS` and, next to the `boundaries` block (before `if (e.length) return`), reuse its `pathOk` and message (`must be a relative path inside the project (no "..", not absolute, one line)`) — move the `pathOk` helper and that message to module level if they are local to the boundaries block, without changing the boundaries messages:

```js
  if (c.vitest !== undefined) {
    if (c.adapter !== 'vitest') e.push('vitest: only allowed with "adapter": "vitest"')
    else if (!isObj(c.vitest)) e.push('vitest: must be an object')
    else {
      for (const k of Object.keys(c.vitest)) if (!['configs', 'tsconfig', 'timeoutSeconds'].includes(k)) e.push(`vitest.${k}: unknown field (only "configs", "tsconfig" and "timeoutSeconds")`)
      const cf = c.vitest.configs
      if (cf !== undefined) {
        if (!Array.isArray(cf)) e.push('vitest.configs: must be a list of { "match", "config" }')
        else cf.forEach((x, i) => {
          if (!isObj(x)) { e.push(`vitest.configs[${i}]: must be an object with "match" and "config"`); return }
          for (const f of ['match', 'config']) if (!pathOk(x[f])) e.push(`vitest.configs[${i}].${f} ${JSON.stringify(x[f])} ${PATH_RULE}`)
        })
      }
      if (c.vitest.tsconfig !== undefined && !pathOk(c.vitest.tsconfig)) e.push(`vitest.tsconfig ${JSON.stringify(c.vitest.tsconfig)} ${PATH_RULE}`)
      const t = c.vitest.timeoutSeconds
      if (t !== undefined && !(Number.isInteger(t) && t >= 10 && t <= 3600)) e.push('vitest.timeoutSeconds: must be a whole number from 10 to 3600')
    }
  }
```

(`PATH_RULE` = the shared message string. `JSON.stringify(undefined)` is `undefined`, which the test expects.) Add the schema property after `boundaries`:

```json
    "vitest": {
      "type": "object",
      "additionalProperties": false,
      "description": "Only with adapter vitest. How quality-code runs your Vitest specs.",
      "properties": {
        "configs": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["match", "config"], "properties": { "match": { "type": "string", "description": "Spec path pattern: a prefix ending in /, an exact path, or a glob with * and **." }, "config": { "type": "string", "description": "Vitest config file for the specs that match." } } }, "description": "First match wins; none means Vitest's default config." },
        "tsconfig": { "type": "string", "description": "Project file for the type-check. Default tsconfig.json when it exists." },
        "timeoutSeconds": { "type": "integer", "minimum": 10, "maximum": 3600, "default": 300 }
      }
    },
```

- [ ] **Step 4:** run the config tests, then `npm test` → all pass.
- [ ] **Step 5: Commit** `feat(pipeline): vitest block in the team config (AGT-44)`.

---

### Task 2: the Vitest runner

**Files:** Create `core/runners/vitest.mjs`, `test/runners/fake-bin.mjs`, `test/runners/vitest.test.mjs`.

**Produces:** `titlePattern(title)`, `configFor(file, config)`, `parseReport(json, root)`, `runVitest(root, files, { config, testName, timeoutMs })`, `vitestRunner(root, config) → runTests`.

- [ ] **Step 1: The fake binary helper** — `test/runners/fake-bin.mjs`:

```js
// Installs a fake executable at <dir>/node_modules/.bin/<name>. Its behaviour comes from
// <dir>/.fake-<name>.json: { report?, reportFor?: { [config or 'default']: report }, exit?, stderr?,
// stdout?, sleepMs? }. Each call's argv is appended as one JSON line to <dir>/.fake-<name>.calls,
// and the report is written to the --outputFile path.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const script = name => `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const dir = process.cwd()
const spec = JSON.parse(fs.readFileSync(path.join(dir, '.fake-${name}.json'), 'utf8'))
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, '.fake-${name}.calls'), JSON.stringify(args) + '\\n')
const out = (args.find(a => a.startsWith('--outputFile=')) || '').slice(13)
const ci = args.indexOf('--config')
const report = (spec.reportFor && spec.reportFor[ci >= 0 ? args[ci + 1] : 'default']) || spec.report
setTimeout(() => {
  if (out && report) fs.writeFileSync(out, JSON.stringify(report))
  if (spec.stdout) process.stdout.write(spec.stdout)
  if (spec.stderr) process.stderr.write(spec.stderr)
  process.exit(spec.exit ?? 0)
}, spec.sleepMs ?? 0)
`

export function fakeBin(dir, name, behaviour) {
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
  const p = join(dir, 'node_modules/.bin', name)
  writeFileSync(p, script(name))
  chmodSync(p, 0o755)
  writeFileSync(join(dir, `.fake-${name}.json`), JSON.stringify(behaviour))
  return p
}

export function calls(dir, name) {
  try { return readFileSync(join(dir, `.fake-${name}.calls`), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
}
```

The generated script is CommonJS on purpose (it is a standalone executable with no `.mjs` extension), so `require` is correct inside it. Note the escaping: inside the template literal the script's newline is written `'\\n'`, which becomes `'\n'` in the generated file.

- [ ] **Step 2: Failing tests** — `test/runners/vitest.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configFor, parseReport, titlePattern, vitestRunner } from '../../core/runners/vitest.mjs'
import { calls, fakeBin } from './fake-bin.mjs'

const cfg = (vitest = undefined) => ({ adapter: 'vitest', jira: { projects: ['ABC'] }, ...(vitest ? { vitest } : {}) })
const proj = () => mkdtempSync(join(tmpdir(), 'qc-run-'))
const report = (d, files) => ({ testResults: files.map(f => ({ name: join(d, f.file), status: f.status ?? 'passed', message: f.message ?? '', assertionResults: f.tests ?? [] })) })
const t = (title, status, failureMessages = []) => ({ title, fullName: `S ${title}`, status, failureMessages })

test('titlePattern escapes and anchors at the end of the full name', () => {
  const p = new RegExp(titlePattern('a (b) + c'))
  assert.ok(p.test('a (b) + c'))
  assert.ok(p.test('ABC-1 — anchor a (b) + c'))
  assert.ok(!p.test('a (b) + c twice'))
  assert.ok(!p.test('xa (b) + c'))
})
test('configFor: first matching entry, else null', () => {
  const c = cfg({ configs: [{ match: 'test/integration/**', config: 'db.ts' }, { match: 'test/', config: 'all.ts' }] })
  assert.equal(configFor('test/integration/a.spec.ts', c), 'db.ts')
  assert.equal(configFor('test/unit/a.spec.ts', c), 'all.ts')
  assert.equal(configFor('src/a.spec.ts', c), null)
  assert.equal(configFor('src/a.spec.ts', cfg()), null)
})
test('parseReport: statuses, first failure line, broken files, paths relative to the root', () => {
  const d = '/p'
  const r = parseReport(report(d, [
    { file: 'test/a.spec.ts', tests: [t('ok', 'passed'), t('bad', 'failed', ['Expected 1\n  at x']), t('later', 'todo'), t('off', 'skipped'), t('p', 'pending')] },
    { file: 'test/my b.spec.ts', status: 'failed', message: 'Cannot find module x\n stack' },
  ]), d)
  assert.deepEqual(r.tests, [
    { title: 'ok', file: 'test/a.spec.ts', status: 'passed', message: '' },
    { title: 'bad', file: 'test/a.spec.ts', status: 'failed', message: 'Expected 1' },
    { title: 'later', file: 'test/a.spec.ts', status: 'skipped', message: '' },
    { title: 'off', file: 'test/a.spec.ts', status: 'skipped', message: '' },
    { title: 'p', file: 'test/a.spec.ts', status: 'skipped', message: '' },
  ])
  assert.deepEqual(r.broken, [{ file: 'test/my b.spec.ts', message: 'Cannot find module x' }])
})
test('runner: argv, report parsed, temp report deleted, nothing written in the project (review focus 1)', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { report: report(d, [{ file: 'test/my a.spec.ts', tests: [t('ok', 'passed')] }]) })
  const before = readdirSync(d).sort()
  const r = await vitestRunner(d, cfg())({ files: ['test/my a.spec.ts'], testName: 'ok', timeoutMs: 10000 })
  assert.deepEqual(r, { ran: true, tests: [{ title: 'ok', file: 'test/my a.spec.ts', status: 'passed', message: '' }], broken: [] })
  const [argv] = calls(d, 'vitest')
  assert.deepEqual(argv.slice(0, 3), ['run', 'test/my a.spec.ts', '--reporter=json'])
  const out = argv.find(a => a.startsWith('--outputFile=')).slice(13)
  assert.ok(!out.startsWith(d))
  assert.equal(existsSync(out), false)
  assert.ok(argv.includes('--retry=0'))
  assert.deepEqual(argv.slice(argv.indexOf('-t'), argv.indexOf('-t') + 2), ['-t', titlePattern('ok')])
  assert.deepEqual(readdirSync(d).sort(), before.concat(['.fake-vitest.calls']).sort())
})
test('runner: a non-zero exit with a report is still read (review focus 2)', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { exit: 1, report: report(d, [{ file: 'a.spec.ts', tests: [t('bad', 'failed', ['boom'])] }, { file: 'b.spec.ts', status: 'failed', message: 'setup crashed' }]) })
  const r = await vitestRunner(d, cfg())({ files: ['a.spec.ts', 'b.spec.ts'] })
  assert.equal(r.ran, true)
  assert.equal(r.tests[0].status, 'failed')
  assert.deepEqual(r.broken, [{ file: 'b.spec.ts', message: 'setup crashed' }])
})
test('runner: no report → ran false with the first stderr line; missing binary; timeout', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { exit: 1, stderr: '\nError: connect ECONNREFUSED 127.0.0.1:5432\n  at x' })
  assert.deepEqual(await vitestRunner(d, cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Error: connect ECONNREFUSED 127.0.0.1:5432' })
  assert.deepEqual(await vitestRunner(proj(), cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Vitest is not installed in this project: run npm install' })
  const s = proj()
  fakeBin(s, 'vitest', { sleepMs: 5000, report: report(s, []) })
  const r = await vitestRunner(s, cfg())({ files: ['a.spec.ts'], timeoutMs: 300 })
  assert.equal(r.ran, false)
  assert.match(r.error, /took longer than/)
})
test('runner: one process per config, results merged (review focus 3)', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { reportFor: {
    'db.ts': report(d, [{ file: 'test/integration/a.spec.ts', tests: [t('db', 'passed')] }]),
    default: report(d, [{ file: 'src/b.spec.ts', tests: [t('unit', 'passed')] }]),
  } })
  const r = await vitestRunner(d, cfg({ configs: [{ match: 'test/integration/**', config: 'db.ts' }] }))({ files: ['test/integration/a.spec.ts', 'src/b.spec.ts'] })
  assert.deepEqual(r.tests.map(x => x.title).sort(), ['db', 'unit'])
  const argvs = calls(d, 'vitest')
  assert.equal(argvs.length, 2)
  assert.ok(argvs.some(a => a.includes('--config') && a.includes('db.ts')))
  assert.ok(argvs.some(a => !a.includes('--config')))
})
test('runner: the default timeout comes from vitest.timeoutSeconds', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { sleepMs: 3000, report: report(d, []) })
  const r = await vitestRunner(d, cfg({ timeoutSeconds: 10 }))({ files: ['a.spec.ts'], timeoutMs: undefined })
  assert.equal(r.ran, true)
})
```

- [ ] **Step 3:** run `node --test test/runners/vitest.test.mjs` → FAIL (module missing).
- [ ] **Step 4: Implement** `core/runners/vitest.mjs`:

```js
// The Vitest runner: runs specs with the project's own Vitest and reads its JSON report.
// Implements the runner contract of the shared checks. Never writes into the project.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { matches } from '../checks/boundary.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** Vitest matches -t against the full name (describe titles and the test title joined by spaces). */
export const titlePattern = title => `(?:^| )${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

export function configFor(file, config) {
  for (const c of config.vitest?.configs ?? []) if (matches(c.match, file)) return c.config
  return null
}

export function parseReport(json, root) {
  const tests = []
  const broken = []
  for (const tr of json?.testResults ?? []) {
    const file = isAbsolute(tr.name ?? '') ? relative(root, tr.name) : String(tr.name ?? '')
    const ars = tr.assertionResults ?? []
    if (!ars.length && tr.status === 'failed') { broken.push({ file, message: firstLine(tr.message) }); continue }
    for (const a of ars) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped'
      tests.push({ title: a.title, file, status, message: status === 'failed' ? firstLine(a.failureMessages?.[0]) : '' })
    }
  }
  return { tests, broken }
}

export function runVitest(root, files, { config = null, testName, timeoutMs }) {
  return new Promise(done => {
    const bin = join(root, 'node_modules/.bin/vitest')
    if (!existsSync(bin)) return done({ ran: false, error: 'Vitest is not installed in this project: run npm install' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-vitest-'))
    const out = join(dir, 'report.json')
    const args = ['run', ...files, '--reporter=json', `--outputFile=${out}`, '--retry=0']
    if (config) args.push('--config', config)
    if (testName !== undefined) args.push('-t', titlePattern(testName))
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(bin, args, { cwd: root, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      done(r)
    }
    child.on('error', e => finish({ ran: false, error: `could not start Vitest: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return finish({ ran: false, error: `took longer than ${Math.round(timeoutMs / 1000)}s` })
      let json = null
      try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
      if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Vitest wrote no report' })
      finish({ ran: true, ...parseReport(json, root) })
    })
  })
}

export function vitestRunner(root, config) {
  const defaultMs = (config.vitest?.timeoutSeconds ?? 300) * 1000
  return async ({ files, testName, timeoutMs }) => {
    const groups = new Map()
    for (const f of files) {
      const c = configFor(f, config)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const all = { ran: true, tests: [], broken: [] }
    for (const [c, fs] of groups) {
      const r = await runVitest(root, fs, { config: c, testName, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], error: r.error }
      all.tests.push(...r.tests)
      all.broken.push(...r.broken)
    }
    return all
  }
}
```

- [ ] **Step 5:** run the runner tests → PASS; `npm test` → all pass. Optional real-Vitest check: when `QC_REAL_VITEST` is set to a project with Vitest installed, add a test (skipped otherwise with `{ skip: !process.env.QC_REAL_VITEST }`) that writes `qc-real.spec.ts` with one passing and one failing test into a temp copy is NOT needed — keep it out (the real-Vitest test arrives with 4b's sample service; record this as a ruling in your report).
- [ ] **Step 6: Commit** `feat(pipeline): Vitest runner over the project's own Vitest and its JSON report (AGT-44)`.

---

### Task 3: the type-check step

**Files:** Create `core/pipeline/types.mjs`, `test/pipeline/types.test.mjs`.

**Produces:** `typeCheck(root, config, specs) → Promise<result('types', …)>`.

- [ ] **Step 1: Failing tests** — `test/pipeline/types.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { typeCheck } from '../../core/pipeline/types.mjs'
import { calls, fakeBin } from '../runners/fake-bin.mjs'

const cfg = { adapter: 'vitest', jira: { projects: ['ABC'] } }
const proj = (tsconfig = true) => { const d = mkdtempSync(join(tmpdir(), 'qc-tsc-')); if (tsconfig) writeFileSync(join(d, 'tsconfig.json'), '{}'); return d }

test('compiles: pass, and tsc gets --noEmit -p <tsconfig>', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 0 })
  const r = await typeCheck(d, cfg, ['test/a.spec.ts'])
  assert.equal(r.status, 'pass')
  assert.equal(r.summary, 'compiles')
  assert.deepEqual(calls(d, 'tsc')[0], ['--noEmit', '-p', 'tsconfig.json'])
})
test('errors on stdout: fail with the first error TS line (review focus 4)', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 2, stdout: 'test/a.spec.ts(3,7): error TS2322: Type string is not number.\ntest/b.spec.ts(1,1): error TS1005\n' })
  const r = await typeCheck(d, cfg, ['test/a.spec.ts'])
  assert.equal(r.status, 'fail')
  assert.equal(r.summary, 'test/a.spec.ts(3,7): error TS2322: Type string is not number.')
})
test('not applicable without tsconfig and TS specs; not_run with TS specs but no tsconfig or no tsc', async () => {
  const a = await typeCheck(proj(false), cfg, ['test/a.spec.js'])
  assert.deepEqual([a.status, a.summary, a.data.applicable], ['pass', 'no TypeScript specs: nothing to type-check', false])
  const b = await typeCheck(proj(false), cfg, ['test/a.spec.ts'])
  assert.deepEqual([b.status, b.summary], ['not_run', 'no tsconfig.json: cannot type-check the TypeScript specs'])
  const c = await typeCheck(proj(), cfg, ['test/a.spec.ts'])
  assert.deepEqual([c.status, c.summary], ['not_run', 'TypeScript is not installed in this project: run npm install'])
})
test('a configured tsconfig is used', async () => {
  const d = proj(false)
  writeFileSync(join(d, 'tsconfig.test.json'), '{}')
  fakeBin(d, 'tsc', { exit: 0 })
  await typeCheck(d, { ...cfg, vitest: { tsconfig: 'tsconfig.test.json' } }, ['a.spec.ts'])
  assert.deepEqual(calls(d, 'tsc')[0], ['--noEmit', '-p', 'tsconfig.test.json'])
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `core/pipeline/types.mjs`:

```js
// Type-check step: the project's own tsc, --noEmit, on its tsconfig.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { result } from '../checks/result.mjs'

const TS = /\.(ts|tsx|mts|cts)$/

export function typeCheck(root, config, specs, { timeoutMs = (config.vitest?.timeoutSeconds ?? 300) * 1000 } = {}) {
  const tsconfig = config.vitest?.tsconfig ?? 'tsconfig.json'
  const hasTs = specs.some(s => TS.test(s))
  const has = existsSync(join(root, tsconfig))
  if (!has && !hasTs) return Promise.resolve(result('types', 'pass', 'no TypeScript specs: nothing to type-check', [], { applicable: false }))
  if (!has) return Promise.resolve(result('types', 'not_run', `no ${tsconfig}: cannot type-check the TypeScript specs`))
  const bin = join(root, 'node_modules/.bin/tsc')
  if (!existsSync(bin)) return Promise.resolve(result('types', 'not_run', 'TypeScript is not installed in this project: run npm install'))
  return new Promise(done => {
    let out = ''
    let timedOut = false
    let settled = false
    const child = spawn(bin, ['--noEmit', '-p', tsconfig], { cwd: root, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const keep = d => { if (out.length < 65536) out += d }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    const finish = r => { if (settled) return; settled = true; clearTimeout(timer); done(r) }
    child.on('error', e => finish(result('types', 'not_run', `could not start tsc: ${e.message}`)))
    child.on('close', code => {
      if (timedOut) return finish(result('types', 'not_run', `took longer than ${Math.round(timeoutMs / 1000)}s`))
      if (code === 0) return finish(result('types', 'pass', 'compiles', [], { applicable: true }))
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      const first = lines.find(l => /error TS\d+/.test(l)) ?? lines[0] ?? `tsc exited with ${code}`
      finish(result('types', 'fail', first, [{ kind: 'compile error', detail: first }], { applicable: true }))
    })
  })
}
```

- [ ] **Step 4:** run → PASS; `npm test` → all pass.
- [ ] **Step 5: Commit** `feat(pipeline): type-check step with the project's own tsc (AGT-44)`.

---

### Task 4: the pipeline

**Files:** Create `core/pipeline/vitest.mjs`, `test/pipeline/pipeline.test.mjs`.

**Consumes:** part 2 checks (`boundary.run({range}, ctx)`, `honesty.run({specs, range}, ctx)`, `suite.run({specs, key}, ctx)`, `mutation.run({spec, key, baseline}, ctx)`, `flaky.run({specs, runs}, ctx)`, `result()`, `anchorRange`), Task 2 `vitestRunner`, Task 3 `typeCheck`.
**Produces:** `decide(steps) → { verdict, decidedBy }`, `testsStep(run) → result`, `runPipeline({ specs, key, range, flakyRuns }, ctx) → { verdict, decidedBy, steps }`.

- [ ] **Step 1: Failing tests** — `test/pipeline/pipeline.test.mjs` (real temp git repo so boundary and honesty run for real; injected `runTests` and `typeCheck`):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { decide, runPipeline, testsStep } from '../../core/pipeline/vitest.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'
import { result } from '../../core/checks/result.mjs'
import { ENV } from '../checks/git-env.mjs'

const config = { adapter: 'vitest', jira: { projects: ['ABC'] } }
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const SPEC = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n})\n"
function repo(spec = SPEC) {
  const d = mkdtempSync(join(tmpdir(), 'qc-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/a.spec.ts', spec)
  return d
}
// A runner bound to the repo: 'adds' passes, except during mutation (a testName is given) when the
// spec text no longer contains the real assertion `toBe(2)` (the mutant is killed).
function makeRunner(root, opts = {}) {
  return async ({ files, testName }) => {
    if (opts.ran === false) return { ran: false, tests: [], error: 'db down' }
    const src = readFileSync(join(root, files[0]), 'utf8')
    const status = opts.red ? 'failed' : testName && !src.includes('toBe(2)') ? 'failed' : 'passed'
    return { ran: true, broken: [], tests: [{ title: 'adds', file: opts.red || !testName ? files[0] : files[0], status, message: status === 'failed' ? 'Expected 2' : '' }] }
  }
}
```

Then the tests:

```js
const ok = async () => result('types', 'pass', 'compiles', [], { applicable: true })
const ctx = (d, extra = {}) => ({ config, dialect: dialectFor('vitest'), root: d, runTests: makeRunner(d), typeCheck: ok, ...extra })

test('green: every step ran and passed; mutation used the step-5 baseline without a second run', async () => {
  const d = repo()
  let runs = 0
  const r0 = makeRunner(d)
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { runTests: async a => { if (!a.testName) runs++; return r0(a) } }))
  assert.equal(r.verdict, 'green')
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation'])
  assert.equal(runs, 1)
})
test('tests red', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: makeRunner(d, { red: true }) }))
  assert.equal(r.verdict, 'not_verified') // review focus 5: no passing test → empty baseline → mutation not_run
  assert.equal(r.steps.find(s => s.check === 'tests').status, 'fail')
  assert.equal(r.steps.find(s => s.check === 'mutation').status, 'not_run')
})
test('checks failed beats everything; types fail skips tests and mutation', async () => {
  const d = repo("it('hollow', () => { run() })\n")
  const failTypes = async () => result('types', 'fail', 'x.ts(1,1): error TS1', [], { applicable: true })
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { typeCheck: failTypes }))
  assert.equal(r.verdict, 'checks_failed')
  assert.equal(r.decidedBy, 'suite-honesty')
  assert.equal(r.steps.find(s => s.check === 'tests').summary, 'skipped: the specs do not compile')
  assert.equal(r.steps.find(s => s.check === 'mutation').status, 'not_run')
})
test('not verified when the tests could not run', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: makeRunner(d, { ran: false }) }))
  assert.equal(r.verdict, 'not_verified')
  assert.equal(r.decidedBy, 'tests')
})
test('a boundary violation fails the run', async () => {
  const d = repo()
  put(d, 'src/app.ts', 'x')
  assert.equal((await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d))).verdict, 'checks_failed')
})
test('flaky only when asked', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d))
  assert.equal(r.steps.at(-1).check, 'flaky')
})
test('testsStep and decide', () => {
  assert.equal(testsStep({ ran: true, broken: [], tests: [] }).status, 'not_run')
  assert.equal(testsStep({ ran: true, broken: [{ file: 'b', message: 'm' }], tests: [{ title: 'x', file: 'a', status: 'passed' }] }).status, 'not_run')
  assert.deepEqual(testsStep({ ran: true, broken: [], tests: [{ title: 'x', file: 'a', status: 'passed' }, { title: 'y', file: 'a', status: 'skipped' }] }).data, { ran: true, passed: 1, failed: 0, skipped: 1 })
  const s = (check, status) => ({ check, status })
  assert.deepEqual(decide([s('tests', 'fail'), s('mutation', 'not_run')]), { verdict: 'not_verified', decidedBy: 'mutation' })
  assert.deepEqual(decide([s('tests', 'fail'), s('mutation', 'pass')]), { verdict: 'tests_red', decidedBy: 'tests' })
  assert.deepEqual(decide([s('honesty', 'fail'), s('tests', 'not_run')]), { verdict: 'checks_failed', decidedBy: 'honesty' })
  assert.deepEqual(decide([s('tests', 'pass')]), { verdict: 'green', decidedBy: null })
})
test('a throwing step is reported with its name', async () => {
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { typeCheck: async () => { throw new Error('kaput') } })), e => e.step === 'types' && /kaput/.test(e.message))
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `core/pipeline/vitest.mjs`:

```js
// The Vitest pipeline: the shared checks, the type-check and the tests in a fixed order, then one
// verdict. Nothing here grades by opinion: every step is a script's result.
import * as boundary from '../checks/boundary.mjs'
import * as flaky from '../checks/flaky.mjs'
import * as honesty from '../checks/honesty.mjs'
import * as mutation from '../checks/mutation.mjs'
import { result } from '../checks/result.mjs'
import * as suite from '../checks/suite-honesty.mjs'
import { vitestRunner } from '../runners/vitest.mjs'
import { typeCheck as realTypeCheck } from './types.mjs'

export function decide(steps) {
  const failed = steps.find(s => s.status === 'fail' && s.check !== 'tests')
  if (failed) return { verdict: 'checks_failed', decidedBy: failed.check }
  const notRun = steps.find(s => s.status === 'not_run')
  if (notRun) return { verdict: 'not_verified', decidedBy: notRun.check }
  if (steps.some(s => s.check === 'tests' && s.status === 'fail')) return { verdict: 'tests_red', decidedBy: 'tests' }
  return { verdict: 'green', decidedBy: null }
}

export function testsStep(run) {
  if (!run.ran) return result('tests', 'not_run', `could not run: ${run.error}`, [], { ran: false })
  const count = s => run.tests.filter(t => t.status === s).length
  const data = { ran: true, passed: count('passed'), failed: count('failed'), skipped: count('skipped') }
  if ((run.broken ?? []).length) {
    const b = run.broken[0]
    return result('tests', 'not_run', `${run.broken.length} file(s) never ran: ${b.file}: ${b.message}`, run.broken.map(x => ({ file: x.file, kind: 'never ran', detail: x.message })), data)
  }
  if (!data.passed && !data.failed) return result('tests', 'not_run', 'no tests ran', [], data)
  if (data.failed) {
    const failed = run.tests.filter(t => t.status === 'failed')
    return result('tests', 'fail', `${data.failed} of ${data.passed + data.failed} tests failed`, failed.map(t => ({ file: t.file, test: t.title, kind: 'failed', detail: t.message })), data)
  }
  return result('tests', 'pass', `${data.passed} passed`, [], data)
}

async function mutationStep(specs, key, run, ctx) {
  const per = []
  for (const spec of specs) {
    const baseline = run.tests.filter(t => t.file === spec && t.status === 'passed').map(t => t.title)
    const r = await mutation.run({ spec, key, baseline }, ctx)
    if (key && r.status === 'not_run' && r.findings.some(f => f.kind === 'no anchor block')) continue
    per.push(r)
  }
  if (!per.length) return result('mutation', 'not_run', key ? `no ${key} block in the specs` : 'nothing to mutate')
  const sum = k => per.reduce((n, r) => n + (r.data?.[k] ?? 0), 0)
  const data = { killed: sum('killed'), survived: sum('survived'), errors: sum('errors'), total: sum('total'), survivors: per.flatMap(r => r.data?.survivors ?? []) }
  const findings = per.flatMap(r => r.findings)
  if (per.some(r => r.status === 'fail')) return result('mutation', 'fail', `${data.survived} of ${data.total} mutant(s) survived: an assertion that cannot fail`, findings, data)
  const nr = per.find(r => r.status === 'not_run')
  if (nr) return result('mutation', 'not_run', nr.summary, findings, data)
  return result('mutation', 'pass', data.total ? `${data.killed}/${data.total} mutants killed` : 'no eligible assertions to mutate', findings, data)
}

export async function runPipeline({ specs, key = null, range = null, flakyRuns = null }, ctx) {
  const runTests = ctx.runTests ?? vitestRunner(ctx.root, ctx.config)
  const typeCheck = ctx.typeCheck ?? (s => realTypeCheck(ctx.root, ctx.config, s))
  const c = { ...ctx, runTests }
  const step = async (name, fn) => {
    try { return await fn() } catch (e) { const err = new Error(String(e?.message ?? e)); err.step = name; throw err }
  }
  const steps = []
  steps.push(await step('boundary', () => boundary.run({ range }, c)))
  steps.push(await step('honesty', () => honesty.run({ specs, range }, c)))
  steps.push(await step('suite-honesty', () => suite.run({ specs, key }, c)))
  const types = await step('types', () => typeCheck(specs))
  steps.push(types)
  let run = null
  if (types.status === 'fail') steps.push(result('tests', 'not_run', 'skipped: the specs do not compile', [], { ran: false }))
  else if (types.status === 'not_run') steps.push(result('tests', 'not_run', 'skipped: the type-check could not run', [], { ran: false }))
  else {
    run = await step('tests', () => runTests({ files: specs }))
    steps.push(testsStep(run))
  }
  if (run?.ran) steps.push(await step('mutation', () => mutationStep(specs, key, run, c)))
  else steps.push(result('mutation', 'not_run', 'skipped: the tests did not run'))
  if (flakyRuns) steps.push(await step('flaky', () => flaky.run({ specs, runs: flakyRuns }, c)))
  return { ...decide(steps), steps }
}
```

- [ ] **Step 4:** run → PASS; `npm test` → all pass; grep `! grep -rn -E 'AGT|FIC|warehouse' core/runners core/pipeline`.
- [ ] **Step 5: Commit** `feat(pipeline): the Vitest pipeline and its verdict (AGT-44)`.

---

### Task 5: the card

**Files:** Create `core/pipeline/card.mjs`, `test/pipeline/card.test.mjs`.

**Produces:** `formatCard(outcome, { specs, key }) → string` (card lines, then `PIPELINE_JSON:{...}` as the last line).

- [ ] **Step 1: Failing tests** — `test/pipeline/card.test.mjs`. Exact expected text for one checks-failed outcome, plus assertions for each verdict line and each "What to do" row of spec §6:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCard } from '../../core/pipeline/card.mjs'

const s = (check, status, summary, findings = [], data = {}) => ({ check, status, summary, findings, data })
const base = [
  s('boundary', 'pass', 'no change outside the boundary'),
  s('honesty', 'pass', 'no assertion or test removed, no skip without a ticket'),
  s('suite-honesty', 'fail', '1 test(s) run but assert nothing', [{ file: 'orders.spec.ts', test: 'cancels', kind: 'hollow test', detail: 'runs but has no expect()' }]),
  s('types', 'pass', 'compiles'),
  s('tests', 'pass', '8 passed', [], { ran: true, passed: 8, failed: 0, skipped: 1 }),
  s('mutation', 'not_run', 'skipped: the tests did not run'),
]

test('the checks-failed card, exactly', () => {
  const out = formatCard({ verdict: 'checks_failed', decidedBy: 'suite-honesty', steps: base }, { specs: ['a.spec.ts', 'b.spec.ts'], key: 'ABC-123' })
  const lines = out.split('\n')
  assert.deepEqual(lines.slice(0, -1), [
    'quality-code check · 2 spec files · ticket ABC-123',
    '',
    'Verdict: ❌ checks failed',
    '',
    'Tests     8 passed · 0 failed · 1 to do',
    'Checks',
    '  ✅ boundary       no change outside the boundary',
    '  ✅ honesty        no assertion or test removed, no skip without a ticket',
    "  ❌ assertions     1 test(s) run but assert nothing: orders.spec.ts › 'cancels'",
    '  ✅ types          compiles',
    '  ✅ tests          8 passed',
    '  ⚠️ mutation       not run: skipped: the tests did not run',
    '',
    "What to do: add a real expect(...) to 'cancels', or mark it todo if the behaviour isn't known yet.",
  ])
  assert.ok(lines.at(-1).startsWith('PIPELINE_JSON:'))
  assert.equal(JSON.parse(lines.at(-1).slice(14)).verdict, 'checks_failed')
})
test('verdict lines and one spec without a key', () => {
  const t = v => formatCard({ verdict: v, decidedBy: null, steps: [] }, { specs: ['a.spec.ts'], key: null })
  assert.match(t('green'), /^quality-code check · 1 spec file\n\nVerdict: ✅ green/)
  assert.match(t('not_verified'), /Verdict: ⚠️ not verified/)
  assert.match(t('tests_red'), /Verdict: 🔴 tests red/)
})
test('what to do, per deciding step', () => {
  const card = (decidedBy, step, verdict = 'checks_failed') => formatCard({ verdict, decidedBy, steps: [step] }, { specs: ['a'], key: null }).split('\n').find(l => l.startsWith('What to do:'))
  assert.equal(card('boundary', s('boundary', 'fail', 'x', [{ file: 'src/a.ts' }, { file: '.env' }])), 'What to do: undo the changes to src/a.ts, .env: tests never change application code.')
  assert.equal(card('honesty', s('honesty', 'fail', 'x')), 'What to do: restore the removed assertion or test, or name a ticket on the skip.')
  assert.equal(card('types', s('types', 'fail', 'a.ts(1,1): error TS1')), 'What to do: fix the compile error: a.ts(1,1): error TS1')
  assert.equal(card('mutation', s('mutation', 'fail', 'x', [{ test: 'adds' }, { test: 'subs' }])), "What to do: an assertion can't fail: bind the real expected value in 'adds', 'subs'.")
  assert.equal(card('flaky', s('flaky', 'fail', 'x', [{ test: 'a > t' }])), "What to do: fix the non-determinism in 'a > t', or skip it with a ticket.")
  assert.equal(card('tests', s('tests', 'fail', 'x', [{ test: 'adds', detail: 'Expected 2' }]), 'tests_red'), "What to do: 'adds': Expected 2. For a bug whose fix isn't merged yet, red is the expected result.")
  assert.equal(card('tests', s('tests', 'not_run', 'could not run: db down'), 'not_verified'), 'What to do: tests could not run: could not run: db down')
  assert.equal(formatCard({ verdict: 'green', decidedBy: null, steps: [] }, { specs: ['a'] }).includes('What to do'), false)
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `core/pipeline/card.mjs`: a `LABEL` map (`suite-honesty` → `assertions`, others their own name), an `ICON` map (`pass` ✅, `fail` ❌, `not_run` ⚠️), the verdict line map (`green` ✅ green, `checks_failed` ❌ checks failed, `not_verified` ⚠️ not verified, `tests_red` 🔴 tests red), a header `quality-code check · <n> spec file(s) · ticket <KEY>` (omit the ticket part with no key; "file" singular for 1), a `Tests` line from the `tests` step data (`<passed> passed · <failed> failed · <skipped> to do`; leave the line out when the step has no data counts), the step lines padded to 15 characters after the icon (`'  ' + icon + ' ' + label.padEnd(15) + text`; text = summary, plus `: <file> › '<test>'` for the first finding with a test when the step failed, and prefixed with `not run: ` when not_run), then `What to do: …` from spec §6 for `decidedBy` (none for green), then `PIPELINE_JSON:` + `JSON.stringify(outcome)`. Match the exact strings of the tests above.
- [ ] **Step 4:** run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(pipeline): the result card (AGT-44)`.

---

### Task 6: the pipeline CLI

**Files:** Create `core/pipeline/cli.mjs`, `test/pipeline/cli.test.mjs`.

**Produces:** `main(argv, env, cwd) → Promise<exit code>`; usage `node core/pipeline/cli.mjs <spec…> [--key KEY] [--range A...B] [--flaky N] [--json]`.

- [ ] **Step 1: Failing tests** — spawn the CLI against temp repos with a valid vitest config, a fake `vitest` and a fake `tsc` (`test/runners/fake-bin.mjs`): green → exit 0 and the card ends with a `PIPELINE_JSON` line; `--json` → only JSON; a red run → exit 1… (with a passing test plus a failing test so mutation still has a baseline); fake vitest with no report → exit 3; `adapter: playwright` → exit 2 and "the Playwright pipeline comes with part 3"; missing spec, `--key` outside the projects, `--flaky 0`, an option value starting with `-`, no config → exit 2; a crash (inject via a broken `node_modules/.bin/tsc` that is a directory → spawn error is a not_run, so instead test the crash path by calling `main` in-process with a `ctx` override hook… keep it simple: export `main(argv, env, cwd, { runPipeline } = {})` so a test can inject a throwing pipeline) → exit 2 and stderr `check types crashed: kaput`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** following `core/checks/cli.mjs`'s parse style (values must not start with `-`; known flags only), config via `loadConfig`/`projectRoot`, `dialectFor`, `isProjectKey`, spec existence; `--flaky` a whole number ≥ 1; call `runPipeline`; print `formatCard(...)` or the JSON; exit by verdict (`green` 0, `checks_failed`/`tests_red` 1, `not_verified` 3); catch → stderr `check <err.step ?? 'pipeline'> crashed: <first line>` and exit 2.
- [ ] **Step 4:** run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(pipeline): pipeline CLI with the card and exit codes (AGT-44)`.

---

### Task 7: `/quality-code:check` and the `start` option

**Files:** Create `commands/check.md`, `test/check-command.test.mjs`; Modify `commands/start.md`, `test/start-command.test.mjs`.

- [ ] **Step 1: Failing tests** — `test/check-command.test.mjs` pins in `commands/check.md`: frontmatter `description` and `argument-hint: [spec…] [--key KEY] [--flaky N]`; with no specs it runs `core/branch.mjs" --detect` and offers `Check these <n> spec files?` with `1. Yes`, `2. Pick some`, `3. Stop`; the key from the branch is confirmed; the one-line "Running the checks: tests, assertions, types and mutation; this can take a few minutes." before the run; the CLI call `core/pipeline/cli.mjs"`; "Show the card exactly as printed" and dropping the `PIPELINE_JSON:` line; "Never edit tests" and "never retry"; Playwright projects get "the Playwright pipeline comes with part 3"; no `mcp__`. In `test/start-command.test.mjs` update the step 4 test: the card lists `1. Evaluate the ticket`, `2. Check the tests on this branch`, `3. Write and check tests (coming with part 4b)`, `4. Stop`; option 2 only when `counts.test` > 0 and the adapter is `vitest`; option 2 follows `${CLAUDE_PLUGIN_ROOT}/commands/check.md` with the branch's test files and the confirmed key; option 3 says `Writing tests for any project comes with part 4b.`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Write `commands/check.md` (same tone and structure as `start.md`: Rules, then numbered steps) and change `start.md` step 4 accordingly (keep the existing option 1 text; when option 2 is not offered, renumber so the card shows `1. Evaluate the ticket / 2. Write and check tests (coming with part 4b) / 3. Stop`).
- [ ] **Step 4:** run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(commands): /quality-code:check and the start option to check the branch's tests (AGT-44)`.

---

### Task 8: the Vitest-configs card in advanced setup

**Files:** Modify `core/setup.mjs` (detect gains `vitestConfigs`), `commands/setup.md` (end of A4), `test/setup.test.mjs`, `test/setup-command.test.mjs`.

- [ ] **Step 1: Failing tests** — `detect(root).vitestConfigs` lists root files matching `/^vitest(\.[\w-]+)?\.config\.[cm]?[jt]s$/` or `/^vitest\.config(\.[\w-]+)?\.[cm]?[jt]s$/`, sorted (e.g. `vitest.config.ts`, `vitest.config.db.ts`, `vitest.e2e.config.mts`), `[]` when none. `setup.md` A4 has a **Which Vitest config runs which tests** paragraph shown only for `vitest` when `vitestConfigs` has more than one entry: for each config it asks the folder or pattern it runs (prefix ending `/`, exact path or `*`/`**` glob) and writes `vitest: { configs: [{ match, config }…] }`, keeping an existing `vitest` block and offering only changes; A5's write sentence mentions `vitest`. The short steps 0–4 do not mention Vitest configs.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement (targeted edits; keep the boundaries card above it).
- [ ] **Step 4:** run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(setup): Vitest configs card in advanced setup (AGT-44)`.

---

### Task 9: docs, guards, release 0.5.0

**Files:** `.github/workflows/test.yml`, `README.md`, `docs/GETTING_STARTED.md`, `CHANGELOG.md`, `docs/specs/2026-10-14-part-4a-vitest-pipeline-design.md`, `.claude-plugin/plugin.json`.

- [ ] **Step 1:** CI: extend the "no project keys in the checks" step to `plugins/quality-code/core/checks plugins/quality-code/core/runners plugins/quality-code/core/pipeline`, and the "no project values in core" grep already covers `core/`.
- [ ] **Step 2:** Spec: record Rulings 1–3 of this plan (the `-t` pattern, mutation per spec, the card in A4) in a new "§13 Rulings during the build".
- [ ] **Step 3:** README: "What you can do today" row `| Check the tests on your branch: run them and grade them | \`/quality-code:check\` (or start, option 2) | ✅ available (Vitest) |` and the "Write and grade backend tests" row stays planned (4b); a "Check your tests" section (after "Check a ticket") with the command, the card example from the spec, the four verdicts and the exit codes; the `vitest` block in the config table; the roadmap part 4 row "4a available (checking), 4b next (writing)". No version numbers in the README.
- [ ] **Step 4:** GETTING_STARTED: a short "Check your tests" part under the daily flow.
- [ ] **Step 5:** CHANGELOG `## [0.5.0] - 2026-10-14` above `## [0.4.0]`: Added `/quality-code:check`, the Vitest pipeline (order, verdicts), the `start` option, the `vitest` config block and its advanced card; Upgrade: update the plugin before re-running setup (0.4.x refuses a `vitest` block). `plugin.json` version `0.5.0`, description mentions checking tests.
- [ ] **Step 6:** run `npm test`, both `claude plugin validate`, the greps, and the README/CHANGELOG link check.
- [ ] **Step 7: Commit** `release: quality-code 0.5.0 with the Vitest pipeline and /quality-code:check (AGT-44)`.
