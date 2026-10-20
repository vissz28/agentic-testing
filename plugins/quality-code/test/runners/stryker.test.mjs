import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { linkedFolders, parseStrykerReport, projectStrykerConfig, runStryker, strykerConfigSource, vitestConfigSource } from '../../core/runners/stryker.mjs'
import { execFileSync } from 'node:child_process'
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
  assert.deepEqual(r, { killed: 3, survived: 1, timeout: 1, noCoverage: 1, untested: 0, score: 66.7 }, 'a timeout is caught, as in Stryker\'s own score')
  assert.equal(parseStrykerReport(report('Killed', 'Killed', 'Survived')).score, 66.7)
})
test('parseStrykerReport: mutants across files add up', () => {
  const json = { files: { 'a.ts': { mutants: [{ status: 'Killed' }] }, 'b.ts': { mutants: [{ status: 'Survived' }, { status: 'Killed' }, { status: 'Killed' }] } } }
  assert.deepEqual(parseStrykerReport(json), { killed: 3, survived: 1, timeout: 0, noCoverage: 0, untested: 0, score: 75 })
})
test('parseStrykerReport: zero counted mutants gives a null score', () => {
  const zero = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, untested: 0, score: null }
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
  assert.deepEqual(r, { ran: true, killed: 2, survived: 1, timeout: 0, noCoverage: 1, untested: 0, score: 50 })
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
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: true, killed: 0, survived: 0, timeout: 0, noCoverage: 0, untested: 0, score: null })
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
  try { r = await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 300 }) } finally {
    // Unset on Linux: assigning undefined would set the string "undefined".
    if (saved === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = saved
  }
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

test('config: the specs\' Vitest config and the folders to leave out of the sandbox; the team\'s own config wins', async () => {
  const d = proj()
  const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-cfg-'))
  const f = join(dir, 'stryker.config.mjs')
  writeFileSync(join(d, 'stryker.config.json'), JSON.stringify({ ignorePatterns: ['/media'] }))
  writeFileSync(f, strykerConfigSource(d, '/o.json', { vitestConfig: 'vitest.config.db.ts', ignore: ['/.claude/skills/x'] }))
  assert.deepEqual((await import(pathToFileURL(f).href)).default, { vitest: { configFile: 'vitest.config.db.ts' }, ignorePatterns: ['/media', '/.claude/skills/x'], jsonReporter: { fileName: '/o.json' } })
  const g = join(dir, 'own.mjs')
  writeFileSync(join(d, 'stryker.config.json'), JSON.stringify({ vitest: { configFile: 'vitest.mine.ts' } }))
  writeFileSync(g, strykerConfigSource(d, '/o.json', { vitestConfig: 'vitest.config.db.ts' }))
  assert.deepEqual((await import(pathToFileURL(g).href)).default.vitest, { configFile: 'vitest.mine.ts' })
})
test('linkedFolders: the tracked symlinks to folders, not to files, not untracked ones', () => {
  const d = proj()
  execFileSync('git', ['init', '-q'], { cwd: d })
  mkdirSync(join(d, 'real'))
  writeFileSync(join(d, 'file.txt'), 'x')
  symlinkSync('real', join(d, 'dirlink'))
  symlinkSync('file.txt', join(d, 'filelink'))
  execFileSync('git', ['add', 'dirlink', 'filelink', 'file.txt'], { cwd: d })
  symlinkSync('real', join(d, 'untracked'))
  assert.deepEqual(linkedFolders(d), ['/dirlink'])
  assert.deepEqual(linkedFolders(proj()), [])
})
test('runner: no report → the line that names the error, not Node\'s stack frame', async () => {
  const d = proj()
  fakeBin(d, 'stryker', { exit: 1, stderr: 'node:internal/process/promises:394\n    triggerUncaughtException(err, true)\n\nError: ENOTSUP: operation not supported on socket, copyfile \'a\' -> \'b\'\n  at x' })
  assert.deepEqual(await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000 }), { ran: false, error: "Error: ENOTSUP: operation not supported on socket, copyfile 'a' -> 'b'" })
})

test('parseStrykerReport: a survivor no test ran against is untested', () => {
  const json = { files: { 'a.ts': { mutants: [{ status: 'Survived', testsCompleted: 0 }, { status: 'Survived', testsCompleted: 2 }, { status: 'Survived' }] } } }
  assert.equal(parseStrykerReport(json).untested, 1)
})
test('vitestConfigSource: the specs\' config with only the specs, the key as a name filter; a function config is called', () => {
  assert.equal(vitestConfigSource('vitest.config.db.ts', ['test/a.spec.ts'], 'ABC-1.2'),
    'import own from "./vitest.config.db.ts"\nconst scoped = base => ({ ...base, test: { ...base.test, include: ["test/a.spec.ts"], testNamePattern: "ABC-1\\\\.2" } })\nexport default typeof own === \'function\' ? env => Promise.resolve(own(env)).then(scoped) : scoped(own)\n')
  assert.equal(vitestConfigSource(null, ['t.spec.ts'], null), 'export default { test: { include: ["t.spec.ts"] } }\n')
})
test('runner: Stryker runs a scoped Vitest config next to the project\'s, removed afterwards', async () => {
  const d = proj()
  writeFileSync(join(d, 'vitest.config.ts'), 'export default {}\n')
  fakeBin(d, 'stryker', { report: report('Killed') })
  const r = await runStryker(d, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000, key: 'ABC-1' })
  assert.equal(r.ran, true)
  assert.deepEqual(readdirSync(d).filter(n => n.startsWith('mut-tmp-')), [], 'the scoped config is removed')
  const d2 = proj()
  fakeBin(d2, 'stryker', { report: report('Killed') })
  await runStryker(d2, { target: 'src/a.ts', specs: ['test/a.spec.ts'], timeoutMs: 10000, vitestConfig: 'vitest.config.db.ts' })
  assert.deepEqual(readdirSync(d2).filter(n => n.startsWith('mut-tmp-')), [])
})
