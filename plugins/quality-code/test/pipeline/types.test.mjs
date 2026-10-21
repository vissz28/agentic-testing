import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ownTsconfig, readTsc, scopedTsconfig, typeCheck } from '../../lib/pipeline/types.mjs'
import { calls, fakeBin } from '../fake-bin.mjs'

const cfg = { adapter: 'vitest', jira: { projects: ['ABC'] } }
const proj = (tsconfig = true) => { const d = mkdtempSync(join(tmpdir(), 'qc-tsc-')); if (tsconfig) writeFileSync(join(d, 'tsconfig.json'), '{}'); return d }

const SCOPED = /^mut-tmp-qc-tsconfig-[0-9a-f]{8}\.json$/
test('compiles: pass, and tsc gets --noEmit -p <a scoped tsconfig next to the project one>', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 0 })
  const r = await typeCheck(d, cfg, ['test/a.spec.ts'])
  assert.equal(r.status, 'pass')
  assert.equal(r.summary, 'compiles')
  const argv = calls(d, 'tsc')[0]
  assert.deepEqual([argv[0], argv[1], argv[3]], ['--noEmit', '-p', '--incremental'])
  assert.match(argv[2], SCOPED)
  assert.deepEqual(argv.slice(-2), ['--pretty', 'false'])
})
test('the scoped tsconfig extends the project one and adds the specs; include and exclude are inherited', () => {
  assert.deepEqual(scopedTsconfig('e2e/tsconfig.json', ['e2e/a.spec.ts']), { extends: './tsconfig.json', compilerOptions: { composite: false }, files: ['a.spec.ts'] })
  assert.deepEqual(scopedTsconfig('tsconfig.db.json', ['test/unit/a.spec.ts']).files, ['test/unit/a.spec.ts'], 'relative to the tsconfig, never absolute')
})
test('only errors in a spec fail; errors elsewhere pass; tsc that never checked is not_run', () => {
  const specs = ['test/a.spec.ts']
  const f = readTsc('src/x.ts(1,1): error TS2322: no\ntest/a.spec.ts(3,7): error TS2322: bad\n', 2, specs)
  assert.deepEqual([f.status, f.summary, f.findings[0].file], ['fail', 'test/a.spec.ts(3,7): error TS2322: bad', 'test/a.spec.ts'])
  const other = readTsc('src/x.ts(1,1): error TS2322: no\nsrc/y.ts(2,2): error TS6133: unused\n', 2, specs)
  assert.deepEqual([other.status, other.summary], ['pass', 'compiles; 2 error(s) in other files, not in the specs'])
  assert.equal(readTsc("error TS5058: The specified path does not exist: 'x.json'.\n", 1, specs).status, 'not_run')
  assert.equal(readTsc("tsconfig.json(2,3): error TS5023: Unknown compiler option 'x'.\n", 1, specs).status, 'not_run')
  assert.deepEqual([readTsc('', 1, specs).status, readTsc('', 1, specs).summary], ['not_run', 'tsc exited with 1: no output'])
  assert.equal(readTsc('src/x.ts(1,1): error TS2322: no\n', 2, specs, true).status, 'not_run', 'a cut-off output may have lost a spec error')
  assert.equal(readTsc('test/a.spec.ts(1,1): error TS2322: bad\n', 2, specs, true).status, 'fail')
})
test('tsc build info goes to a temp folder that is removed; the project is unchanged', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 0 })
  const before = readdirSync(d).sort()
  await typeCheck(d, cfg, ['test/a.spec.ts'])
  const argv = calls(d, 'tsc')[0]
  const info = argv[argv.indexOf('--tsBuildInfoFile') + 1]
  assert.ok(info.endsWith('qc.tsbuildinfo') && !info.startsWith(d))
  assert.equal(existsSync(dirname(info)), false)
  assert.deepEqual(readdirSync(d).sort(), before.concat(['.fake-tsc.calls']).sort())
})
test('errors on stdout: fail with the first error TS line (review focus 4)', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 2, stdout: 'test/a.spec.ts(3,7): error TS2322: Type string is not number.\ntest/b.spec.ts(1,1): error TS1005\n' })
  const r = await typeCheck(d, cfg, ['test/a.spec.ts'])
  assert.equal(r.status, 'fail')
  assert.equal(r.summary, 'test/a.spec.ts(3,7): error TS2322: Type string is not number.')
})
test('not applicable without TS specs; not_run with TS specs but no tsconfig or no tsc', async () => {
  for (const d of [proj(false), proj()]) {
    const a = await typeCheck(d, cfg, ['test/a.spec.js'])
    assert.deepEqual([a.status, a.summary, a.data.applicable], ['pass', 'no TypeScript specs: nothing to type-check', false])
  }
  const b = await typeCheck(proj(false), cfg, ['test/a.spec.ts'])
  assert.deepEqual([b.status, b.summary], ['not_run', 'no tsconfig.json: cannot type-check the TypeScript specs'])
  const c = await typeCheck(proj(), cfg, ['test/a.spec.ts'])
  assert.deepEqual([c.status, c.summary], ['not_run', 'TypeScript is not installed in this project'])
})
test('a solution-style tsconfig (only references) is not extended: the referenced one whose include covers the specs is', async () => {
  const d = proj(false)
  writeFileSync(join(d, 'tsconfig.json'), '{\n  // the Vite template\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" },],\n}\n')
  writeFileSync(join(d, 'tsconfig.app.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "include": ["src"] }')
  writeFileSync(join(d, 'tsconfig.node.json'), '{ "include": ["vite.config.ts"] }')
  assert.equal(ownTsconfig(d, 'tsconfig.json', ['src/btn.test.tsx']), 'tsconfig.app.json')
  assert.equal(ownTsconfig(d, 'tsconfig.json', ['vite.config.ts']), 'tsconfig.node.json')
  assert.equal(ownTsconfig(d, 'tsconfig.json', ['e2e/a.spec.ts']), 'tsconfig.json', 'no reference covers it: the configured one')
  fakeBin(d, 'tsc', { exit: 0 })
  await typeCheck(d, cfg, ['src/btn.test.tsx'])
  assert.match(calls(d, 'tsc')[0][2], SCOPED)
  writeFileSync(join(d, 'tsconfig.json'), '{ "compilerOptions": {}, "references": [{ "path": "./tsconfig.app.json" }] }')
  assert.equal(ownTsconfig(d, 'tsconfig.json', ['src/btn.test.tsx']), 'tsconfig.json', 'a tsconfig with files of its own is kept')
})
test('a configured tsconfig is used', async () => {
  const d = proj(false)
  writeFileSync(join(d, 'tsconfig.test.json'), '{}')
  fakeBin(d, 'tsc', { exit: 0 })
  await typeCheck(d, { ...cfg, vitest: { tsconfig: 'tsconfig.test.json' } }, ['a.spec.ts'])
  assert.match(calls(d, 'tsc')[0][2], SCOPED)
  const e = proj(false)
  mkdirSync(join(e, 'e2e'))
  writeFileSync(join(e, 'e2e/tsconfig.json'), '{}')
  fakeBin(e, 'tsc', { exit: 0 })
  await typeCheck(e, { ...cfg, vitest: { tsconfig: 'e2e/tsconfig.json' } }, ['e2e/a.spec.ts'])
  const p = calls(e, 'tsc')[0][2]
  assert.ok(p.startsWith('e2e/') && SCOPED.test(p.slice(4)), `next to the configured tsconfig: ${p}`)
  assert.deepEqual(readdirSync(join(e, 'e2e')), ['tsconfig.json'], 'the scoped tsconfig is removed')
})
test('a hung tsc is killed with its process group and gives not_run promptly', async () => {
  const d = proj()
  fakeBin(d, 'tsc', { exit: 0, sleepMs: 30000, grandchild: true })
  const t0 = Date.now()
  const r = await typeCheck(d, cfg, ['a.spec.ts'], { timeoutMs: 300 })
  assert.equal(r.status, 'not_run')
  assert.match(r.summary, /took longer than/)
  assert.ok(Date.now() - t0 < 5000)
})
test('Playwright: playwright.tsconfig is used; the vitest block is not read', async () => {
  const d = proj(false)
  writeFileSync(join(d, 'e2e.tsconfig.json'), '{}')
  fakeBin(d, 'tsc', { exit: 0 })
  const r = await typeCheck(d, { adapter: 'playwright', jira: { projects: ['ABC'] }, playwright: { tsconfig: 'e2e.tsconfig.json' }, vitest: { tsconfig: 'no.json' } }, ['e2e/a.spec.ts'])
  assert.equal(r.status, 'pass')
  assert.match(calls(d, 'tsc')[0][2], SCOPED)
  const p = await typeCheck(proj(false), { adapter: 'playwright', jira: { projects: ['ABC'] } }, ['e2e/a.spec.ts'])
  assert.deepEqual([p.status, p.summary], ['not_run', 'no tsconfig.json: cannot type-check the TypeScript specs'])
})
