import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSpecs } from '../../lib/report/quality-program.mjs'

test('projectSpecs skips git-ignored folders and a workspace on another unit runner', async () => {
  const { projectSpecs } = await import('../../lib/report/quality-program.mjs')
  const { execFileSync } = await import('node:child_process')
  const d = mkdtempSync(join(tmpdir(), 'qc-qp-'))
  const put = (p, s = '') => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), s) }
  execFileSync('git', ['init', '-q'], { cwd: d })
  put('.gitignore', 'build-copy/\n')
  put('package.json', '{"workspaces":["services/*","web"]}')
  put('services/a/package.json', '{"devDependencies":{"jest":"^29"}}')
  put('services/a/src/x.test.ts', "test('x', () => { expect(1).toBe(1) })")
  put('web/package.json', '{"devDependencies":{"vitest":"^1"}}')
  put('web/src/y.test.tsx', "test('y', () => { expect(1).toBe(1) })")
  put('build-copy/services/a/src/x.test.ts', "test('x', () => { expect(1).toBe(1) })")
  put('.build-context/z.test.ts', "test('z', () => { expect(1).toBe(1) })")
  const cfg = { adapter: 'vitest', jira: { projects: ['ABC'] }, runners: { unit: 'jest' } }
  assert.deepEqual(projectSpecs(d, cfg).map(s => s.path), ['services/a/src/x.test.ts'])
  const vi = { adapter: 'vitest', jira: { projects: ['ABC'] } }
  assert.deepEqual(projectSpecs(d, vi).map(s => s.path).sort(), ['web/src/y.test.tsx'])
})

test('suite honesty leaves out the titles of playwright.ungradedTitles, as the check does', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-qp-'))
  mkdirSync(join(d, 'e2e'))
  writeFileSync(join(d, 'e2e/a.spec.ts'), "test('ABC-1 shows', async () => { await expect(p).toBeVisible() })\ntest('ABC-1 — design-conformance capture', async () => { await shot() })\n")
  const cfg = { adapter: 'playwright', jira: { projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
  assert.deepEqual([scanSpecs(d, cfg).tests, scanSpecs(d, cfg).honest], [2, 1])
  const off = { ...cfg, playwright: { folder: 'e2e/', ungradedTitles: 'capture' } }
  assert.deepEqual([scanSpecs(d, off).tests, scanSpecs(d, off).honest], [1, 1])
})
