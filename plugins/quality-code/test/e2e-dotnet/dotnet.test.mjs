// End to end on .NET: the real pipeline with the real dotnet test, on a tiny xUnit project made at
// run time (dotnet new). Runs only with QC_E2E=1 and a .NET SDK on PATH: the e2e-dotnet CI job runs this
// folder; the e2e job reads test/e2e/ only, so its runner's preinstalled SDK does not run it twice.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../git-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../../bin/pipeline.mjs')
const hasDotnet = () => spawnSync('dotnet', ['--version'], { encoding: 'utf8' }).status === 0
const skip = process.env.QC_E2E !== '1' ? 'end to end: set QC_E2E=1' : !hasDotnet() ? 'end to end: no .NET SDK on PATH' : false
const LONG = 15 * 60 * 1000
const SPEC = 'tests/Demo.Tests/PricingTests.cs'

const PRICING = `namespace Demo;

public static class Pricing
{
    public static decimal LineTotal(decimal unitPrice, int quantity)
    {
        if (quantity < 1) throw new ArgumentException($"quantity must be a whole number of 1 or more, not {quantity}");
        return Math.Round(unitPrice * quantity, 2, MidpointRounding.AwayFromZero);
    }

    // The bug of DEMO-2: banker's rounding, so half a cent goes to the even cent.
    public static decimal Vat(decimal net) => Math.Round(net * 0.25m, 2);
}
`

const GREEN = `namespace Demo.Tests;

// DEMO-1 Line totals round to the cent
public class PricingTests
{
    [Fact]
    public void Line_total()
    {
        var total = Demo.Pricing.LineTotal(4.50m, 3);

        Assert.Equal(13.50m, total);
    }

    [Fact]
    public void Half_a_cent_rounds_up()
    {
        var total = Demo.Pricing.LineTotal(3.335m, 3);

        Assert.Equal(10.01m, total);
    }

    [Fact]
    public void Quantity_of_zero()
    {
        var ex = Assert.Throws<ArgumentException>(() => Demo.Pricing.LineTotal(4.50m, 0));

        Assert.Equal("quantity must be a whole number of 1 or more, not 0", ex.Message);
    }
}
`

// The DEMO-1 tests with their values taken out: one asserts nothing the ticket says, one nothing at all.
const HOLLOW = `namespace Demo.Tests;

// DEMO-1 Line totals round to the cent
public class PricingTests
{
    [Fact]
    public void Line_total()
    {
        var total = Demo.Pricing.LineTotal(4.50m, 3);

        Assert.True(total > 0);
    }

    [Fact]
    public void Half_a_cent_rounds_up()
    {
        var total = Demo.Pricing.LineTotal(3.335m, 3);
    }
}
`

const RED = `namespace Demo.Tests;

// DEMO-2 VAT rounds half a cent up
public class PricingTests
{
    [Fact]
    public void Vat_of_a_whole_amount()
    {
        Assert.Equal(0.25m, Demo.Pricing.Vat(1.00m));
    }

    [Fact]
    public void Half_a_cent_rounds_up()
    {
        Assert.Equal(0.13m, Demo.Pricing.Vat(0.50m));
    }
}
`

const TICKETS = {
  'DEMO-1': { summary: 'Line totals round to the cent', ac: 'Scenario: line total\nGiven a line with unit price 4.50 and quantity 3\nWhen the line total is computed\nThen the line total is 13.50\n\nScenario: half a cent rounds up\nGiven a line with unit price 3.335 and quantity 3\nWhen the line total is computed\nThen the line total is 10.01\n\nScenario: quantity of zero\nGiven a line with unit price 4.50 and quantity 0\nWhen the line total is computed\nThen it fails with "quantity must be a whole number of 1 or more, not 0"' },
  'DEMO-2': { summary: 'VAT rounds half a cent up', ac: 'Scenario: half a cent rounds up\nGiven a net amount of 0.50\nWhen the VAT at 25% is computed\nThen the VAT is 0.13' },
}

let root
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, env: { ...ENV, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, stdio: 'pipe', timeout: LONG })
const git = (...a) => sh('git', a)

before(() => {
  if (skip) return
  root = mkdtempSync(join(tmpdir(), 'qc-e2e-dotnet-'))
  git('init', '-q', '-b', 'main')
  sh('dotnet', ['new', 'classlib', '-o', 'src/Demo', '-n', 'Demo'])
  sh('dotnet', ['new', 'xunit', '-o', 'tests/Demo.Tests', '-n', 'Demo.Tests'])
  sh('dotnet', ['add', 'tests/Demo.Tests/Demo.Tests.csproj', 'reference', 'src/Demo/Demo.csproj'])
  for (const f of ['src/Demo/Class1.cs', 'tests/Demo.Tests/UnitTest1.cs']) unlinkSync(join(root, f))
  writeFileSync(join(root, 'src/Demo/Pricing.cs'), PRICING)
  writeFileSync(join(root, '.gitignore'), 'bin/\nobj/\n')
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'dotnet', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'] }, dotnet: { layers: [{ name: 'unit', folder: 'tests/' }] } }, null, 2))
  mkdirSync(join(root, 'tickets'), { recursive: true })
  for (const [key, t] of Object.entries(TICKETS)) {
    writeFileSync(join(root, `tickets/${key}.json`), JSON.stringify({ key, summary: t.summary, issuetype: 'Story', text: { description: `## Summary\n${t.summary}.`, acField: t.ac }, labels: [], gitlab: null }))
  }
  git('add', '-A')
  git('commit', '-qm', 'demo')
})

/** Commits the spec as written (no assertion removed, so the checks judge it on its own), then runs the pipeline. */
function pipeline(src, key) {
  writeFileSync(join(root, SPEC), src)
  git('add', '-A')
  git('commit', '-qm', key, '--allow-empty')
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [CLI, SPEC, '--key', key, '--ticket', `@tickets/${key}.json`, '--json'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, QC_NO_AUDIT: '1' }, encoding: 'utf8', timeout: LONG })
  const line = r.stdout.trim().split('\n').at(-1)
  let outcome = null
  try { outcome = JSON.parse(line) } catch {}
  assert.ok(outcome, `no JSON outcome (exit ${r.status}): ${r.stderr || r.stdout}`)
  const step = name => outcome.steps.find(s => s.check === name)
  const card = `${outcome.verdict} in ${((Date.now() - t0) / 1000).toFixed(1)}s, decided by ${outcome.decidedBy ?? '-'}: ${outcome.steps.map(s => `${s.check}=${s.status} (${s.summary})`).join('; ')}`
  // The spec is back as written after the in-place mutants, and nothing but build output was added.
  assert.equal(readFileSync(join(root, SPEC), 'utf8'), src)
  const touched = sh('git', ['status', '--porcelain']).toString().split('\n').filter(l => /\s(?:src|tests)\//.test(l))
  assert.deepEqual(touched, [], 'no file written into the code or the tests')
  return { code: r.status, outcome, step, card }
}

test('.NET: the story DEMO-1 is green, every mutant killed in place', { skip, timeout: LONG }, t => {
  const r = pipeline(GREEN, 'DEMO-1')
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'green', r.card)
  assert.equal(r.code, 0)
  assert.equal(r.step('tests').data.passed, 3)
  assert.equal(r.step('suite-honesty').status, 'pass')
  assert.equal(r.step('expected').status, 'pass', r.step('expected').summary)
  const m = r.step('mutation')
  assert.equal(m.status, 'pass', m.summary)
  assert.equal(m.data.killed, 3)
  assert.equal(r.step('types').data.applicable, false)
})

test('.NET: a hollow DEMO-1 spec fails the checks', { skip, timeout: LONG }, t => {
  const r = pipeline(HOLLOW, 'DEMO-1')
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'checks_failed', r.card)
  assert.equal(r.code, 1)
  assert.equal(r.step('tests').status, 'pass')
  assert.equal(r.step('suite-honesty').status, 'fail')
  assert.deepEqual(r.step('suite-honesty').findings.map(f => f.test), ['Half_a_cent_rounds_up'])
  assert.ok(r.step('expected').data.missing.includes('13.50'), r.step('expected').summary)
})

test('.NET: the bug DEMO-2 is red: the rounding bug is real', { skip, timeout: LONG }, t => {
  const r = pipeline(RED, 'DEMO-2')
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'tests_red', r.card)
  assert.equal(r.outcome.decidedBy, 'tests')
  assert.equal(r.code, 1)
  const tests = r.step('tests')
  assert.deepEqual({ passed: tests.data.passed, failed: tests.data.failed }, { passed: 1, failed: 1 })
  assert.deepEqual(tests.findings.map(f => f.test), ['Half_a_cent_rounds_up'])
  assert.match(tests.findings[0].detail, /Assert\.Equal\(\) Failure/)
  assert.equal(r.step('expected').status, 'pass')
})

test('.NET: a spec that does not compile is not run, with the compiler\'s error', { skip, timeout: LONG }, t => {
  const r = pipeline(GREEN.replace('Assert.Equal(13.50m, total);', 'Assert.Equal(13.50m, totl);'), 'DEMO-1')
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'not_verified', r.card)
  assert.equal(r.step('tests').status, 'not_run')
  assert.match(r.step('tests').summary, /does not compile: .*error CS0103/)
  rmSync(root, { recursive: true, force: true })
})
