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
