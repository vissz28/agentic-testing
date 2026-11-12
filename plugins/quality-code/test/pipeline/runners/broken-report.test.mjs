// A runner that leaves a report that is not valid JSON (cut off, overwritten) says so. Before, it said
// "wrote no report", which sent the reader looking for the wrong problem. The runner's own first stderr line
// still comes first when there is one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vitestRunner } from '../../../lib/pipeline/runners/vitest.mjs'
import { playwrightRunner } from '../../../lib/pipeline/runners/playwright.mjs'
import { runStryker } from '../../../lib/pipeline/runners/stryker.mjs'
import { runGeneric } from '../../../lib/pipeline/runners/generic.mjs'
import { fakeBin } from '../../fake-bin.mjs'

const proj = () => realpathSync(mkdtempSync(join(tmpdir(), 'qc-broken-report-')))
const BROKEN = '{"testResults": ['

test('Vitest: a broken report is named as one; with stderr, its first line as before', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { exit: 1, rawReport: BROKEN })
  assert.deepEqual(await vitestRunner(d, { adapter: 'vitest', jira: { projects: ['ABC'] } })({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Vitest wrote a report that is not valid JSON' })
  fakeBin(d, 'vitest', { exit: 1, rawReport: BROKEN, stderr: '\nError: heap out of memory\n' })
  assert.equal((await vitestRunner(d, { adapter: 'vitest', jira: { projects: ['ABC'] } })({ files: ['a.spec.ts'] })).error, 'Error: heap out of memory')
})

test('Playwright: a broken report is named as one', async () => {
  const d = proj()
  fakeBin(d, 'playwright', { exit: 1, rawReport: BROKEN })
  assert.deepEqual(await playwrightRunner(d, { adapter: 'playwright', jira: { projects: ['ABC'] } })({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Playwright wrote a report that is not valid JSON' })
})

test('Stryker: a broken report is named as one', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { exit: 1, rawReport: BROKEN })
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: false, error: 'Stryker wrote a report that is not valid JSON' })
})

test('Jest (generic runner): a broken report is named as one', async () => {
  const d = proj()
  fakeBin(d, 'jest', { exit: 1, rawReport: BROKEN })
  const r = await runGeneric(d, 'jest', ['test/a.spec.js'], { timeoutMs: 20000 })
  assert.equal(r.ran, false)
  assert.match(r.error, /^Jest wrote a report that is not valid JSON$/)
})
