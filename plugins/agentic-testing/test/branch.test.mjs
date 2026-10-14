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
