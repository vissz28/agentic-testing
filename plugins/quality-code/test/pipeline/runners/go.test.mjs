// The Go runner: the go test -json stream read into results (fixtures in the real format, as go
// 1.22 and 1.24 print them), and the runner itself with a fake go first on the PATH.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collect, commandFor, compileError, failureLine, goRunner, indexSpecs, parseEvents, results, runPattern } from '../../../lib/pipeline/runners/go.mjs'
import { fakeCommand } from '../../fake-bin.mjs'
import { REORDER } from './go-fixtures/reorder.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(HERE, 'go-fixtures', name), 'utf8')
const SPEC = 'orders/reorder_test.go'


const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
function project(files = { [SPEC]: REORDER }) {
  const d = mkdtempSync(join(tmpdir(), 'qc-go-'))
  put(d, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
  for (const [p, s] of Object.entries(files)) put(d, p, s)
  return d
}
const pkgsOf = d => indexSpecs(d, [SPEC]).pkgs

test('parseEvents reads the JSON lines and leaves the rest out', () => {
  const ev = parseEvents(`# a build line\n${fixture('green.jsonl')}not json {\n`)
  assert.equal(ev.length, fixture('green.jsonl').trim().split('\n').length)
  assert.equal(ev[0].Action, 'start')
})

test('index: the package, its import path and the scenarios of each function', () => {
  const d = project()
  const [p] = pkgsOf(d)
  assert.equal(p.importPath, 'example.com/demo/orders')
  assert.equal(p.pattern, './orders')
  assert.equal(p.cwd, d)
  assert.deepEqual([...p.funcs.keys()], ['TestReorder', 'TestTable'])
  assert.equal(p.funcs.get('TestReorder').group, 'ABC-12 Reorder below the threshold')
  assert.equal(p.funcs.get('TestTable').group, 'TestTable')
  assert.deepEqual([...p.funcs.get('TestReorder').literal], [['stock_of_4_reorders', 'stock of 4 reorders'], ['stock_of_5_does_not', 'stock of 5 does not'], ['later', 'later']])
  assert.equal(p.funcs.get('TestTable').literal.size, 0)
  assert.match(indexSpecs(mkdtempSync(join(tmpdir(), 'qc-go-none-')), ['a/x_test.go']).error, /no go.mod above a/)
})

test('runPattern: every requested function, one function, or one literal scenario', () => {
  const pkgs = pkgsOf(project())
  assert.equal(runPattern(pkgs), '^(TestReorder|TestTable)$')
  assert.equal(runPattern(pkgs, 'TestTable'), '^TestTable$')
  assert.equal(runPattern(pkgs, 'stock of 4 reorders'), '^(TestReorder)$/^stock_of_4_reorders$')
  assert.equal(runPattern(pkgs, 'nothing like it'), null)
})

test('green: one result per literal scenario, the table test as one, the todo skipped', () => {
  const r = results(parseEvents(fixture('green.jsonl')), pkgsOf(project()))
  assert.deepEqual(r.broken, [])
  assert.deepEqual(r.tests.map(t => [t.title, t.status]), [
    ['stock of 4 reorders', 'passed'], ['stock of 5 does not', 'passed'], ['later', 'skipped'], ['TestTable', 'passed'],
  ])
  assert.deepEqual(r.tests[0].path, ['ABC-12 Reorder below the threshold'])
  assert.deepEqual(r.tests[3].path, ['TestTable'])
  assert.ok(r.tests.every(t => t.file === SPEC && t.message === ''))
})

test('red: the failing line is the message; testify\'s expected and actual come with it', () => {
  const r = results(parseEvents(fixture('red.jsonl')), pkgsOf(project()))
  const by = Object.fromEntries(r.tests.map(t => [t.title, t]))
  assert.equal(by['stock of 4 reorders'].status, 'failed')
  assert.equal(by['stock of 4 reorders'].message, 'reorder_test.go:14: Not equal: expected: 20 actual : 19')
  assert.equal(by['stock of 5 does not'].message, 'reorder_test.go:21: Reorder(5) = 3, want 0')
  assert.equal(by.later.status, 'skipped')
  // A failing table case fails its function, with the case's line.
  assert.equal(by.TestTable.status, 'failed')
  assert.equal(by.TestTable.message, 'reorder_test.go:38: not ok for -1')
  assert.deepEqual(r.broken, [])
})

test('panic: the test fails with the panic line, not the stack', () => {
  const r = results(parseEvents(fixture('panic.jsonl')), pkgsOf(project()))
  assert.deepEqual(r.tests.map(t => [t.title, t.status, t.message]), [['TestTable', 'failed', 'panic: runtime error: index out of range [3] with length 3']])
  assert.deepEqual(r.broken, [])
})

test('build failure: every requested spec of the package is broken with the first compiler error', () => {
  const pkgs = pkgsOf(project())
  const old = results(parseEvents(fixture('build-old.jsonl')), pkgs, fixture('build-old.stderr'))
  assert.deepEqual(old, { tests: [], broken: [{ file: SPEC, message: 'orders/reorder_test.go:12:9: undefined: Reordr' }] })
  const now = results(parseEvents(fixture('build-new.jsonl')), pkgs, '')
  assert.deepEqual(now, { tests: [], broken: [{ file: SPEC, message: 'orders/reorder_test.go:12:9: undefined: Reordr' }] })
  assert.equal(collect(parseEvents(fixture('build-new.jsonl'))).pkgs.get('example.com/demo/orders').failedBuild, 'example.com/demo/orders')
})

test('a package that fails with no failing test is broken (TestMain, a timeout)', () => {
  const ev = [
    { Action: 'start', Package: 'example.com/demo/orders' },
    { Action: 'run', Package: 'example.com/demo/orders', Test: 'TestTable' },
    { Action: 'pass', Package: 'example.com/demo/orders', Test: 'TestTable' },
    { Action: 'output', Package: 'example.com/demo/orders', Output: 'panic: test timed out after 10m0s\n' },
    { Action: 'fail', Package: 'example.com/demo/orders' },
  ]
  const r = results(ev, pkgsOf(project()))
  assert.deepEqual(r.broken, [{ file: SPEC, message: 'panic: test timed out after 10m0s' }])
})

test('another file\'s tests in the same package are not this run\'s', () => {
  const d = project({ [SPEC]: REORDER, 'orders/other_test.go': 'package orders\n\nimport "testing"\n\nfunc TestOther(t *testing.T) {}\n' })
  const ev = [...parseEvents(fixture('green.jsonl')), { Action: 'pass', Package: 'example.com/demo/orders', Test: 'TestOther' }]
  assert.ok(!results(ev, pkgsOf(d)).tests.some(t => t.title === 'TestOther'))
})

test('helpers: failureLine and compileError', () => {
  assert.equal(failureLine(['=== RUN   TestX\n', '--- FAIL: TestX (0.00s)\n', 'something broke\n']), 'something broke')
  assert.equal(compileError(['# example.com/demo\n', 'vet: ./a_test.go:3:2: unreachable code\n']), 'vet: ./a_test.go:3:2: unreachable code')
  assert.equal(compileError(['# example.com/demo\n', './a_test.go:3:2: undefined: x\n']), './a_test.go:3:2: undefined: x')
})

test('commandFor: go test -json by default; go.command with or without placeholders', () => {
  assert.deepEqual(commandFor({ adapter: 'go' }, ['./orders'], '^(TestA)$', '/tmp/r'), { file: 'go', args: ['test', '-json', '-count=1', '-run', '^(TestA)$', './orders'], shell: false })
  const plain = commandFor({ adapter: 'go', go: { command: 'go test -tags=integration' } }, ['./orders'], '^(TestA)$', '/tmp/r')
  assert.equal(plain.line, "go test -tags=integration '-json' '-count=1' '-run' '^(TestA)$' './orders'")
  const slots = commandFor({ adapter: 'go', go: { command: 'make gotest PKGS={files} RUN={test} OUT={report}' } }, ['./a', './b'], '^T$', '/tmp/r.jsonl')
  assert.equal(slots.line, "make gotest PKGS='./a' './b' RUN='^T$' OUT='/tmp/r.jsonl'")
  assert.equal(slots.report, true)
})

// A fake go: a node script behind a sh shim. It logs its argv and cwd and prints the stream that
// .fake-go.json maps to the first matching -run pattern (by substring), else "default".
function fakeGo(d, behaviour) {
  const script = join(d, '.fake-go.cjs')
  writeFileSync(join(d, '.fake-go.json'), JSON.stringify(behaviour))
  writeFileSync(script, `const fs = require('fs'), path = require('path')
const spec = JSON.parse(fs.readFileSync(${JSON.stringify(join(d, '.fake-go.json'))}, 'utf8'))
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(d, '.fake-go.calls'))}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n')
const run = args[args.indexOf('-run') + 1] || ''
const key = Object.keys(spec.streams || {}).find(k => k !== 'default' && run.includes(k)) || 'default'
setTimeout(() => {
  if (spec.streams) process.stdout.write(spec.streams[key] || '')
  if (spec.stderr) process.stderr.write(spec.stderr)
  process.exit(spec.exit ?? 0)
}, spec.sleepMs ?? 0)
`)
  const cmd = fakeCommand('go')
  cmd.act(`exec "${process.execPath}" "${script}" "$@"`)
  return cmd
}
const calls = d => readFileSync(join(d, '.fake-go.calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('runner: go test -json on the spec\'s package, from the module root; results read from stdout', async () => {
  const d = project()
  const go = fakeGo(d, { streams: { default: fixture('green.jsonl') } })
  try {
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC] })
    assert.equal(r.ran, true)
    assert.equal(r.tests.length, 4)
    const [c] = calls(d)
    assert.equal(c.cwd, (await import('node:fs')).realpathSync(d))
    assert.deepEqual(c.args, ['test', '-json', '-count=1', '-run', '^(TestReorder|TestTable)$', './orders'])
    assert.deepEqual(readdirSync(join(d, 'orders')), ['reorder_test.go'], 'nothing written into the project')
  } finally { go.restore() }
})

test('runner: one scenario by its title, as mutation asks for it', async () => {
  const d = project()
  const go = fakeGo(d, { streams: { default: fixture('green.jsonl') } })
  try {
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC], testName: 'stock of 5 does not' })
    assert.equal(calls(d)[0].args.at(-2), '^(TestReorder)$/^stock_of_5_does_not$')
    assert.ok(r.tests.some(t => t.title === 'stock of 5 does not' && t.status === 'passed'))
    // A title no spec holds runs nothing.
    const none = await goRunner(d, { adapter: 'go' })({ files: [SPEC], testName: 'no such scenario' })
    assert.deepEqual(none, { ran: true, tests: [], broken: [] })
    assert.equal(calls(d).length, 1)
  } finally { go.restore() }
})

test('runner: a build failure leaves the spec broken with the compiler line from stderr', async () => {
  const d = project()
  const go = fakeGo(d, { streams: { default: fixture('build-old.jsonl') }, stderr: fixture('build-old.stderr'), exit: 1 })
  try {
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC] })
    assert.deepEqual(r, { ran: true, tests: [], broken: [{ file: SPEC, message: 'orders/reorder_test.go:12:9: undefined: Reordr' }] })
  } finally { go.restore() }
})

test('runner: go stops before any package: not run, with its error', async () => {
  const d = project()
  const go = fakeGo(d, { stderr: 'go: errors parsing go.mod:\ngo.mod:3: invalid go version\n', exit: 1 })
  try {
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC] })
    assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'go: errors parsing go.mod:' })
  } finally { go.restore() }
})

test('runner: no go on the PATH is not run, never a pass', async () => {
  const d = project()
  const before = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'qc-empty-path-'))
  try {
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC] })
    assert.equal(r.ran, false)
    assert.match(r.error, /Go is not installed/)
  } finally { process.env.PATH = before }
})

test('runner: a run past the timeout is killed and not run', async () => {
  const d = project()
  const go = fakeGo(d, { streams: { default: fixture('green.jsonl') }, sleepMs: 5000 })
  try {
    const t0 = Date.now()
    const r = await goRunner(d, { adapter: 'go' })({ files: [SPEC], timeoutMs: 300 })
    assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'took longer than 300ms' })
    assert.ok(Date.now() - t0 < 4000)
  } finally { go.restore() }
})

test('runner: go.command with {report} is read from the report file, which goes to a temp folder', async () => {
  const d = project()
  const go = fakeGo(d, { streams: { default: '' } })
  const stream = join(d, '.stream.jsonl')
  writeFileSync(stream, fixture('green.jsonl'))
  try {
    const config = { adapter: 'go', go: { command: `go test {files} -run {test} && cp ${stream} {report}` } }
    const r = await goRunner(d, config)({ files: [SPEC] })
    assert.equal(r.ran, true)
    assert.equal(r.tests.length, 4)
    assert.deepEqual(calls(d)[0].args, ['test', './orders', '-run', '^(TestReorder|TestTable)$'])
    assert.ok(!existsSync(join(d, 'report.jsonl')))
  } finally { go.restore() }
})
