import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configFor, parseReport, titlePattern, vitestRunner } from '../../../lib/pipeline/runners/vitest.mjs'
import { calls, fakeBin } from '../../fake-bin.mjs'

// The describe path each result carries is checked on its own (below); these compare the rest.
const bare = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'path' ? undefined : v)))

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
  assert.deepEqual(bare(r.tests), [
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
  assert.deepEqual(bare(r), { ran: true, tests: [{ title: 'ok', file: 'test/my a.spec.ts', status: 'passed', message: '' }], broken: [] })
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
  assert.deepEqual(await vitestRunner(proj(), cfg())({ files: ['a.spec.ts'] }), { ran: false, tests: [], error: 'Vitest is not installed in this project' })
  const s = proj()
  fakeBin(s, 'vitest', { sleepMs: 5000, report: report(s, []) })
  const r = await vitestRunner(s, cfg())({ files: ['a.spec.ts'], timeoutMs: 300 })
  assert.equal(r.ran, false)
  assert.match(r.error, /took longer than/)
})
test('runner: a Vitest hoisted to a parent node_modules (a monorepo package) is found and run with this Node', async () => {
  const mono = proj()
  const d = join(mono, 'packages/api')
  mkdirSync(d, { recursive: true })
  fakeBin(mono, 'vitest', { report: report(d, [{ file: 'a.spec.ts', tests: [t('ok', 'passed')] }]) })
  copyFileSync(join(mono, '.fake-vitest.json'), join(d, '.fake-vitest.json'))
  const r = await vitestRunner(d, cfg())({ files: ['a.spec.ts'] })
  assert.equal(r.ran, true, r.error)
  assert.deepEqual(r.tests.map(x => x.title), ['ok'])
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
  const r = await vitestRunner(d, cfg({ timeoutSeconds: 0.2 }))({ files: ['a.spec.ts'], timeoutMs: undefined })
  assert.equal(r.ran, false)
  assert.equal(r.error, 'took longer than 200ms')
})
test('runner: a timeout kills the whole process group, grandchildren included', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { grandchild: true, sleepMs: 5000, report: report(d, []) })
  const pidFile = join(d, '.fake-vitest.grandchild')
  let pid
  try {
    const r = await vitestRunner(d, cfg())({ files: ['a.spec.ts'], timeoutMs: 800 })
    assert.equal(r.ran, false)
    assert.match(r.error, /took longer than/)
    pid = Number(readFileSync(pidFile, 'utf8'))
    await new Promise(res => setTimeout(res, 800))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    try { if (pid) process.kill(pid, 'SIGKILL') } catch {}
  }
})
test('runner: a report that cannot be read leaks no temp dir and does not crash', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { report: { testResults: [null] } })
  const r = await vitestRunner(d, cfg())({ files: ['a.spec.ts'] })
  assert.equal(r.ran, false)
  assert.match(r.error, /could not read the Vitest report/)
  const out = calls(d, 'vitest')[0].find(a => a.startsWith('--outputFile=')).slice(13)
  assert.equal(existsSync(dirname(out)), false)
})
test('runner: a spawn that throws gives ran false and leaks no temp dir', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { report: report(d, []) })
  const own = mkdtempSync(join(tmpdir(), 'qc-own-'))
  const prev = process.env.TMPDIR
  process.env.TMPDIR = own
  try {
    const r = await vitestRunner(d, cfg())({ files: ['a\0b.spec.ts'] })
    assert.equal(r.ran, false)
    assert.match(r.error, /could not start Vitest/)
    assert.deepEqual(readdirSync(own), [])
  } finally {
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev
  }
})
test('timeout message uses milliseconds below one second', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { sleepMs: 3000, report: report(d, []) })
  const r = await vitestRunner(d, cfg())({ files: ['a.spec.ts'], timeoutMs: 300 })
  assert.equal(r.error, 'took longer than 300ms')
})
test('parseReport: a failed file whose tests did not fail (beforeAll error) is also broken, keeping its tests', () => {
  const d = '/p'
  const r = parseReport(report(d, [{ file: 'a.spec.ts', status: 'failed', message: 'beforeAll blew up\n at x', tests: [t('x', 'skipped')] }]), d)
  assert.deepEqual(bare(r.tests), [{ title: 'x', file: 'a.spec.ts', status: 'skipped', message: '' }])
  assert.deepEqual(r.broken, [{ file: 'a.spec.ts', message: 'beforeAll blew up' }])
  const ok = parseReport(report(d, [{ file: 'a.spec.ts', status: 'failed', message: 'm', tests: [t('x', 'failed', ['e'])] }]), d)
  assert.deepEqual(ok.broken, [])
})
test('configFor: an exact-match entry still applies to the spec\'s mutant temp file', () => {
  const c = cfg({ configs: [{ match: 'test/orders.int.test.ts', config: 'db.ts' }] })
  assert.equal(configFor('test/orders.int.test.ts', c), 'db.ts')
  assert.equal(configFor('test/mut-tmp-123-abc-def-orders.int.test.ts', c), 'db.ts')
  assert.equal(configFor('test/mut-tmp-123-abc-def-other.test.ts', c), null)
})
test('runner: only the requested files count; a substring match elsewhere is dropped', async () => {
  const d = proj()
  fakeBin(d, 'vitest', { report: report(d, [
    { file: 'test/a.test.ts', tests: [t('mine', 'passed')] },
    { file: 'test/sub/test/a.test.ts', status: 'failed', message: 'boom', tests: [t('other', 'failed', ['x'])] },
    { file: 'test/sub/test/b.test.ts', status: 'failed', message: 'broken' },
  ]) })
  const r = await vitestRunner(d, cfg())({ files: ['./test/a.test.ts'] })
  assert.deepEqual(r.tests.map(x => x.title), ['mine'])
  assert.deepEqual(r.broken, [])
})
test('runner: a symlinked project root still gives root-relative file names', async () => {
  const real = realpathSync(proj())
  const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'qc-link-'))), 'p')
  symlinkSync(real, link)
  mkdirSync(join(real, 'test'))
  fakeBin(real, 'vitest', { report: report(real, [{ file: 'test/a.test.ts', tests: [t('ok', 'passed')] }]) })
  const r = await vitestRunner(link, cfg())({ files: ['test/a.test.ts'] })
  assert.deepEqual(r.tests.map(x => x.file), ['test/a.test.ts'])
})

test('parseReport: each result keeps its describe titles, outermost first', () => {
  const r = parseReport({ testResults: [{ name: '/p/a.spec.ts', status: 'passed', assertionResults: [
    { title: 'adds', ancestorTitles: ['ABC-1 Pricing', 'totals'], status: 'passed' },
    { title: 'loose', status: 'passed' },
  ] }] }, '/p')
  assert.deepEqual(r.tests.map(t => t.path), [['ABC-1 Pricing', 'totals'], []])
})
