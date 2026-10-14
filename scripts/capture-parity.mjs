#!/usr/bin/env node
// Run every parity fixture through today's warehouse scorers and record what they print.
// Needs the two warehouse repos next to this one (or WAREHOUSE_FE / WAREHOUSE_BE); CI does not:
// the captured files under plugins/quality-code/test/parity/expected/ are committed.
//
//   node scripts/capture-parity.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PARITY = join(ROOT, 'plugins/quality-code/test/parity')
const SOURCES = {
  fe: {
    repo: process.env.WAREHOUSE_FE || resolve(ROOT, '../warehouse-frontend'),
    ref: 'origin/agentic-testing-fe',
    files: ['score-ticket.mjs'],
  },
  be: {
    repo: process.env.WAREHOUSE_BE || resolve(ROOT, '../warehouse-backend'),
    ref: 'origin/agt-34-remove-audit-logs',
    // the scorer imports ./expected-check.mjs; the sanitizer is kept for reference
    files: ['score-ticket.mjs', 'expected-check.mjs', 'sanitize-ticket.mjs'],
  },
}

// --checks: the five checks. Old scripts run their CLI on import, so each is cut at its entry
// point (CUT) and the pure functions are imported from the cut copy; suite-honesty's verdict
// comes from running the whole old CLI, as the pipeline does.
const CHECK_FILES = {
  fe: { harness: ['honesty-check.mjs', 'suite-honesty.mjs', 'flaky-check.mjs', 'mutate-generated.mjs'], guard: '.claude/boundary-guard.mjs', dirs: ['e2e/tests'], spec: p => /^e2e\/tests\/.*FIC-\d+\.spec\.ts$/.test(p) },
  be: { harness: ['honesty-check.mjs', 'suite-honesty.mjs', 'flaky-check.mjs', 'mutate-generated.mjs'], guard: '.claude/boundary-guard.mjs', dirs: ['test/unit', 'test/integration', 'test/range'], spec: p => /^test\/(unit|integration|range)\/.*\.spec\.ts$/.test(p) },
}
const CUT = /^(?:const (?:args|rawArgs) = process\.argv|if \(process\.argv|main\(\);?\s*$)/m
const DIFFS_PER_REPO = 15
// Synthetic negatives: still run through the OLD scripts, so the failure paths are compared too.
const SYNTHETIC = {
  fe: {
    'hollow.spec.ts': "import { test, expect } from '@playwright/test'\ntest('ok', async () => { await expect(x).toBeVisible() })\ntest('hollow', async () => { await page.goto('/') })\n",
    'fixme.spec.ts': "import { test } from '@playwright/test'\ntest.fixme('later one', async () => {})\ntest.fixme('later two', async () => {})\n",
    'capture.spec.ts': "import { test, expect } from '@playwright/test'\ntest('FIC-1 — design-conformance capture', async () => { await page.screenshot() })\ntest('honest', async () => { await expect(x).toBeVisible() })\n",
  },
  be: {
    'hollow.spec.ts': "it('ok', () => { expect(1).toBe(1) })\nit('hollow', () => { run() })\n",
    'todo.spec.ts': "it.todo('later')\nit.todo('later two')\n",
    'outside.spec.ts': "describe('FIC-1 — anchor', () => { it('in', () => { expect(1).toBe(1) }) })\nit('outside', () => {})\n",
  },
}
const SYNTHETIC_PATHS = ['src/a.ts', 'src', 'src-tauri/x.rs', 'e2e/src/h.ts', '.env', '.env.example', '.env.local', '.gitlab-ci.yml', 'prisma/schema.prisma', 'dapr/c.yaml', 'dist/x.js', 'node_modules/a/b.js', 'src/x.spec.ts', 'test/x.spec.ts']
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
  if (!m && basename(path) !== 'boundary-guard.mjs' && path.startsWith('.claude/harness/')) throw new Error(`no CLI entry point found in ${path}`)
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
      const captureSpec = (fixture, src, synthetic) => {
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
          for (const pl of plans) if (!synthetic || pl.mutants.length) expected.mutation.push({ repo: name, fixture, key, passed, ...pl })
        }
      }
      for (const p of specs) captureSpec(`${name}/specs/${p.replace(/\//g, '__')}.txt`, mask(show(repo, ref, p)), false)
      for (const [file, src] of Object.entries(SYNTHETIC[name])) captureSpec(`${name}/synthetic/${file}.txt`, mask(src), true)

      // synthetic boundary paths through the old guard
      for (const p of SYNTHETIC_PATHS) {
        if (name === 'fe') {
          const v = old.guard.mod.violation(p)
          expected.boundary.push({ repo: name, variant: 'default', path: p, forbidden: Boolean(v), why: v?.why ?? null })
        } else {
          for (const variant of ['default', 'mocked']) expected.boundary.push({ repo: name, variant, path: p, forbidden: old.guard.mod.isForbidden(p, { allowSrcSpecs: variant === 'mocked' }), why: null })
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

// Today's backend names the feature-label key warehouse_label (spec §10 #5): fixtures use the new
// name, so translate it back when calling the old script.
const oldKey = (repo, key) => (repo === 'be' && key === 'feature_label' ? 'warehouse_label' : key)

/** The old flag form of one op. */
export function oldArgs(repo, op) {
  const [cmd, ...rest] = op
  switch (cmd) {
    case 'score': return rest
    case 'refuse-comment': return ['--refuse-comment']
    case 'fill-menu': return ['--fill-menu']
    case 'pick': return ['--pick', rest[0]]
    case 'add': return ['--add', oldKey(repo, rest[0]), rest[1]]
    case 'jira-update': return ['--jira-update']
    default: throw new Error(`unknown op ${cmd}`)
  }
}

/**
 * Today's backend sanitizer on every raw input of test/parity/sanitize-inputs.mjs. The inputs are
 * built at runtime and outputs are masked, so no customer id or e-mail is written (Ruling R11).
 */
async function captureSanitize(tmp, commit, expectedDir) {
  const { sanitizeInputs, mask } = await import(pathToFileURL(join(PARITY, 'sanitize-inputs.mjs')).href)
  const results = sanitizeInputs().map(({ name, raw }) => {
    const work = mkdtempSync(join(tmp, 'sanitize-'))
    writeFileSync(join(work, 'raw.json'), JSON.stringify(raw))
    const r = spawnSync('node', [join(tmp, 'be', 'sanitize-ticket.mjs'), '--in', `@${join(work, 'raw.json')}`, '--out', join(work, 'ticket.json')], { cwd: work, encoding: 'utf8' })
    if (r.error) throw r.error
    const out = r.status === 0 ? JSON.parse(mask(readFileSync(join(work, 'ticket.json'), 'utf8'))) : null
    return { name, stdout: mask(r.stdout), exit: r.status, out }
  })
  const file = { source: { ref: SOURCES.be.ref, commit, script: 'sanitize-ticket.mjs' }, results }
  writeFileSync(join(expectedDir, 'sanitize.json'), `${JSON.stringify(file, null, 2)}\n`)
  return results.length
}

function extract(tmp) {
  const commits = {}
  for (const [name, s] of Object.entries(SOURCES)) {
    const dir = join(tmp, name)
    mkdirSync(dir, { recursive: true })
    for (const f of s.files) {
      const src = execFileSync('git', ['-C', s.repo, 'show', `${s.ref}:.claude/harness/${f}`], { encoding: 'utf8' })
      writeFileSync(join(dir, f), src)
    }
    commits[name] = execFileSync('git', ['-C', s.repo, 'rev-parse', s.ref], { encoding: 'utf8' }).trim()
  }
  return commits
}

async function main() {
  // Real path: the old sanitizer runs main() only when argv[1] equals its own resolved path, and
  // the macOS temp dir is a symlink.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'parity-capture-')))
  try {
    const commits = extract(tmp)
    const expectedDir = join(PARITY, 'expected')
    mkdirSync(expectedDir, { recursive: true })
    for (const f of readdirSync(expectedDir)) if (f.endsWith('.json')) rmSync(join(expectedDir, f))
    const fixtures = readdirSync(join(PARITY, 'fixtures')).filter(f => f.endsWith('.json')).sort()
    let ops = 0
    for (const f of fixtures) {
      const fx = JSON.parse(readFileSync(join(PARITY, 'fixtures', f), 'utf8'))
      const work = mkdtempSync(join(tmp, 'run-'))
      const ticketPath = join(work, 'ticket.json')
      writeFileSync(ticketPath, JSON.stringify(fx.ticket))
      const results = fx.ops.map(op => {
        const r = spawnSync('node', [join(tmp, fx.repo, 'score-ticket.mjs'), '--in', `@${ticketPath}`, ...oldArgs(fx.repo, op), '--no-audit'], { cwd: work, encoding: 'utf8' })
        if (r.error) throw r.error
        ops++
        const res = { op, stdout: r.stdout, exit: r.status }
        if (op[0] === 'add') res.fileAfter = JSON.parse(readFileSync(ticketPath, 'utf8'))
        return res
      })
      const out = { fixture: f, repo: fx.repo, source: { ref: SOURCES[fx.repo].ref, commit: commits[fx.repo] }, results }
      writeFileSync(join(expectedDir, f), `${JSON.stringify(out, null, 2)}\n`)
    }
    console.log(`captured ${fixtures.length} fixtures, ${ops} ops`)
    console.log(`captured ${await captureSanitize(tmp, commits.be, expectedDir)} sanitize inputs`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await (process.argv.includes('--checks') ? captureChecks() : main())
