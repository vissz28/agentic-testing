import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSpecs } from '../../lib/report/quality-program.mjs'

test('suite honesty leaves out the titles of playwright.ungradedTitles, as the check does', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-qp-'))
  mkdirSync(join(d, 'e2e'))
  writeFileSync(join(d, 'e2e/a.spec.ts'), "test('ABC-1 shows', async () => { await expect(p).toBeVisible() })\ntest('ABC-1 — design-conformance capture', async () => { await shot() })\n")
  const cfg = { adapter: 'playwright', jira: { projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
  assert.deepEqual([scanSpecs(d, cfg).tests, scanSpecs(d, cfg).honest], [2, 1])
  const off = { ...cfg, playwright: { folder: 'e2e/', ungradedTitles: 'capture' } }
  assert.deepEqual([scanSpecs(d, off).tests, scanSpecs(d, off).honest], [1, 1])
})
