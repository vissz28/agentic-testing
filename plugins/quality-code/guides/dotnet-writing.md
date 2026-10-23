# Writing .NET tests from a ticket

The generic rules `/quality-code:spec` always follows for C# tests run with `dotnet test`. A layer's
own `guide` (set in `dotnet.layers`) adds the team's conventions on top of these and wins where they
differ.

## Framework

- **xUnit by default.** If the test project already uses NUnit (`[Test]`, `[TestFixture]`) or MSTest
  (`[TestMethod]`, `[TestClass]`), follow it: never add a second framework to a project.
- **FluentAssertions only if the project already references it** (`.Should()` in its tests or the
  package in its `.csproj`). Otherwise use the framework's own `Assert`.
- Never add a package, change a `.csproj` or a `Directory.Build.props` to make a test run.

## Shape

- Tests live in a test project next to the code, named after it with `.Tests`
  (`tests/Orders.Tests/Orders.Tests.csproj` for `src/Orders`). Write into the project the layer names;
  never create a test project.
- **One test class per ticket**, in a file named after the class (`LineTotalTests.cs`), in the
  project's namespace.
- **The ticket key goes in a comment line right above the class**: `// <KEY> <summary>`. C# has no
  title for a class, so this line is the block the checks look for. Attributes may sit between the
  comment and the class; nothing else may.
- One test method per scenario of the ticket, named after the scenario in plain words with
  underscores: `Rounds_a_total_of_10_005_up`.
- **One behaviour per test.** If a name needs "and", it is two tests.
- **Arrange, act, assert**, in that order, separated by a blank line. Arrange builds the input; act
  calls the code once; assert checks the result.

```csharp
using Orders;
using Xunit;

namespace Orders.Tests;

// ABC-123 Line totals round to the cent
public class LineTotalTests
{
    [Fact]
    public void Rounds_a_total_of_10_005_up()
    {
        var line = new Line(unitPrice: 3.335m, quantity: 3);

        var total = Pricing.LineTotal(line);

        Assert.Equal(10.01m, total);
    }
}
```

- The same scenario over a few rows of values is one `[Theory]` with `[InlineData]` (NUnit:
  `[TestCase]`, MSTest: `[DataTestMethod]` with `[DataRow]`), each row a value from the ticket.

## Expected values

- **Use the real expected values from the ticket**, written as the ticket writes them: the numbers and
  quoted texts from its Then / Expected lines go inside an assertion. The pipeline checks that every
  one of them is asserted.
- Never invent an expected value, and never compute it by calling the code under test.
- Money and quantities with decimals are `decimal` literals (`10.01m`), never `double`.
- Put the expected value where the framework wants it: `Assert.Equal(expected, actual)` (xUnit),
  `Assert.That(actual, Is.EqualTo(expected))` (NUnit), `Assert.AreEqual(expected, actual)` (MSTest),
  `actual.Should().Be(expected)` (FluentAssertions).
- Prefer the exact assertion: `Assert.Equal(42, count)` over `Assert.True(count > 0)`,
  `Assert.Equal("…", ex.Message)` after `Assert.Throws<…>` over the throw alone.
- A behaviour the ticket does not pin down is a skipped test with the ticket key in its reason
  (`[Fact(Skip = "ABC-124 rounding of negative totals not decided")]`, NUnit and MSTest
  `[Ignore("ABC-124 …")]`), never a guess.

## Mocks

- **Mock only I/O boundaries**: the database, HTTP clients, the file system, the clock, a message
  queue, a third-party SDK. Use the mocking library the project already has (Moq, NSubstitute,
  FakeItEasy) on the interface of that boundary only.
- Never mock the code under test or a pure helper it calls: the test must run the real logic.
- A new mock per test: no mock in a static field.

## Determinism

- **Time:** pass a fixed clock (`TimeProvider`, `FakeTimeProvider`, or the project's own `IClock`)
  set to a fixed instant (`new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero)`). Never read
  `DateTime.Now`, and never depend on the machine's time zone or culture: pass
  `CultureInfo.InvariantCulture` where the code formats or parses.
- **Random:** pass a seeded `new Random(42)` or a fixed value. No real random ids in an assertion.
- No order between tests: each test arranges its own data. No shared mutable state in static fields.
- No real network, no `Thread.Sleep` or `Task.Delay` waits: advance the fake clock instead.

## Never

- A `// <KEY>` comment that is not right above its class, or two classes for one ticket.
- A skip (`Skip =`, `[Ignore]`) without a ticket key in its reason, or a test with no assertion.
- An assertion that cannot fail: `Assert.True(true)`, or asserting the input you just built.
- `[Collection]` or test ordering tricks to make tests pass together.
- A change to application code, a `.csproj`, config or another team's test to make a test pass.
