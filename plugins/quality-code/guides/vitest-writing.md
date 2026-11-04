# Writing Vitest tests from a ticket

## Project conventions come first

When the project already has tests, follow its own naming, folders, base classes, annotations, assertion style and helpers: they win over everything below about how a test looks. This guide only fills what the project does not decide: what a test must check, mutation and the rules. Read the nearest specs first (`FLOW_JSON` from `ticket.mjs config flow` lists the detected naming and style).

The generic rules `/quality-code:spec` always follows. A layer's own `guide` (set in
`vitest.layers`) adds the team's conventions on top of these and wins where they differ.

## Shape

- One spec file per layer, all its tests inside one top-level `describe('<KEY> <summary>', …)` block.
- One `it` per scenario of the ticket, named after the scenario in plain words.
- **One behaviour per `it`.** If a test needs "and" in its name, it is two tests.
- **Arrange, act, assert**, in that order, separated by a blank line. Arrange builds the input; act
  calls the code once; assert checks the result.

```ts
import { describe, expect, it } from 'vitest'
import { lineTotal } from '../src/pricing'

describe('ABC-123 Line totals round to the cent', () => {
  it('rounds a total of 10.005 up to 10.01', () => {
    const line = { unitPrice: 3.335, quantity: 3 }

    const total = lineTotal(line)

    expect(total).toBe(10.01)
  })
})
```

## Expected values

- **Use the real expected values from the ticket**, written as the ticket writes them: the numbers and
  quoted texts from its Then / Expected lines go inside an `expect(...)`. The pipeline checks that
  every one of them is asserted.
- Never invent an expected value, and never compute it by calling the code under test.
- No snapshot for values: `toMatchSnapshot` and `toMatchInlineSnapshot` record whatever the code
  returns. Assert the value itself with `toBe`, `toEqual` or `toStrictEqual`.
- Prefer the exact matcher: `toBe(42)` over `toBeGreaterThan(0)`, `toEqual({ … })` over
  `toBeDefined()`, `toThrow('the message')` over `toThrow()`.
- A behaviour the ticket does not pin down is an `it.todo('…')`, never a guess.

## Mocks

- **Mock only I/O boundaries**: the network, the database, the file system, the clock, a message
  queue, a third-party SDK. Use `vi.mock` or `vi.spyOn` on that boundary module only.
- **The integration layer uses the real database.** When the project starts databases in containers
  (Testcontainers: the `integration` layer setup adds, or the project's own container helper), the
  specs of that layer never mock the database: connect the code to the address its helper gives
  (`postgresUrl()` from `test/integration/databases`, or the team's own), arrange the rows the test
  needs, and assert what the code reads or writes there. Unit specs keep mocking it.
- Never mock the code under test or a pure helper it calls: the test must run the real logic.
- Restore mocks after each test (`vi.restoreAllMocks()` in `afterEach`, or `restoreMocks` in the
  Vitest config).

## Determinism

- **Time:** `vi.useFakeTimers()` and `vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))` before the
  act; `vi.useRealTimers()` in `afterEach`. Never depend on today's date or the time zone of the
  machine.
- **Random:** pass a seeded value or a fixed generator, or `vi.spyOn(Math, 'random').mockReturnValue(0.42)`.
  No real random ids in an assertion.
- No order between tests: each `it` arranges its own data. No shared mutable state at the top of the
  file.
- No real network, no sleeps (`setTimeout` waits): advance fake timers instead.

## Negative tests

Each input or action gets its negative cases, only from what the ticket names: a wrong type, an empty required field, a value over a stated limit, a call that fails, a role that is refused. Assert the rejection the ticket states (the error type, the message, the status), never a guess. A limit, message or role the ticket does not name gets no test; ask.

## Never

- `.only` (`it.only`, `describe.only`): it silently drops every other test.
- `.skip` without a ticket key in its title, or an empty `it` with no `expect`.
- An `expect` that cannot fail: `expect(true).toBe(true)`, or asserting the input you just built.
- A change to application code, config or another team's test to make a test pass.

## Frontend unit tests

For a frontend feature whose approach is `unit` or `both` (`features[].approach`): the unit under test is a component, a hook or a helper of the screen, not the running app.

- Use what the project already has: its component testing library (Testing Library with `@testing-library/react`, `vue`, `angular`... when it is in `package.json`) and its Vitest environment (`jsdom` or `happy-dom`). Do not add a library.
- Find elements as a user does: by role, label or visible text. Never by class name, test id invented for the test, or component internals.
- Assert what the user sees or what the component calls: rendered text and values, a disabled button, a callback called with the ticket's value. Not state, not the number of renders.
- Fake only what leaves the component: the network (`fetch`, the API client), the router, the clock. Render the real child components.
- One behaviour per test, with the ticket's real numbers and texts, as for any Vitest test above.
- A team guide for the feature (`features[].guide`) is read first and wins where it differs from this one.

## Other runners (Jest, Mocha, node --test)

With `runners.unit` in the config, these rules hold in that runner's own syntax. Copy the specs already
there for imports and setup.

- **Jest:** `jest.fn`, `jest.mock`, `jest.spyOn` and `jest.restoreAllMocks()`; `jest.useFakeTimers()` and
  `jest.setSystemTime(new Date('2026-01-15T10:00:00Z'))`. The matchers are the ones above.
- **Mocha:** Chai's `expect(total).to.equal(108)`, `.to.deep.equal({ … })` for an object, `.to.throw('the
  message')`, and the stub library the repo already uses (often Sinon). Mocha has no `it.todo`: a
  behaviour the ticket does not pin down gets no test.
- **node --test:** `import { describe, it, mock } from 'node:test'` and `import assert from
  'node:assert/strict'`: `assert.strictEqual(total, 108)`, `assert.deepStrictEqual(row, { … })`,
  `assert.throws(() => …, /the message/)`. Mocks with `mock.fn()` and `mock.method()`, time with
  `mock.timers`; `it.todo` for a behaviour the ticket does not pin down. Name the file `.test.js` (or
  `.test.ts`): Node's own run finds only those.
