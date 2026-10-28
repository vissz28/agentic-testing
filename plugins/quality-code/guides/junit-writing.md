# Writing JUnit tests from a ticket

The generic rules `/quality-code:spec` always follows for Java and Kotlin with JUnit 5 (JUnit 4 is
read too). A layer's own `guide` (set in `junit.layers`) adds the team's conventions on top of these
and wins where they differ.

## Shape

- **File and class:** one test class per ticket and layer, named after the subject it tests:
  `<Subject>Test.java` (or `.kt`), never the ticket key in the name (`LineTotalTest`, not
  `Abc123Test`). It goes in `src/test/java/` (or `src/test/kotlin/`), in the same package as the
  code under test, so the folders mirror the package.
- **The ticket key goes on the class:** `@DisplayName("<KEY> <summary>")` on the top-level class.
  This is the ticket's block: the pipeline finds the tests of a ticket by that display name. A class
  without it has no block.
- **One `@Test` per scenario**, its `@DisplayName` the scenario in plain words. The method name says
  the same in camelCase (Kotlin may use a `` `name with spaces` ``). The method name is what the
  pipeline reports, so keep method names unique within the class.
- **One behaviour per test.** If a test needs "and" in its name, it is two tests.
- **Arrange, act, assert**, in that order, separated by a blank line. Arrange builds the input; act
  calls the code once; assert checks the result.
- `@Nested` classes may group scenarios inside the ticket's class. `@ParameterizedTest` is one test
  for every row: use it when the rows are the ticket's own examples.

```java
package com.example.pricing;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("ABC-123 Line totals round to the cent")
class LineTotalTest {

  @Test
  @DisplayName("rounds a total of 10.005 up to 10.01")
  void roundsHalfACentUp() {
    var line = new Line(new BigDecimal("3.335"), 3);

    var total = LineTotal.of(line);

    assertThat(total).isEqualByComparingTo("10.01");
  }
}
```

## Assertions

- **AssertJ** (`assertThat(x).isEqualTo(…)`) or **JUnit** (`assertEquals(expected, actual)`). Hamcrest
  (`assertThat(x, is(…))`), kotlin.test and kotest are read too.
- Every test ends in an assertion that can fail. A bare `assertThat(total)` with no matcher asserts
  nothing, and `assumeTrue(…)` only skips: neither counts.
- With `assertEquals`, the expected value comes first: `assertEquals(1350, total)`.
- With kotest, call the matcher with a dot when the value comes from the ticket:
  `total.shouldBe(108)`. The value check reads call arguments.
- Exceptions: `assertThrows(IllegalArgumentException.class, () -> …)`, then assert the message if
  the ticket states it.

## Expected values

- **Use the real expected values from the ticket**, written as the ticket writes them: the numbers and
  quoted texts from its Then / Expected lines go inside an assertion. The pipeline checks that every
  one of them is asserted.
- Never invent an expected value, and never compute it by calling the code under test.
- Prefer the exact matcher: `isEqualTo(42)` over `isPositive()`, `containsExactly(…)` over
  `isNotEmpty()`, `hasMessage("the message")` over `isInstanceOf(…)` alone.
- Money and decimals: `BigDecimal` with `isEqualByComparingTo("10.01")`, never `double` equality.

## Mocks

- **Mock only I/O boundaries**: the network, the database, the file system, the clock, a message
  queue, a third-party client. Mockito `@Mock` on that boundary only.
- **The integration layer uses the real database.** When the project starts databases in containers
  (`org.testcontainers` in its build, `@Testcontainers` and `@Container` or `@ServiceConnection`), the
  tests of its integration layer use the project's container setup (copy a test already there) and
  never mock the repository or the database: arrange the rows the test needs, and assert what the
  code reads or writes there. Unit tests keep their Mockito mocks.
- Never mock the class under test or a pure helper it calls: the test must run the real logic.
- **No Mockito-only test:** a test whose only check is `verify(…)` shows a call happened, not that the
  result is right. Assert the returned value or the saved state as well. The pipeline's mutation step
  cannot change a `verify`, so such a test leaves the step unverified.

## Not pinned down, skipped

- A behaviour the ticket does not pin down is a test marked `@Disabled("TODO: <what is missing>")`,
  never a guess. It counts as not written yet.
- Any other `@Disabled` or `@Ignore` is a skip, and needs another ticket's key in its reason:
  `@Disabled("ABC-456 waits for the price list")`. So do `@EnabledIf…`, `@DisabledOn…` and
  assumptions.

## Determinism

- **Time:** pass a `Clock` (`Clock.fixed(Instant.parse("2026-01-15T10:00:00Z"), ZoneOffset.UTC)`) to
  the code; never read `LocalDate.now()` in a test.
- **Random:** a seeded `Random`, or a fixed value passed in. No real random ids in an assertion.
- No order between tests (`@TestMethodOrder` is not a fix): each test arranges its own data. No shared
  mutable `static` state.
- No real network, no `Thread.sleep`.

## Kotlin

- The same rules; `@DisplayName("<KEY> <summary>")` on the class, `@Test fun`.
- Backtick names are fine: ``fun `rounds 10.005 up to 10.01`()``.
- kotlin.test (`assertEquals`, `assertFailsWith<…> { }`) and kotest matchers inside JUnit 5 tests
  are read; kotest's own spec styles (`StringSpec`, `FunSpec`) are not.

## How the pipeline runs them

- Maven (`./mvnw` when the project has it, else `mvn`) or Gradle (`./gradlew`, else `gradle`), in
  the module whose `pom.xml` or `build.gradle(.kts)` is nearest above the spec. The build output stays
  in `target/` or `build/`.
- A spec that does not compile is never a pass: the tests step says it never ran, with the
  compiler's first error.
- Mutation changes each assertion in the spec itself (a copy would be a duplicate class) and always
  puts the file back.
- `junit.command` overrides the command: a template with `{test}` (the build tool's own filter:
  `-Dtest=…` for Maven, `--tests …` for Gradle), `{files}` and `{report}` (a folder for the JUnit XML
  reports; left out, the build's own report folder is read).

## Never

- A change to application code, the build file or another team's test to make a test pass.
- An assertion that cannot fail: `assertTrue(true)`, or asserting the input you just built.
- A test with no assertion, or one that catches the exception it should let fail.
