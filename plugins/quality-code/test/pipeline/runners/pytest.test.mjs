// The pytest runner: its JUnit XML reader, the command it builds, a fake Python, and (when this machine
// has Python with pytest) a real run on a tiny project in a temp folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { baseName, decodeEntities, fillTemplate, nodeIds, parseReport, parseXml, pytestRunner, resolveClassname, splitCommand, typeCheck } from '../../../lib/pipeline/runners/pytest.mjs'
import { fakeCommand } from '../../fake-bin.mjs'

const put = (d, p, s, mode) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s, mode ? { mode } : undefined) }
const project = files => {
  const d = mkdtempSync(join(tmpdir(), 'qc-pytest-'))
  for (const [p, s] of Object.entries(files)) put(d, p, s)
  return d
}

// ---- The report reader ----

const REPORT = `<?xml version="1.0" encoding="utf-8"?>
<!-- a comment <testcase name="no"/> -->
<testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="1" skipped="2" tests="7">
<testcase classname="" name="tests.test_broken" time="0.000"><error message="collection failure">ImportError while importing test module
tests/test_broken.py:1: in &lt;module&gt;
    import nope
E   ModuleNotFoundError: No module named 'nope'</error></testcase>
<testcase classname="tests.test_order.TestTotal" name="test_sum" time="0.001" />
<testcase classname="tests.test_order.TestTotal" name="test_cases[1-4.5]" time="0.001"/>
<testcase classname="tests.test_order.TestTotal" name="test_text" time="0.001"><failure message="AssertionError: assert 'a&lt;b&gt;&amp;c' == &quot;x&quot;&#10; +  where 1 = f()"><![CDATA[def test_text(self):
>       assert f() == "x"
E       AssertionError]]></failure></testcase>
<testcase classname="tests.test_order.TestTotal" name="test_skip"><skipped type="pytest.skip" message="ABC-9 later">tests/test_order.py:9: ABC-9 later</skipped></testcase>
<testcase classname="tests.test_order.TestTotal" name="test_xf"><skipped type="pytest.xfail" message="" /></testcase>
<testcase classname="tests.test_order.TestTotal.TestNested" name="test_inner"><error message="failed on setup with &quot;fixture 'db' not found&quot;">x</error></testcase>
<testcase classname="tests.test_order" name="test_top" time="0.001" />
</testsuite></testsuites>`

test('the XML reader: elements, attributes with ">" in quotes, entities, CDATA, comments and the declaration skipped', () => {
  const root = parseXml('<?xml version="1.0"?><!DOCTYPE x><a k="1 &gt; 0" j=\'q&apos;s\'><b/><c>t&#x41;&#66;<![CDATA[<raw> &amp;]]></c><!-- <d/> --></a>')
  assert.equal(root.name, 'a')
  assert.deepEqual(root.attrs, { k: '1 > 0', j: "q's" })
  assert.deepEqual(root.children.map(c => c.name), ['b', 'c'])
  assert.equal(root.children[1].text, 'tAB<raw> &amp;')
  assert.equal(decodeEntities('&lt;&unknown;&#10;&#xZZ;'), '<&unknown;\n&#xZZ;')
  assert.equal(parseXml(''), null)
  // A stray end tag closes nothing; an unclosed element still holds its children.
  assert.deepEqual(parseXml('<a></x><b><c/></a>').children.map(c => c.name), ['b'])
})

test('a classname names one of the given files from either end of its rootdir, then its classes', () => {
  const files = ['tests/test_order.py', 'api/tests/test_order.py', 'tests/unit/test_more.py']
  assert.deepEqual(resolveClassname('tests.test_order.TestTotal', files), { file: 'tests/test_order.py', classes: ['TestTotal'] })
  assert.deepEqual(resolveClassname('api.tests.test_order.TestTotal.TestIn', files), { file: 'api/tests/test_order.py', classes: ['TestTotal', 'TestIn'] })
  // rootdir below the project root (tests/ has the ini), and above it (the repo root has it).
  assert.deepEqual(resolveClassname('unit.test_more', files), { file: 'tests/unit/test_more.py', classes: [] })
  assert.deepEqual(resolveClassname('svc.tests.unit.test_more.TestA', files), { file: 'tests/unit/test_more.py', classes: ['TestA'] })
  assert.equal(resolveClassname('other.test_x.TestA', files), null)
})

test('the report: passed, failed with its first line, skipped and xfail, a setup error failed, a collection error broken', () => {
  const titles = new Map([['TestTotal', 'ABC-1 Totals']])
  const r = parseReport(REPORT, ['tests/test_order.py', 'tests/test_broken.py'], f => (f === 'tests/test_order.py' ? titles : new Map()))
  assert.deepEqual(r.broken, [{ file: 'tests/test_broken.py', message: "ModuleNotFoundError: No module named 'nope'" }])
  assert.deepEqual(r.tests.map(t => [t.title, t.path, t.file, t.status, t.message]), [
    ['test_sum', ['ABC-1 Totals'], 'tests/test_order.py', 'passed', ''],
    ['test_cases[1-4.5]', ['ABC-1 Totals'], 'tests/test_order.py', 'passed', ''],
    ['test_text', ['ABC-1 Totals'], 'tests/test_order.py', 'failed', 'AssertionError: assert \'a<b>&c\' == "x"'],
    ['test_skip', ['ABC-1 Totals'], 'tests/test_order.py', 'skipped', ''],
    ['test_xf', ['ABC-1 Totals'], 'tests/test_order.py', 'skipped', ''],
    ['test_inner', ['ABC-1 Totals', 'TestNested'], 'tests/test_order.py', 'failed', 'failed on setup with "fixture \'db\' not found"'],
    ['test_top', [], 'tests/test_order.py', 'passed', ''],
  ])
  // xunit1 names the file outright.
  const x1 = parseReport('<testsuite><testcase classname="test_order.TestTotal" name="test_a" file="tests/test_order.py" line="3"/></testsuite>', ['tests/test_order.py'])
  assert.deepEqual(x1.tests.map(t => [t.file, t.path]), [['tests/test_order.py', ['TestTotal']]])
})

test('commands: words split without a shell; a template fills {files}, {report} and {test}', () => {
  assert.deepEqual(splitCommand(`poetry run  pytest -k "a b" 'c "d"' e\\ f`), ['poetry', 'run', 'pytest', '-k', 'a b', 'c "d"', 'e f'])
  assert.deepEqual(splitCommand('a "" b'), ['a', '', 'b'])
  const t = 'poetry run pytest {files} --junitxml={report} -k {test}'
  assert.deepEqual(fillTemplate(t, { targets: ['a.py', 'b.py'], report: '/t/r.xml', testName: 'test_x' }), ['poetry', 'run', 'pytest', 'a.py', 'b.py', '--junitxml=/t/r.xml', '-k', 'test_x'])
  assert.deepEqual(fillTemplate(t, { targets: ['a.py'], report: '/t/r.xml' }), ['poetry', 'run', 'pytest', 'a.py', '--junitxml=/t/r.xml'])
  assert.deepEqual(fillTemplate('tox -- --only={files}', { targets: ['a.py', 'b.py'], report: '' }), ['tox', '--', '--only=a.py b.py'])
  assert.equal(baseName('test_total[1-4.5]'), 'test_total')
})

test('one test by node id: its classes from the source, every class that has it', () => {
  const d = project({ 'tests/test_a.py': 'class TestA:\n    def test_x(self):\n        assert 1\n\n    class TestIn:\n        def test_x(self):\n            assert 1\n\ndef test_y():\n    assert 1\n' })
  assert.deepEqual(nodeIds(d, ['tests/test_a.py'], 'test_x'), ['tests/test_a.py::TestA::test_x', 'tests/test_a.py::TestA::TestIn::test_x'])
  assert.deepEqual(nodeIds(d, ['tests/test_a.py'], 'test_y[2]'), ['tests/test_a.py::test_y[2]'])
  assert.deepEqual(nodeIds(d, ['tests/test_a.py', 'tests/missing.py'], 'test_z'), [])
})

// ---- A fake Python ----

// A node script standing in for python: it records its argv and env, writes the report it is given to
// the --junitxml path, prints .fake-output and exits with .fake-exit (sleeps .fake-sleep ms first).
const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const dir = process.cwd()
const read = (f, d) => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch { return d } }
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, '.fake-calls'), JSON.stringify({ bin: path.basename(process.argv[1]), args, env: { PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE, COVERAGE_FILE: process.env.COVERAGE_FILE } }) + '\\n')
setTimeout(() => {
  const out = (args.find(a => a.startsWith('--junitxml=')) || '').slice(11)
  const report = read('.fake-report.xml', null)
  if (out && report !== null) fs.writeFileSync(out, report)
  process.stderr.write(read('.fake-output', ''))
  process.exit(Number(read('.fake-exit', '0')))
}, Number(read('.fake-sleep', '0')))
`
const calls = d => readFileSync(join(d, '.fake-calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const SPEC = 'import pytest\n\nclass TestTotal:\n    """ABC-1 Totals"""\n\n    @pytest.mark.parametrize("n", [1, 2])\n    def test_cases(self, n):\n        assert n\n\n    def test_sum(self):\n        assert 1\n'
const CASES = '<testsuite><testcase classname="tests.test_order.TestTotal" name="test_cases[1]"/><testcase classname="tests.test_order.TestTotal" name="test_cases[2]"><failure message="assert 0"/></testcase><testcase classname="tests.test_order.TestTotal" name="test_sum"/></testsuite>'

test('the project\'s virtualenv Python runs pytest with the report in a temp folder, the caches off', async () => {
  const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': CASES, '.fake-exit': '1' })
  put(d, '.venv/bin/python', FAKE, 0o755)
  const r = await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'] })
  assert.equal(r.ran, true)
  assert.deepEqual(r.tests.map(t => [t.title, t.path[0], t.status, t.message]), [['test_cases[1]', 'ABC-1 Totals', 'passed', ''], ['test_cases[2]', 'ABC-1 Totals', 'failed', 'assert 0'], ['test_sum', 'ABC-1 Totals', 'passed', '']])
  const [c] = calls(d)
  const report = c.args.find(a => a.startsWith('--junitxml=')).slice(11)
  assert.deepEqual(c.args.filter(a => a !== `--junitxml=${report}`), ['-m', 'pytest', 'tests/test_order.py', '-p', 'no:cacheprovider', '-q', '-o', 'junit_family=xunit2', '--continue-on-collection-errors'])
  assert.ok(!report.startsWith(d), 'the report is outside the project')
  assert.ok(!existsSync(dirname(report)), 'the temp folder is gone')
  assert.equal(c.env.PYTHONDONTWRITEBYTECODE, '1')
  assert.ok(!c.env.COVERAGE_FILE.startsWith(d))
})

test('one test by name runs its node id; its parametrized cases report under that name', async () => {
  const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': CASES })
  put(d, '.venv/bin/python', FAKE, 0o755)
  const r = await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'], testName: 'test_cases' })
  assert.deepEqual(r.tests.map(t => [t.title, t.status]), [['test_cases', 'passed'], ['test_cases', 'failed']])
  assert.ok(calls(d)[0].args.includes('tests/test_order.py::TestTotal::test_cases'))
  assert.ok(!calls(d)[0].args.includes('tests/test_order.py'))
})

test('a usage error before any test leaves every file broken; no report at all is a run that did not happen', async () => {
  const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': '<testsuites><testsuite tests="0"/></testsuites>', '.fake-exit': '4', '.fake-output': 'ERROR: file or directory not found: tests/test_order.py\n' })
  put(d, '.venv/bin/python', FAKE, 0o755)
  const run = pytestRunner(d, { adapter: 'pytest' })
  assert.deepEqual(await run({ files: ['tests/test_order.py'] }), { ran: true, tests: [], broken: [{ file: 'tests/test_order.py', message: 'ERROR: file or directory not found: tests/test_order.py' }] })
  // No report at all: the run did not happen, for the reason pytest printed.
  const none = mkdtempSync(join(tmpdir(), 'qc-pytest-'))
  put(none, 'tests/test_order.py', SPEC)
  put(none, '.venv/bin/python', FAKE, 0o755)
  put(none, '.fake-output', 'INTERNALERROR> boom\n')
  put(none, '.fake-exit', '3')
  assert.deepEqual(await pytestRunner(none, { adapter: 'pytest' })({ files: ['tests/test_order.py'] }), { ran: false, tests: [], broken: [], error: 'INTERNALERROR> boom' })
})

test('python without pytest falls back to python3; no Python at all says so', async () => {
  const py = fakeCommand('python')
  const py3 = fakeCommand('python3')
  try {
    py.act('echo "/usr/bin/python: No module named pytest" >&2; exit 1')
    const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': CASES })
    py3.act(`exec node ${JSON.stringify(join(d, 'fake.cjs'))} "$@"`)
    put(d, 'fake.cjs', FAKE)
    const r = await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'] })
    assert.equal(r.ran, true)
    assert.equal(r.tests.length, 3)
    py3.act('echo "No module named pytest" >&2; exit 1')
    assert.equal((await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'] })).error, "pytest is not installed for this project's Python")
  } finally {
    py3.restore()
    py.restore()
  }
  const before = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'qc-empty-'))
  try {
    const d = project({ 'tests/test_order.py': SPEC })
    assert.equal((await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'] })).error, 'Python is not installed (no python or python3 on PATH)')
  } finally {
    process.env.PATH = before
  }
})

test('pytest.command: the project\'s own command, the report added when the template has no {report}', async () => {
  const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': CASES })
  put(d, 'bin/py', FAKE, 0o755)
  const config = { adapter: 'pytest', pytest: { command: './bin/py -m pytest -x {files}' } }
  const r = await pytestRunner(d, config)({ files: ['tests/test_order.py'], testName: 'test_sum' })
  assert.deepEqual(r.tests.map(t => t.title), ['test_sum'])
  const [c] = calls(d)
  assert.deepEqual(c.args.slice(0, 4), ['-m', 'pytest', '-x', 'tests/test_order.py::TestTotal::test_sum'])
  assert.match(c.args[4], /^--junitxml=.+report\.xml$/)
})

test('a run past its time is killed with its process group', async () => {
  const d = project({ 'tests/test_order.py': SPEC, '.fake-report.xml': CASES, '.fake-sleep': '20000' })
  put(d, '.venv/bin/python', FAKE, 0o755)
  const t0 = Date.now()
  const r = await pytestRunner(d, { adapter: 'pytest' })({ files: ['tests/test_order.py'], timeoutMs: 300 })
  assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'took longer than 300ms' })
  assert.ok(Date.now() - t0 < 5000)
})

// ---- The types step ----

test('typeCheck: not applicable without pytest.typeCheck; the command\'s errors in a spec fail it, elsewhere only noted', async () => {
  const d = project({ 'tests/test_order.py': SPEC })
  assert.deepEqual(await typeCheck(d, { adapter: 'pytest' }, ['tests/test_order.py']), { check: 'types', status: 'pass', summary: 'not applicable: no type-check for Python', findings: [], data: { applicable: false } })
  put(d, '.venv/bin/mypy', '#!/bin/sh\necho "$@" > "$PWD/.mypy-args"\ncat "$PWD/.mypy-out"\n[ -s "$PWD/.mypy-out" ] && exit 1\nexit 0\n', 0o755)
  const mypy = out => put(d, '.mypy-out', out)
  const config = { adapter: 'pytest', pytest: { typeCheck: 'mypy --strict {files}' } }
  mypy('tests/test_order.py:7: error: Missing return type  [no-untyped-def]\napp/x.py:1: error: Bad  [misc]\nFound 2 errors\n')
  const red = await typeCheck(d, config, ['tests/test_order.py'])
  assert.equal(red.status, 'fail')
  assert.equal(red.summary, 'tests/test_order.py:7: error: Missing return type  [no-untyped-def]')
  assert.deepEqual(red.findings.map(f => [f.file, f.kind]), [['tests/test_order.py', 'type error']])
  assert.equal(readFileSync(join(d, '.mypy-args'), 'utf8').trim(), '--strict tests/test_order.py')
  mypy('app/x.py:1:5: error: Bad  [misc]\n')
  const other = await typeCheck(d, config, ['tests/test_order.py'])
  assert.deepEqual([other.status, other.summary, other.data.otherErrors], ['pass', 'mypy: no type errors in the specs; 1 in other files', 1])
  mypy('')
  assert.equal((await typeCheck(d, config, ['tests/test_order.py'])).summary, 'mypy: no type errors')
  mypy('mypy: error: unrecognized arguments\n')
  assert.equal((await typeCheck(d, config, ['tests/test_order.py'])).status, 'not_run')
  assert.equal((await typeCheck(d, { adapter: 'pytest', pytest: { typeCheck: 'no-such-checker-qc {files}' } }, ['tests/test_order.py'])).summary, 'could not start no-such-checker-qc: not installed')
})

// ---- A real pytest, when this machine has one ----

const realPython = ['python3', 'python'].find(p => spawnSync(p, ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0)
const noPytest = realPython ? false : 'no Python with pytest on this machine'

const listing = d => {
  const out = []
  const walk = rel => { for (const e of readdirSync(join(d, rel), { withFileTypes: true })) { const p = rel ? `${rel}/${e.name}` : e.name; out.push(p); if (e.isDirectory()) walk(p) } }
  walk('')
  return out.sort()
}

test('real pytest: statuses, a collection error, one test by node id in a temp copy, nothing written into the project', { skip: noPytest, timeout: 60_000 }, async () => {
  const d = project({
    'app/__init__.py': '',
    'app/pricing.py': 'def total(xs):\n    return sum(xs)\n',
    'tests/test_pricing.py': 'import pytest\n\nfrom app.pricing import total\n\n\nclass TestTotal:\n    """ABC-1 Totals & <sums>"""\n\n    def test_sum(self):\n        assert total([1, 2]) == 3\n\n    @pytest.mark.parametrize("xs, want", [([1], 1), ([2], 3)])\n    def test_cases(self, xs, want):\n        assert total(xs) == want\n\n    @pytest.mark.skip(reason="ABC-9")\n    def test_skip(self):\n        assert 0\n\n    @pytest.mark.xfail\n    def test_xf(self):\n        assert 0\n\n\ndef test_top():\n    with pytest.raises(TypeError):\n        total([None])\n',
    'tests/test_broken.py': 'import not_a_module_qc\n\ndef test_x():\n    assert 1\n',
  })
  const before = listing(d)
  const run = pytestRunner(d, { adapter: 'pytest' })
  const r = await run({ files: ['tests/test_pricing.py', 'tests/test_broken.py'] })
  assert.equal(r.ran, true, r.error)
  assert.deepEqual(r.tests.map(t => [t.title, t.path, t.status]), [
    ['test_sum', ['ABC-1 Totals & <sums>'], 'passed'],
    ['test_cases[xs0-1]', ['ABC-1 Totals & <sums>'], 'passed'],
    ['test_cases[xs1-3]', ['ABC-1 Totals & <sums>'], 'failed'],
    ['test_skip', ['ABC-1 Totals & <sums>'], 'skipped'],
    ['test_xf', ['ABC-1 Totals & <sums>'], 'skipped'],
    ['test_top', [], 'passed'],
  ])
  assert.match(r.tests[2].message, /^assert 2 == 3/)
  assert.deepEqual(r.broken, [{ file: 'tests/test_broken.py', message: "ModuleNotFoundError: No module named 'not_a_module_qc'" }])
  // The mutation check's temp copy: a name pytest would not collect by itself, run by node id.
  const tmp = 'tests/mut-tmp-1-ab-cd12-test_pricing.py'
  put(d, tmp, readFileSync(join(d, 'tests/test_pricing.py'), 'utf8').replace('== 3\n', '!= 3\n'))
  const one = await run({ files: [tmp], testName: 'test_sum' })
  assert.deepEqual(one.tests.map(t => [t.title, t.file, t.status]), [['test_sum', tmp, 'failed']])
  const cases = await run({ files: [tmp], testName: 'test_cases' })
  assert.deepEqual(cases.tests.map(t => [t.title, t.status]), [['test_cases', 'passed'], ['test_cases', 'failed']])
  assert.deepEqual(listing(d), [...before, tmp].sort(), 'no cache, bytecode or report in the project')
})
