// The .NET runner: the TRX parser on real-format reports, and dotnet test driven through a fake
// dotnet first on PATH (no .NET SDK needed): arguments, filters, build errors, timeouts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildError, dotnetRunner, filterFor, methodTitle, parseTrx, projectOf } from '../../../lib/pipeline/runners/dotnet.mjs'
import { runPipeline } from '../../../lib/pipeline/pipeline.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { fakeCommand } from '../../fake-bin.mjs'
import { ENV } from '../../git-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(HERE, 'fixtures/dotnet', name), 'utf8')
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('xUnit TRX: passed, failed with its message, NotExecuted as skipped, a theory\'s cases under the method name', () => {
  const r = parseTrx(fixture('xunit.trx'))
  assert.deepEqual(r.map(t => [t.className, t.title, t.status]), [
    ['Demo.Tests.PricingTests', 'Rounds_a_total_of_10_005_up', 'passed'],
    ['Demo.Tests.PricingTests', 'Rounds_a_total_of_10_004_down', 'failed'],
    ['Demo.Tests.PricingTests', 'Later', 'skipped'],
    ['Demo.Tests.PricingTests', 'Doubles', 'passed'],
    ['Demo.Tests.PricingTests', 'Doubles', 'passed'],
    ['Demo.Tests.OtherTests', 'Elsewhere', 'passed'],
  ])
  assert.equal(r[1].message, 'Assert.Equal() Failure: Values differ')
  assert.ok(r.filter(t => t.status !== 'failed').every(t => t.message === ''))
})

test('NUnit TRX: a TestCase\'s parameters are dropped from the title, entities decoded', () => {
  const r = parseTrx(fixture('nunit.trx'))
  assert.deepEqual(r.map(t => [t.title, t.status, t.message]), [
    ['Moves_stock', 'passed', ''],
    ['Refuses_a_negative_move', 'failed', 'Expected: "quantity must be 1 or more"'],
    ['Ignored_case', 'skipped', ''],
  ])
  assert.ok(r.every(t => t.className === 'Demo.Tests.StockTests'))
})

test('MSTest TRX: a data-driven test counts its rows; an assembly-qualified class name is cut to the class', () => {
  const r = parseTrx(fixture('mstest-data.trx'))
  assert.deepEqual(r.map(t => [t.className, t.title, t.status]), [
    ['Demo.Stock.Tests.StockTests', 'Sums', 'passed'],
    ['Demo.Stock.Tests.StockTests', 'Sums', 'failed'],
    ['Demo.Stock.Tests.StockTests', 'Counts_the_pallets', 'passed'],
    ['Demo.Stock.Tests.StockTests', 'Not_yet', 'skipped'],
  ])
  assert.equal(r[1].message, 'Assert.AreEqual failed. Expected:<5>. Actual:<4>.')
})

test('the parser\'s helpers: method titles, the first compiler error, the filter', () => {
  assert.equal(methodTitle('Demo.Tests.PricingTests.Doubles(quantity: 1, expected: 2)'), 'Doubles')
  assert.equal(methodTitle('Moves_stock("A.1",3)'), 'Moves_stock')
  assert.equal(buildError(fixture('build-error.txt')), '/work/tests/Demo.Tests/PricingTests.cs(14,40): error CS1002: ; expected')
  assert.equal(buildError('  1>Build succeeded.\n'), null)
  const classes = [{ fqn: 'Demo.Tests.PricingTests' }, { fqn: 'Demo.Tests.OtherTests' }]
  assert.equal(filterFor(classes), 'FullyQualifiedName~Demo.Tests.PricingTests.|FullyQualifiedName~Demo.Tests.OtherTests.')
  assert.equal(filterFor(classes.slice(0, 1), 'Doubles'), 'FullyQualifiedName~Demo.Tests.PricingTests.Doubles')
})

test('the test project is the nearest .csproj or .fsproj above the spec, never above the project root', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-dotnet-proj-'))
  put(d, 'tests/Demo.Tests/Demo.Tests.csproj', '<Project />')
  put(d, 'tests/Demo.Tests/Unit/PricingTests.cs', 'x')
  put(d, 'tests/Fs.Tests/Fs.Tests.fsproj', '<Project />')
  put(d, 'loose/LooseTests.cs', 'x')
  assert.equal(projectOf(d, 'tests/Demo.Tests/Unit/PricingTests.cs'), join(d, 'tests/Demo.Tests/Demo.Tests.csproj'))
  assert.equal(projectOf(d, 'tests/Fs.Tests/Tests.fs'), join(d, 'tests/Fs.Tests/Fs.Tests.fsproj'))
  assert.equal(projectOf(d, 'loose/LooseTests.cs'), null)
})

// A TRX report of { cls, name, outcome, message } rows, as dotnet test writes it.
function trx(rows) {
  const id = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const results = rows.map((r, i) => `    <UnitTestResult executionId="${id(i + 100)}" testId="${id(i)}" testName="${esc(`${r.cls}.${r.name}`)}" computerName="ci" duration="00:00:00.0010000" outcome="${r.outcome}" testListId="8c84fa94-04c1-424b-9868-57a2d4851a1d">${r.message ? `<Output><ErrorInfo><Message>${esc(r.message)}</Message><StackTrace>   at ${esc(r.cls)}.${esc(r.name)}()</StackTrace></ErrorInfo></Output>` : ''}</UnitTestResult>`)
  const defs = rows.map((r, i) => `    <UnitTest name="${esc(`${r.cls}.${r.name}`)}" storage="/x/tests.dll" id="${id(i)}"><Execution id="${id(i + 100)}" /><TestMethod codeBase="/x/Tests.dll" adapterTypeName="executor://xunit/VsTestRunner2/netcoreapp" className="${esc(r.cls)}" name="${esc(r.name)}" /></UnitTest>`)
  return `<?xml version="1.0" encoding="utf-8"?>\n<TestRun id="${id(999)}" name="ci" runUser="ci" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n  <Results>\n${results.join('\n')}\n  </Results>\n  <TestDefinitions>\n${defs.join('\n')}\n  </TestDefinitions>\n</TestRun>\n`
}

/**
 * A fake dotnet first on PATH. decide is the body of a function (args, cwd, fs, trx) that returns
 * { trx?, exit?, output?, sleepMs? }; each call's argv, cwd and telemetry env go to <dir>/calls.jsonl.
 */
function fakeDotnet(decide) {
  const dir = mkdtempSync(join(tmpdir(), 'qc-fake-dotnet-'))
  const script = join(dir, 'fake-dotnet.mjs')
  writeFileSync(script, `import fs from 'node:fs'
import { join } from 'node:path'
const trx = ${trx.toString()}
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify({ args, cwd: process.cwd(), telemetry: process.env.DOTNET_CLI_TELEMETRY_OPTOUT ?? null, nologo: process.env.DOTNET_NOLOGO ?? null }) + '\\n')
const r = (function (args, cwd, fs, trx) { ${decide} })(args, process.cwd(), fs, trx) || {}
const logger = args[args.indexOf('--logger') + 1] || ''
const report = /LogFileName=(.*)$/.exec(logger)?.[1]
setTimeout(() => {
  if (r.trx && report) fs.writeFileSync(report, r.trx)
  if (r.output) process.stdout.write(r.output)
  process.exit(r.exit ?? 0)
}, r.sleepMs ?? 0)
`)
  const cmd = fakeCommand('dotnet')
  cmd.act(`exec "${process.execPath}" "${script}" "$@"`)
  const calls = () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])
  return { calls, restore: cmd.restore }
}

const SPEC = 'tests/Demo.Tests/PricingTests.cs'
const SRC = `using Xunit;

namespace Demo.Tests;

// DEMO-1 Line totals round to the cent
public class PricingTests
{
    [Fact]
    public void Rounds_up()
    {
        var total = Pricing.LineTotal(3.335m, 3);

        Assert.Equal(10.01m, total);
    }

    [Fact]
    public void Rounds_down()
    {
        Assert.Equal(10.00m, Pricing.LineTotal(3.3346m, 3));
    }
}
`
function project(src = SRC) {
  const d = mkdtempSync(join(tmpdir(), 'qc-dotnet-run-'))
  put(d, 'tests/Demo.Tests/Demo.Tests.csproj', '<Project Sdk="Microsoft.NET.Sdk" />\n')
  put(d, SPEC, src)
  return d
}

test('runs dotnet test on the spec\'s project with a TRX logger and a class filter; results carry the key block\'s title', async t => {
  const d = project()
  const fake = fakeDotnet(`return { exit: 1, trx: trx([
    { cls: 'Demo.Tests.PricingTests', name: 'Rounds_up', outcome: 'Passed' },
    { cls: 'Demo.Tests.PricingTests', name: 'Rounds_down', outcome: 'Failed', message: 'Assert.Equal() Failure: Values differ\\nExpected: 10.00' },
    { cls: 'Demo.Tests.Elsewhere', name: 'Other', outcome: 'Passed' },
  ]) }`)
  t.after(fake.restore)
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC] })
  assert.deepEqual(r, { ran: true, broken: [], tests: [
    { title: 'Rounds_up', path: ['DEMO-1 Line totals round to the cent'], file: SPEC, status: 'passed', message: '' },
    { title: 'Rounds_down', path: ['DEMO-1 Line totals round to the cent'], file: SPEC, status: 'failed', message: 'Assert.Equal() Failure: Values differ' },
  ] })
  const [call] = fake.calls()
  assert.equal(call.args[0], 'test')
  assert.equal(call.args[1], 'tests/Demo.Tests/Demo.Tests.csproj')
  assert.ok(call.args.includes('--nologo'))
  assert.match(call.args[call.args.indexOf('--logger') + 1], /^trx;LogFileName=.*report\.trx$/)
  assert.equal(call.args[call.args.indexOf('--filter') + 1], 'FullyQualifiedName~Demo.Tests.PricingTests.')
  assert.ok(!call.args[call.args.indexOf('--results-directory') + 1].startsWith(d), 'the report goes to a temp folder')
  assert.equal(call.cwd, (await import('node:fs')).realpathSync(d))
  assert.deepEqual([call.telemetry, call.nologo], ['1', '1'])
  // Nothing but the spec and the project in the project folder: no report, no TestResults.
  assert.deepEqual(readdirSync(join(d, 'tests/Demo.Tests')).sort(), ['Demo.Tests.csproj', 'PricingTests.cs'])
})

test('one test: the filter names the method, and only that title comes back', async t => {
  const d = project()
  const fake = fakeDotnet(`return { trx: trx([{ cls: 'Demo.Tests.PricingTests', name: 'Rounds_up', outcome: 'Passed' }, { cls: 'Demo.Tests.PricingTests', name: 'Rounds_up_more', outcome: 'Passed' }]) }`)
  t.after(fake.restore)
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC], testName: 'Rounds_up' })
  assert.deepEqual(r.tests.map(x => x.title), ['Rounds_up'])
  const args = fake.calls()[0].args
  assert.equal(args[args.indexOf('--filter') + 1], 'FullyQualifiedName~Demo.Tests.PricingTests.Rounds_up')
})

test('a build that fails: the specs go to broken with the first compiler error', async t => {
  const d = project()
  const fake = fakeDotnet(`return { exit: 1, output: ${JSON.stringify(fixture('build-error.txt'))} }`)
  t.after(fake.restore)
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC] })
  assert.deepEqual(r, { ran: true, tests: [], broken: [{ file: SPEC, message: 'does not compile: /work/tests/Demo.Tests/PricingTests.cs(14,40): error CS1002: ; expected' }] })
})

test('no report and no compiler error: not run, with what dotnet said', async t => {
  const d = project()
  const fake = fakeDotnet(`return { exit: 1, output: 'Restoring...\\nerror NETSDK1045: The current .NET SDK does not support targeting .NET 9.0.\\n' }`)
  t.after(fake.restore)
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC] })
  assert.equal(r.ran, false)
  assert.equal(r.error, 'error NETSDK1045: The current .NET SDK does not support targeting .NET 9.0.')
})

test('a spec with no project or no class is broken; a missing SDK is said plainly', async t => {
  const d = project()
  put(d, 'loose/LooseTests.cs', 'public class LooseTests { }\n')
  put(d, 'tests/Demo.Tests/EmptyTests.cs', '// nothing here\n')
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: ['loose/LooseTests.cs', 'tests/Demo.Tests/EmptyTests.cs'] })
  assert.deepEqual(r.broken, [
    { file: 'loose/LooseTests.cs', message: 'no .csproj or .fsproj above this file' },
    { file: 'tests/Demo.Tests/EmptyTests.cs', message: 'no test class in this file' },
  ])
  const before = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'qc-empty-path-'))
  t.after(() => { process.env.PATH = before })
  const none = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC] })
  assert.deepEqual(none, { ran: false, tests: [], broken: [], error: 'the .NET SDK is not installed (no dotnet on PATH)' })
})

test('the timeout kills dotnet and says how long it waited', async t => {
  const d = project()
  const fake = fakeDotnet(`return { sleepMs: 20000, trx: trx([]) }`)
  t.after(fake.restore)
  const t0 = Date.now()
  const r = await dotnetRunner(d, { adapter: 'dotnet' })({ files: [SPEC], timeoutMs: 300 })
  assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'took longer than 300ms' })
  assert.ok(Date.now() - t0 < 5000)
})

test('dotnet.command: the project\'s own command, with the TRX logger and the filter added', async t => {
  const d = project()
  const fake = fakeDotnet(`return { trx: trx([{ cls: 'Demo.Tests.PricingTests', name: 'Rounds_up', outcome: 'Passed' }]) }`)
  t.after(fake.restore)
  const r = await dotnetRunner(d, { adapter: 'dotnet', dotnet: { command: 'dotnet test {files} --no-restore -c Release' } })({ files: [SPEC] })
  assert.deepEqual(r.tests.map(x => x.status), ['passed'])
  const args = fake.calls()[0].args
  assert.deepEqual(args.slice(0, 5), ['test', 'tests/Demo.Tests/Demo.Tests.csproj', '--no-restore', '-c', 'Release'])
  assert.ok(args.includes('--logger') && args.includes('--results-directory'))
  assert.equal(args[args.indexOf('--filter') + 1], 'FullyQualifiedName~Demo.Tests.PricingTests.')
})

test('the pipeline on .NET: green with every mutant killed in place, and the spec comes back byte for byte', async t => {
  const d = project()
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'i')
  // The tests pass on the spec as written and fail on any change to it: every mutant is killed.
  const fake = fakeDotnet(`
    const src = fs.readFileSync(cwd + '/${SPEC}', 'utf8')
    const pristine = src === ${JSON.stringify(SRC)}
    const filter = args[args.indexOf('--filter') + 1]
    const only = filter.split('.').at(-1)
    const names = ['Rounds_up', 'Rounds_down'].filter(n => !only || n === only)
    return { exit: pristine ? 0 : 1, trx: trx(names.map(name => ({ cls: 'Demo.Tests.PricingTests', name, outcome: pristine ? 'Passed' : 'Failed', message: pristine ? '' : 'Assert.Equal() Failure' }))) }`)
  t.after(fake.restore)
  const config = { adapter: 'dotnet', jira: { projects: ['DEMO'] } }
  const out = await runPipeline({ specs: [SPEC], key: 'DEMO-1' }, { config, dialect: dialectFor('dotnet'), root: d, runTests: dotnetRunner(d, config) })
  const step = c => out.steps.find(s => s.check === c)
  assert.equal(out.verdict, 'green', JSON.stringify(out.steps.map(s => [s.check, s.status, s.summary])))
  assert.equal(step('suite-honesty').summary, '2/2 tests carry assertions (100%)')
  assert.equal(step('mutation').summary, '2/2 mutants killed')
  assert.deepEqual(fake.calls().slice(1).map(c => c.args[c.args.indexOf('--filter') + 1]), ['FullyQualifiedName~Demo.Tests.PricingTests.Rounds_up', 'FullyQualifiedName~Demo.Tests.PricingTests.Rounds_down'])
  assert.equal(readFileSync(join(d, SPEC), 'utf8'), SRC)
})
