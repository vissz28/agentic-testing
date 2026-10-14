import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  assert.deepEqual(calls(d, 'tsc')[0].slice(0, 4), ['--noEmit', '-p', 'tsconfig.json', '--incremental'])
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
  assert.deepEqual(calls(d, 'tsc')[0].slice(0, 3), ['--noEmit', '-p', 'tsconfig.test.json'])
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
