# Writing Go tests from a ticket

The generic rules `/quality-code:spec` always follows for a Go backend (`go test`). A layer's own
`guide` (set in `go.layers`) adds the team's conventions on top of these and wins where they differ.
The pipeline reads the tests with simple rules: a test written another way may run, but the checks
cannot grade it, and the step stays "not verified".

## Shape

- A `*_test.go` file **beside the code it tests**, in the same package (`package orders`), or in the
  external test package (`package orders_test`) when the test needs only the exported API.
- **The ticket's block is one test function whose doc comment starts with the key**:
  `// <KEY> <summary>` right above `func TestXxx(t *testing.T)`, with no blank line between. Everything
  for the ticket goes inside that function. Another ticket gets its own function.
- **One `t.Run` per scenario, its name a string literal** that says the scenario in plain words:
  `t.Run("stock of 4 reorders", …)`. Each literal `t.Run` is one test for the pipeline: it is run,
  graded and mutated alone. Keep them one level deep: a `t.Run` inside a `t.Run` is part of its parent.
- No `/` in a scenario name (`go test` reads it as a level), and no two scenarios with the same name.
- **One behaviour per `t.Run`.** If a name needs "and", it is two scenarios.
- **Arrange, act, assert**, in that order, separated by a blank line.

```go
package orders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ABC-123 Reorder when the stock falls below the threshold
func TestReorder(t *testing.T) {
	t.Run("a stock of 4 orders 20 more", func(t *testing.T) {
		item := Item{SKU: "A-1", Stock: 4, Threshold: 5}

		got := ReorderQuantity(item)

		assert.Equal(t, 20, got)
	})

	t.Run("a stock of 5 orders nothing", func(t *testing.T) {
		item := Item{SKU: "A-1", Stock: 5, Threshold: 5}

		if got := ReorderQuantity(item); got != 0 {
			t.Errorf("ReorderQuantity = %d, want 0", got)
		}
	})
}
```

## Table-driven tests

- Allowed, with a `name` field per case used in `t.Run(tc.name, …)`. The pipeline cannot read a
  name that is a variable, so the table runs, is graded and is mutated as **one** test: put it in a
  literal `t.Run` of the key's function, named after the scenario the cases share. A failing case
  fails that scenario.
- The key's block is one function: a second function with the same key in its doc comment is not
  read as the ticket's. All of the ticket's scenarios go in that one function.

```go
// ABC-124 VAT rounds half a cent up
func TestVAT(t *testing.T) {
	t.Run("half a cent rounds up", func(t *testing.T) {
		cases := []struct {
			name string
			net  string
			want string
		}{
			{name: "10.05 at 22%", net: "10.05", want: "2.21"},
			{name: "0.10 at 22%", net: "0.10", want: "0.02"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				got := VAT(Money(tc.net), Rate22)

				assert.Equal(t, tc.want, got.String())
			})
		}
	})
}
```

## Expected values

- **Use the real expected values from the ticket**, written as the ticket writes them, inside the
  assertion: the second argument of a testify call (`assert.Equal(t, 108, got)`), or the right side
  of the comparison in `if got != 108 { t.Errorf(…) }`. The pipeline checks that every number and
  quoted text of the ticket's Then / Expected lines is there. A `want` variable set three lines
  above is not read: write the value in the assertion.
- Never invent an expected value, and never compute it by calling the code under test.
- Assertions the pipeline reads: **testify** `assert.*` and `require.*` (`Equal`, `NotEqual`,
  `EqualValues`, `True`, `False`, `Nil`, `NotNil`, `Contains`, `Len`, `ErrorIs`, `NoError`, …), and
  **plain Go** `if <comparison> { t.Errorf(…) }` / `t.Fatalf(…)`, with the report directly in the
  `if` block. `cmp.Diff` works the same way: `if diff := cmp.Diff(want, got); diff != "" { t.Errorf(…) }`.
- Not read: `a := assert.New(t); a.Equal(…)`, helper functions that hide the `t.Errorf`, gomega,
  custom checkers. A scenario with no assertion the pipeline reads is "not mutated" and the run is
  not verified.
- Prefer the exact check: `assert.Equal(t, 42, got)` over `assert.Greater(t, got, 0)`,
  `assert.ErrorIs(t, err, ErrNoStock)` over `assert.Error(t, err)`.
- A behaviour the ticket does not pin down is a scenario whose body is only
  `t.Skip("todo: <what is missing>")`: the pipeline counts it as not written yet, never a guess.

## Fakes

- **Fake only I/O boundaries**: the network, the database, the file system, the clock, a message
  queue, a third-party SDK. Pass the fake through the interface the code already takes; no
  monkey-patching of package variables the code under test owns.
- Never fake the code under test or a pure helper it calls: the test must run the real logic.
- **No network**: no real HTTP call, no real database. `httptest.NewServer` is a fake of the
  boundary and is fine.

## Determinism

- **Time:** pass a fixed `time.Time` (`time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)`) or a clock
  interface; never `time.Now()` in a value the test asserts, never the machine's time zone.
- **Random:** a seeded source (`rand.New(rand.NewSource(42))`) or a fixed generator. No random ids in
  an assertion.
- No order between scenarios and no shared mutable package state: each `t.Run` arranges its own data.
  `t.Parallel()` is fine when the scenarios share nothing.
- No sleeps: wait on a channel or a fake clock instead.

## Never

- `t.Skip` without a ticket key in its message (`t.Skip("ABC-9 flaky on CI")` is tracked), except the
  `t.Skip("todo: …")` above.
- A scenario with no assertion, or an assertion that cannot fail: `assert.True(t, true)`, or
  asserting the input you just built.
- `if err != nil { t.Fatal(err) }` as the only check of a scenario whose ticket names a value: it
  shows the call did not fail, not that it did the right thing.
- A change to application code, `go.mod`, build tags or another team's test to make a test pass.
