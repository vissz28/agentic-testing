// node --test, Node's own runner, in the generic tier: its reporter, its flags, a real run, its asserts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import reporter from '../../lib/pipeline/runners/node-test-reporter.mjs'
import { nodeFlags, runGeneric } from '../../lib/pipeline/runners/generic.mjs'
import { flipMutations } from '../../lib/base/dialects/generic.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'
import { scoreSpec } from '../../lib/pipeline/checks/suite-honesty.mjs'
import { scanDiff } from '../../lib/pipeline/checks/honesty.mjs'
import { planMutants } from '../../lib/pipeline/checks/mutation.mjs'
import { runnerLabel } from '../../lib/base/runners.mjs'

const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const dialect = dialectFor('node')
async function report(events) {
  let out = ''
  for await (const chunk of reporter((async function * () { yield * events })())) out += chunk
  return JSON.parse(out)
}

test('reporter: a test per result with its describe path; suites left out; skip and todo are skipped; a file that does not load is broken', async () => {
  const f = '/p/test/a.test.js'
  const r = await report([
    { type: 'test:start', data: { file: f, nesting: 0, name: 'ABC-1 Sums' } },
    { type: 'test:start', data: { file: f, nesting: 1, name: 'adds' } },
    { type: 'test:pass', data: { file: f, nesting: 1, name: 'adds', details: { type: 'test' } } },
    { type: 'test:start', data: { file: f, nesting: 1, name: 'fails' } },
    { type: 'test:fail', data: { file: f, nesting: 1, name: 'fails', details: { type: 'test', error: { message: 'test failed', cause: { message: 'Expected values to be strictly equal:\n\n2 !== 3' } } } } },
    { type: 'test:pass', data: { file: f, nesting: 1, name: 'later', skip: true, details: { type: 'test' } } },
    { type: 'test:pass', data: { file: f, nesting: 1, name: 'someday', todo: true, details: { type: 'test' } } },
    { type: 'test:fail', data: { file: f, nesting: 0, name: 'ABC-1 Sums', details: { type: 'suite', error: { message: '1 subtest failed' } } } },
    { type: 'test:stderr', data: { file: 'test/b.test.js', message: "SyntaxError: Unexpected token '}'\n    at x\n" } },
    { type: 'test:fail', data: { file: '/p/test/b.test.js', nesting: 0, name: 'test/b.test.js', details: { type: 'test', error: { message: 'test failed' } } } },
  ])
  assert.deepEqual(r.tests.map(t => [t.title, t.path, t.status]), [['adds', ['ABC-1 Sums'], 'passed'], ['fails', ['ABC-1 Sums'], 'failed'], ['later', ['ABC-1 Sums'], 'skipped'], ['someday', ['ABC-1 Sums'], 'skipped']])
  assert.match(r.tests[1].message, /^Expected values to be strictly equal/)
  assert.deepEqual(r.broken, [{ file: '/p/test/b.test.js', message: "SyntaxError: Unexpected token '}'" }])
})

test('nodeFlags: the loading flags of the project\'s node --test script, its test script first; nothing else', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-node-'))
  const flags = scripts => { put(d, 'package.json', JSON.stringify({ scripts })); return nodeFlags(d) }
  assert.deepEqual(flags({ test: "node --import tsx --test --test-reporter=spec 'src/**/*.test.ts'" }), ['--import', 'tsx'])
  assert.deepEqual(flags({ test: 'npm run lint && node -r dotenv/config --env-file=.env --experimental-test-coverage --test' }), ['-r', 'dotenv/config', '--env-file=.env', '--experimental-test-coverage'])
  assert.deepEqual(flags({ 'test:unit': 'node --import=tsx --test', test: 'node --no-warnings --test' }), ['--no-warnings'], 'the test script first')
  assert.deepEqual(flags({ test: 'vitest run' }), [])
  assert.deepEqual(nodeFlags(mkdtempSync(join(tmpdir(), 'qc-node-'))), [], 'no package.json')
})

test('runGeneric: a real node --test run, one result per test, a title filter, and a file that does not load', async () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'qc-node-')))
  put(d, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  put(d, 'test/a.test.js', "import { describe, it } from 'node:test'\nimport assert from 'node:assert/strict'\ndescribe('ABC-1 Sums', () => {\n  it('adds', () => { assert.strictEqual(1 + 2, 3) })\n  it('fails', () => { assert.strictEqual(1 + 1, 3) })\n  it('later', { skip: true }, () => {})\n})\n")
  put(d, 'test/b.test.js', "import { test } from 'node:test'\ntest('x', () => {\n  oops(\n})\n")
  const r = await runGeneric(d, 'node', ['test/a.test.js', 'test/b.test.js'], { timeoutMs: 60000 })
  assert.equal(r.ran, true)
  assert.deepEqual(r.tests.map(t => [t.file, t.path, t.title, t.status]), [['test/a.test.js', ['ABC-1 Sums'], 'adds', 'passed'], ['test/a.test.js', ['ABC-1 Sums'], 'fails', 'failed'], ['test/a.test.js', ['ABC-1 Sums'], 'later', 'skipped']])
  assert.match(r.tests[1].message, /strictly equal/)
  assert.deepEqual(r.broken, [{ file: 'test/b.test.js', message: "SyntaxError: Unexpected token '}'" }])
  const one = await runGeneric(d, 'node', ['test/a.test.js'], { testName: 'adds', timeoutMs: 60000 })
  assert.deepEqual(one.tests.map(t => t.title), ['adds'])
})

test('flips: node:assert methods negate both ways, ok and a bare assert negate their argument, and the value is the second argument', () => {
  const kinds = s => flipMutations(s).map(f => `${f.kind} ${f.text}`)
  assert.deepEqual(kinds('assert.strictEqual(sum(1, 2), 3)'), ['invert-matcher assert.notStrictEqual(sum(1, 2), 3)', 'num→n+1 assert.strictEqual(sum(1, 2), 4)'])
  assert.deepEqual(kinds('assert.notStrictEqual(x, 3)'), ['drop-not assert.strictEqual(x, 3)', 'num→n+1 assert.notStrictEqual(x, 4)'])
  assert.deepEqual(kinds("assert.equal(fmt('a, b'), 'Ada')"), ["invert-matcher assert.notEqual(fmt('a, b'), 'Ada')", "corrupt-string assert.equal(fmt('a, b'), 'Ada★MUT')"])
  assert.deepEqual(kinds('assert.ok(total > 0)'), ['invert-matcher assert.ok(!(total > 0))'])
  assert.deepEqual(kinds('assert(total > 0)'), ['invert-matcher assert(!(total > 0))'])
  assert.deepEqual(kinds('await assert.rejects(load(), /boom/)'), ['invert-matcher await assert.doesNotReject(load(), /boom/)'])
  assert.deepEqual(kinds('assert.match(text, /a,b/)'), ['invert-matcher assert.doesNotMatch(text, /a,b/)'])
})

test('the checks read node:test: option skips and todos, assert calls as assertions, and a mutant per assert', () => {
  const src = "describe('ABC-1 Sums', () => {\n  it('adds', () => {\n    assert.strictEqual(sum(1, 2), 3)\n  })\n  it('later', { skip: 'not yet' }, () => {})\n  it('someday', { todo: true }, () => {})\n  it('runs', { timeout: 500, skip: false }, () => { sum(1, 2) })\n})\n"
  assert.deepEqual(scoreSpec(src, dialect).map(t => [t.title, t.mod, t.expects]), [['adds', null, 1], ['later', 'skip', 0], ['someday', 'todo', 0], ['runs', null, 0]])
  assert.deepEqual(planMutants(src, ['adds'], { key: 'ABC-1' }, dialect).map(m => m.replacement.trim()), ['assert.notStrictEqual(sum(1, 2), 3)'])
  const diff = ['+++ b/test/a.test.js', "+  it('pays', { skip: true }, () => {", "+  it('lists', { skip: false }, () => {", '-    assert.strictEqual(total, 108)'].join('\n')
  assert.deepEqual(scanDiff(diff, dialect, '(?:ABC)-\\d+').map(v => v.kind), ['test newly skipped', 'assertion removed'])
  assert.equal(runnerLabel('node'), 'node --test (generic checks)')
})
