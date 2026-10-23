// The .NET dialect: C# tests in xUnit, NUnit and MSTest, assertions in their own styles and in
// FluentAssertions, as the shared checks read them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { classesOf, countAssertions, flipMutations } from '../../../lib/base/dialects/dotnet.mjs'
import { anchorRange, grade, groups, scoreSpec } from '../../../lib/pipeline/checks/suite-honesty.mjs'
import { findExpectRanges, planMutants, unmutated } from '../../../lib/pipeline/checks/mutation.mjs'
import { scanDiff } from '../../../lib/pipeline/checks/honesty.mjs'
import { run as expectedRun, surface } from '../../../lib/pipeline/checks/expected.mjs'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const D = dialectFor('dotnet')

const XUNIT = `using Xunit;

namespace Demo.Tests;

// ABC-12 Line totals round to the cent
[Trait("Layer", "unit")]
public class PricingTests
{
    [Fact]
    public void Rounds_a_total_of_10_005_up()
    {
        var total = Pricing.LineTotal(3.335m, 3);

        Assert.Equal(10.01m, total);
    }

    [Fact(Skip = "ABC-13 not decided")]
    public void Later() { Assert.True(false); }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(2, 4)]
    public async Task Doubles(int quantity, int expected)
    {
        var result = await Pricing.DoubleAsync(quantity);

        result.Should().Be(expected);
    }

    [Fact]
    public void Hollow()
    {
        var total = Pricing.LineTotal(1m, 1);
        // Assert.Equal(1m, total);
        Log("Assert.Equal(1, 2)");
    }
}

public class HelperTests
{
    [Fact]
    public void Elsewhere() { Assert.NotNull(Pricing.Default); }
}
`

const NUNIT = `using NUnit.Framework;

namespace Demo.Stock.Tests
{
    /// <summary>
    /// ABC-20 Stock moves refuse negative quantities
    /// </summary>
    [TestFixture]
    public sealed class StockTests
    {
        [TestCase("A-1", 3)]
        [TestCase("B-2", 5)]
        public void Moves_stock(string sku, int quantity)
        {
            Assert.That(Stock.Move(sku, quantity).Quantity, Is.EqualTo(quantity));
        }

        [Test]
        [Ignore("ABC-21 waiting for the rule")]
        public void Ignored_case() { Assert.That(1, Is.EqualTo(2)); }

        [Test]
        public void Refuses_a_negative_move()
        {
            var ex = Assert.Throws<ArgumentException>(() => Stock.Move("A-1", -1));
            Assert.That(ex.Message, Is.EqualTo("quantity must be 1 or more"));
            Assert.That(Stock.Count, Is.Not.Null);
            ClassicAssert.AreEqual(0, Stock.Count);
        }
    }
}
`

const MSTEST = `using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Demo.Orders.Tests;

/// <summary>ABC-30 Order totals</summary>
[TestClass]
public class OrderTests
{
    [TestMethod]
    public void Sums_the_lines()
    {
        Assert.AreEqual(108, Orders.Total(new[] { 40, 40, 40 }));
        Assert.IsTrue(Orders.Valid);
        CollectionAssert.Contains(Orders.Skus, "A-1");
    }

    [DataTestMethod]
    [DataRow(1, 2)]
    [Ignore]
    public void Not_yet(int a, int b) { Assert.AreEqual(b, a * 2); }
}
`

test('groups: a test class, titled by the key comment above it (attributes and doc lines between), else by its name', () => {
  assert.deepEqual(groups(XUNIT, D).map(g => g.title), ['ABC-12 Line totals round to the cent', 'HelperTests'])
  assert.deepEqual(groups(NUNIT, D).map(g => g.title), ['ABC-20 Stock moves refuse negative quantities'])
  assert.deepEqual(groups(MSTEST, D).map(g => g.title), ['ABC-30 Order totals'])
  assert.deepEqual(classesOf(XUNIT).map(c => [c.fqn, c.title]), [['Demo.Tests.PricingTests', 'ABC-12 Line totals round to the cent'], ['Demo.Tests.HelperTests', 'HelperTests']])
  assert.deepEqual(classesOf(NUNIT).map(c => c.fqn), ['Demo.Stock.Tests.StockTests'])
  // A comment that is no key does not title a class; a key comment with no class under it is no group.
  const plain = '// helpers for the tests\npublic static class Fixtures { }\n\n// ABC-1 orphan\n\nnamespace X { }\n'
  assert.deepEqual(groups(plain, D).map(g => g.title), ['Fixtures'])
  // A generic class, a record, a partial class.
  assert.deepEqual(groups('public partial class A<T> where T : new() { }\ninternal sealed record B(int X);\n', D).map(g => g.title), ['A', 'B'])
})

test('the key block: from the key comment to the next class', () => {
  const r = anchorRange(XUNIT, 'ABC-12', D)
  assert.equal(r[0], XUNIT.indexOf('// ABC-12'))
  assert.equal(r[1], XUNIT.indexOf('public class HelperTests'))
  assert.equal(anchorRange(XUNIT, 'ABC-1', D), null, 'ABC-1 is not ABC-12')
  assert.ok(anchorRange(NUNIT, 'ABC-20', D))
  assert.ok(anchorRange(MSTEST, 'ABC-30', D))
})

test('test marks: Fact, Theory, Test, TestCase, TestMethod, DataTestMethod; Skip = and [Ignore] are skips', () => {
  assert.deepEqual(scoreSpec(XUNIT, D).map(t => [t.title, t.mod, t.expects]), [
    ['Rounds_a_total_of_10_005_up', null, 1], ['Later', 'skip', 1], ['Doubles', null, 1], ['Hollow', null, 0], ['Elsewhere', null, 1],
  ])
  assert.deepEqual(scoreSpec(NUNIT, D).map(t => [t.title, t.mod, t.expects]), [
    ['Moves_stock', null, 1], ['Ignored_case', 'skip', 1], ['Refuses_a_negative_move', null, 4],
  ])
  assert.deepEqual(scoreSpec(MSTEST, D).map(t => [t.title, t.mod, t.expects]), [['Sums_the_lines', null, 3], ['Not_yet', 'skip', 1]])
  // A test fixture's or a class's attribute is no test; nor a test word in a string.
  assert.deepEqual(scoreSpec('[TestFixture]\npublic class T\n{\n    [Category("Test")]\n    public void Helper() { }\n}\n', D), [])
})

test('suite honesty: the hollow test fails the check; comments and strings are no assertion', () => {
  const r = grade([{ path: 'tests/Demo.Tests/PricingTests.cs', src: XUNIT }], { key: 'ABC-12' }, D)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings.map(f => f.test), ['Hollow'])
  assert.equal(countAssertions('var s = @"Assert.Equal(1, 2) "" x"; /* Assert.True(x) */ mock.Verify(m => m.Save(), Times.Once()); x.Should().BeTrue();'), 2)
  assert.equal(countAssertions('Assert.Multiple(() => { Assert.That(a, Is.EqualTo(1)); }); Assert.Fail("no");'), 1)
})

test('assertion ranges: Assert calls with generics and a Should() chain; not in a line comment', () => {
  const src = 'Log("Assert.Equal(1, 2)"); var ex = Assert.Throws<ArgumentException>(() => Do(-1));\n// Assert.Equal(1, 2);\ntotal.Should().Be(10).And.NotBe(0);\nAssert.Multiple(() => {});\n'
  assert.deepEqual(findExpectRanges(src, D).map(r => src.slice(r.start, r.end).trim()), [
    'Assert.Throws<ArgumentException>(() => Do(-1));', '.Should().Be(10).And.NotBe(0);',
  ])
})

const flips = s => flipMutations(s).map(f => [f.kind, f.text])

test('flips: xUnit and MSTest method pairs, true and false, the expected number and text', () => {
  assert.deepEqual(flips('Assert.Equal(10.01m, total);'), [['invert-assert', 'Assert.NotEqual(10.01m, total);'], ['num→n+1', 'Assert.Equal(11.01m, total);']])
  assert.deepEqual(flips('Assert.NotNull(order);'), [['invert-assert', 'Assert.Null(order);']])
  assert.deepEqual(flips('Assert.True(order.Valid);'), [['true→false', 'Assert.False(order.Valid);']])
  assert.deepEqual(flips('Assert.Contains("A-1", skus);'), [['invert-assert', 'Assert.DoesNotContain("A-1", skus);'], ['corrupt-string', 'Assert.Contains("A-1★MUT", skus);']])
  assert.deepEqual(flips('Assert.AreEqual(108, Orders.Total(new[] { 40, 40, 40 }));'), [['invert-assert', 'Assert.AreNotEqual(108, Orders.Total(new[] { 40, 40, 40 }));'], ['num→n+1', 'Assert.AreEqual(109, Orders.Total(new[] { 40, 40, 40 }));']])
  assert.deepEqual(flips('Assert.IsFalse(x);'), [['false→true', 'Assert.IsTrue(x);']])
  assert.deepEqual(flips('CollectionAssert.Contains(skus, "A-1");'), [['invert-assert', 'CollectionAssert.DoesNotContain(skus, "A-1");'], ['corrupt-string', 'CollectionAssert.Contains(skus, "A-1★MUT");']])
  // The actual value's numbers are inputs, never mutated: Assert.Single has no twin and no expected value.
  assert.deepEqual(flips('Assert.Single(Orders.For(42));'), [])
})

test('flips: NUnit constraints', () => {
  assert.deepEqual(flips('Assert.That(total, Is.EqualTo(5));'), [['add-not', 'Assert.That(total, Is.Not.EqualTo(5));'], ['num→n+1', 'Assert.That(total, Is.EqualTo(6));']])
  assert.deepEqual(flips('Assert.That(x, Is.Not.Null);'), [['drop-not', 'Assert.That(x, Is.Null);']])
  assert.deepEqual(flips('Assert.That(ok, Is.True);'), [['true→false', 'Assert.That(ok, Is.False);']])
  assert.deepEqual(flips('Assert.That(name, Does.Contain("pallet"));'), [['add-not', 'Assert.That(name, Does.Not.Contain("pallet"));'], ['corrupt-string', 'Assert.That(name, Does.Contain("pallet★MUT"));']])
  assert.deepEqual(flips('ClassicAssert.AreEqual(0, count);'), [['invert-assert', 'ClassicAssert.AreNotEqual(0, count);'], ['num→n+1', 'ClassicAssert.AreEqual(1, count);']])
})

test('flips: FluentAssertions', () => {
  assert.deepEqual(flips('.Should().Be(10);'), [['invert-should', '.Should().NotBe(10);'], ['num→n+1', '.Should().Be(11);']])
  assert.deepEqual(flips('.Should().BeTrue();'), [['true→false', '.Should().BeFalse();']])
  assert.deepEqual(flips('.Should().NotBeNull();'), [['invert-should', '.Should().BeNull();']])
  assert.deepEqual(flips('.Should().Contain("A-1");'), [['invert-should', '.Should().NotContain("A-1");'], ['corrupt-string', '.Should().Contain("A-1★MUT");']])
  assert.deepEqual(flips('.Should().HaveCount(3);'), [['invert-should', '.Should().NotHaveCount(3);'], ['num→n+1', '.Should().HaveCount(4);']])
  assert.deepEqual(flips('.Should().BeGreaterThan(0);'), [['num→n+1', '.Should().BeGreaterThan(1);']])
})

test('plan: one mutant per assertion (the strongest), green tests only, inside the key block; in place', () => {
  assert.equal(D.mutation.inPlace, true)
  const passed = ['Rounds_a_total_of_10_005_up', 'Doubles', 'Hollow', 'Elsewhere', 'Later']
  const plan = planMutants(XUNIT, passed, { key: 'ABC-12' }, D)
  assert.deepEqual(plan.map(m => [m.title, m.kind, m.replacement]), [
    ['Rounds_a_total_of_10_005_up', 'invert-assert', 'Assert.NotEqual(10.01m, total);'],
    ['Doubles', 'invert-should', '.Should().NotBe(expected);'],
  ])
  assert.equal(planMutants(XUNIT, passed, { key: 'ABC-12', thorough: true }, D).length, 3)
  // The hollow test passes with nothing to mutate: it keeps the step from passing.
  assert.deepEqual(unmutated(XUNIT, passed, plan, { key: 'ABC-12' }, D), ['Hollow'])
  assert.equal(planMutants(XUNIT, passed, { key: 'ABC-99' }, D), null)
  const nunit = planMutants(NUNIT, ['Moves_stock', 'Refuses_a_negative_move', 'Ignored_case'], { key: 'ABC-20' }, D)
  assert.deepEqual(nunit.map(m => m.kind), ['add-not', 'add-not', 'drop-not', 'invert-assert'])
  assert.ok(nunit.every(m => m.title !== 'Ignored_case'))
})

test('honesty: a removed assertion, a removed test, a new skip without a ticket', () => {
  const diff = [
    '+++ b/tests/Demo.Tests/PricingTests.cs',
    '-        Assert.Equal(10.01m, total);',
    '-        total.Should().Be(10);',
    '-    [Fact]',
    '-    [TestCase(1, 2)]',
    '+    [Fact(Skip = "flaky on CI")]',
    '+    [Ignore("later")]',
    '+    [Fact(Skip = "ABC-13 not decided")]',
    '+        Assert.Equal(10.02m, total);',
  ].join('\n')
  const v = scanDiff(diff, D, '(?:ABC)-\\d+', { redTags: [] })
  assert.deepEqual(v.map(x => [x.kind, x.line]), [
    ['assertion removed', 'Assert.Equal(10.01m, total);'],
    ['assertion removed', 'total.Should().Be(10);'],
    ['test removed', '[Fact]'],
    ['test removed', '[TestCase(1, 2)]'],
    ['test newly skipped', '[Fact(Skip = "flaky on CI")]'],
    ['test newly skipped', '[Ignore("later")]'],
  ])
})

test('expected values: read in the assertion\'s arguments inside the key block', () => {
  const s = surface(MSTEST, 'ABC-30', D)
  assert.match(s, /108/)
  assert.match(s, /"A-1"/)
  assert.equal(surface(MSTEST, 'ABC-31', D), null)
  assert.match(surface(NUNIT, 'ABC-20', D), /quantity must be 1 or more/)
  // A decimal's suffix is read off: 10.01m is the ticket's 10.01.
  assert.match(surface(XUNIT, 'ABC-12', D), /10\.01(?!m)/)
})

test('the value check passes on decimal literals and names what a C# block leaves out', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-dotnet-expected-'))
  writeFileSync(join(d, 'PricingTests.cs'), XUNIT)
  const ticket = then => ({ key: 'ABC-12', summary: 'Line totals', text: { description: '', acField: `Scenario: rounding\nGiven a line of 3.335 x 3\nWhen the total is computed\n${then}` } })
  const ctx = { root: d, dialect: D, config: { languages: ['en'] } }
  const ok = expectedRun({ specs: ['PricingTests.cs'], key: 'ABC-12', ticket: ticket('Then the total is 10.01') }, ctx)
  assert.equal(ok.status, 'pass', ok.summary)
  const missing = expectedRun({ specs: ['PricingTests.cs'], key: 'ABC-12', ticket: ticket('Then the total is 10.02') }, ctx)
  assert.equal(missing.status, 'fail')
  assert.deepEqual(missing.data.missing, ['10.02'])
})

test('the writing guide\'s example is a spec the checks read: one key block, one test, one assertion, one mutant', () => {
  const guide = readFileSync(new URL('../../../guides/dotnet-writing.md', import.meta.url), 'utf8')
  const src = /```csharp\n([\s\S]*?)```/.exec(guide)[1]
  assert.deepEqual(groups(src, D).map(g => g.title), ['ABC-123 Line totals round to the cent'])
  assert.deepEqual(scoreSpec(src, D).map(t => [t.title, t.mod, t.expects]), [['Rounds_a_total_of_10_005_up', null, 1]])
  assert.deepEqual(planMutants(src, ['Rounds_a_total_of_10_005_up'], { key: 'ABC-123' }, D).map(m => m.kind), ['invert-assert'])
})
