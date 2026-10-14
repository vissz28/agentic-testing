import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStrykerReport, projectStrykerConfig, runStryker, strykerConfigSource } from '../../core/runners/stryker.mjs'
import { calls, fakeBin } from './fake-bin.mjs'

const proj = () => mkdtempSync(join(tmpdir(), 'qc-stryker-run-'))
const report = (...statuses) => ({
  schemaVersion: '1',
  files: { 'src/a.ts': { language: 'typescript', source: '', mutants: statuses.map((status, i) => ({ id: String(i), mutatorName: 'm', status })) } },
})
// The report path sits next to the temp config file Stryker is given (argv[1]).
const outOf = argv => join(dirname(argv[1]), 'mutation.json')

test('parseStrykerReport: counts per status, score over killed, survived, timeout and no coverage', () => {
  const r = parseStrykerReport(report('Killed', 'Killed', 'Killed', 'Survived', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Pending'))
  assert.deepEqual(r, { killed: 3, survived: 1, timeout: 1, noCoverage: 1, score: 50 })
  assert.equal(parseStrykerReport(report('Killed', 'Killed', 'Survived')).score, 66.7)
})
test('parseStrykerReport: mutants across files add up', () => {
  const json = { files: { 'a.ts': { mutants: [{ status: 'Killed' }] }, 'b.ts': { mutants: [{ status: 'Survived' }, { status: 'Killed' }, { status: 'Killed' }] } } }
  assert.deepEqual(parseStrykerReport(json), { killed: 3, survived: 1, timeout: 0, noCoverage: 0, score: 75 })
})
test('parseStrykerReport: zero counted mutants gives a null score', () => {
  const zero = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, score: null }
  assert.deepEqual(parseStrykerReport(report()), zero)
  assert.deepEqual(parseStrykerReport(report('CompileError', 'Ignored')), zero)
  assert.deepEqual(parseStrykerReport({}), zero)
  assert.deepEqual(parseStrykerReport(null), zero)
})
test('runner: argv, cwd, score read from the report, temp dir removed, nothing written in the project', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { report: report('Killed', 'Survived', 'Killed', 'NoCoverage') })
  const before = readdirSync(d).sort()
  const r = await runStryker(d, { target: 'src/my a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 })
  assert.deepEqual(r, { ran: true, killed: 2, survived: 1, timeout: 0, noCoverage: 1, score: 50 })
  const [argv] = calls(d, 'stryker')
  const out = outOf(argv)
  const tmp = dirname(out)
  assert.ok(!out.startsWith(d))
  assert.equal(out, join(tmp, 'mutation.json'))
  assert.deepEqual(argv, ['run', join(tmp, 'stryker.config.mjs'), '--mutate', 'src/my a.ts', '--testRunner', 'vitest', '--reporters', 'json', '--concurrency', '2'])
  assert.equal(existsSync(tmp), false)
  assert.deepEqual(readdirSync(d).sort(), before.concat(['.fake-stryker.calls']).sort())
})
// Stryker has no command-line option for the JSON report file: the runner hands it a temp config
// module that keeps the project's own config and only sets jsonReporter.fileName.
const loadConfig = async (root, out) => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-cfg-'))
  const f = join(dir, 'stryker.config.mjs')
  writeFileSync(f, strykerConfigSource(root, out))
  return (await import(pathToFileURL(f).href)).default
}
test('config: the run adds the specs under test and an in-project sandbox Stryker always cleans', async () => {
  const d = proj()
  const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-cfg-'))
  const f = join(dir, 'stryker.config.mjs')
  writeFileSync(join(d, 'stryker.config.json'), JSON.stringify({ testFiles: ['test/**'], concurrency: 4 }))
  writeFileSync(f, strykerConfigSource(d, '/o.json', { testFiles: ['test/a.spec.ts'], tempDirName: '.stryker-tmp-qc-ab12' }))
  assert.deepEqual((await import(pathToFileURL(f).href)).default,
    { testFiles: ['test/a.spec.ts'], concurrency: 4, tempDirName: '.stryker-tmp-qc-ab12', cleanTempDir: 'always', jsonReporter: { fileName: '/o.json' } })
})
test('runner: no spec files is not a run', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { report: report('Killed') })
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: [], timeoutMs: 10000 }), { ran: false, error: 'no spec files to run' })
  assert.equal(existsSync(join(d, '.fake-stryker.calls')), false)
})
test('runner: the in-project sandbox is removed after a pass and after a timeout', async () => {
  for (const spec of [{ report: report('Killed'), mkdir: true }, { sleepMs: 5000, mkdir: true }]) {
    const d = proj()
    fakeBin(d, 'stryker', spec)
    await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: spec.sleepMs ? 300 : 10000 })
    assert.deepEqual(readdirSync(d).filter(n => n.startsWith('.stryker-tmp-qc-')), [])
  }
})
test('config: no project config gives only the report file', async () => {
  const d = proj()
  assert.equal(projectStrykerConfig(d), null)
  assert.deepEqual(await loadConfig(d, '/tmp/x/mutation.json'), { jsonReporter: { fileName: '/tmp/x/mutation.json' } })
})
test('config: the project JSON config is kept, its report file replaced', async () => {
  const d = proj()
  writeFileSync(join(d, 'stryker.config.json'), JSON.stringify({ vitest: { related: false }, jsonReporter: { fileName: 'reports/x.json', extra: 1 } }))
  assert.equal(projectStrykerConfig(d), join(d, 'stryker.config.json'))
  assert.deepEqual(await loadConfig(d, '/tmp/"q"/mutation.json'), { vitest: { related: false }, jsonReporter: { fileName: '/tmp/"q"/mutation.json', extra: 1 } })
})
test('config: a JS config is imported, and Stryker\'s own name order picks the first', async () => {
  const d = proj()
  writeFileSync(join(d, 'stryker.config.mjs'), "export default { concurrency: 4, mutate: ['src/**'] }\n")
  writeFileSync(join(d, '.stryker.conf.json'), '{"concurrency": 9}')
  assert.equal(projectStrykerConfig(d), join(d, 'stryker.config.mjs'))
  assert.deepEqual(await loadConfig(d, '/o.json'), { concurrency: 4, mutate: ['src/**'], jsonReporter: { fileName: '/o.json' } })
  const c = proj()
  writeFileSync(join(c, 'stryker.conf.cjs'), 'module.exports = { timeoutMS: 7 }\n')
  assert.deepEqual(await loadConfig(c, '/o.json'), { timeoutMS: 7, jsonReporter: { fileName: '/o.json' } })
})
test('runner: zero mutants → ran with a null score', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { report: report() })
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: true, killed: 0, survived: 0, timeout: 0, noCoverage: 0, score: null })
})
test('runner: a non-zero exit with a report is still read', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { exit: 1, report: report('Survived') })
  const r = await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 })
  assert.equal(r.ran, true)
  assert.equal(r.score, 0)
})
test('runner: missing binary', async () => {
  assert.deepEqual(await runStryker(proj(), { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: false, error: 'Stryker is not installed' })
})
test('runner: no report → the first stderr line, else a plain message; temp dir removed', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { exit: 1, stderr: '\n  \nError: No tests were found\n  at x' })
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: false, error: 'Error: No tests were found' })
  assert.equal(existsSync(dirname(outOf(calls(d, 'stryker')[0]))), false)
  const q = proj()
  fakeBin(q, 'stryker', { exit: 1 })
  assert.deepEqual(await runStryker(q, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: false, error: 'Stryker wrote no report' })
})
test('runner: timeout → ran false, temp dir removed', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { sleepMs: 5000, report: report('Killed') })
  // Its own TMPDIR: the fake may be killed before it records its call, so the temp folder is checked directly.
  const tmp = mkdtempSync(join(tmpdir(), 'qc-stryker-tmpdir-'))
  const saved = process.env.TMPDIR
  process.env.TMPDIR = tmp
  let r
  try { r = await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 300 }) } finally { process.env.TMPDIR = saved }
  assert.deepEqual(r, { ran: false, error: 'took longer than 300ms' })
  assert.deepEqual(readdirSync(tmp), [])
  const s = proj()
  fakeBin(s, 'stryker', { sleepMs: 5000, report: report('Killed') })
  assert.equal((await runStryker(s, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 1500 })).error, 'took longer than 2s')
})
test('runner: a report that cannot be read leaks no temp dir and does not crash', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { report: { files: { 'a.ts': { mutants: 5 } } } })
  const r = await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 })
  assert.equal(r.ran, false)
  assert.match(r.error, /could not read the Stryker report/)
  assert.equal(existsSync(dirname(outOf(calls(d, 'stryker')[0]))), false)
})
test('runner: a spawn that throws gives ran false and leaks no temp dir', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { report: report() })
  const own = mkdtempSync(join(tmpdir(), 'qc-own-'))
  const prev = process.env.TMPDIR
  process.env.TMPDIR = own
  try {
    const r = await runStryker(d, { target: 'src/a\0.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 })
    assert.equal(r.ran, false)
    assert.match(r.error, /could not start Stryker/)
    assert.deepEqual(readdirSync(own), [])
  } finally {
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev
  }
})
