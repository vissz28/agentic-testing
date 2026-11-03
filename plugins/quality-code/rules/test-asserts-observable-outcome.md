---
id: quality.test-asserts-observable-outcome
title: Every test asserts an observable outcome
summary: "Every test asserts at least one observable outcome of the code under test: a returned value, a stored state, an error, a displayed text, or an outbound call together with its arguments."
owner: "@e-pelivani"
status: draft
classification: internal
severity: high
applies_to: [all]
standards: []
tags: [test, tests, assertion, asserzione, asserzioni, assert, expect, hollow-test, test-vuoto, empty-test, observable-outcome, risultato-osservabile, mock, mocks, not-throw, outcome, esito]
superseded_by: null
conflicts_with: []
---
## Rule

- Every test asserts at least one observable outcome of the code under test: a returned value, a stored state, an error, a displayed text, or an outbound call together with its arguments.
- An assertion that a call did not throw, or that a mock was called without a check on its arguments, is not an assertion of an outcome where the requirement states a result.

## Scope

Unit, integration and end-to-end tests in every TeamSystem product, whoever writes them. The mocks and stubs of external dependencies that `quality.repeatable-isolated-tests` requires are where an outbound call is observed; the assertion is on the call and its arguments. A change to an existing test is the subject of `quality.test-weakening-justified`.

## Rationale

A suite is evidence for a merge only while each test can fail. A test with no assertion on an outcome passes whatever the code does, so the defect it was meant to catch reaches production behind a green suite. A suite produced by an agent is where such tests appear most, because the agent optimises for a green run; the rule holds for a hand-written test for the same reason.

## Non-compliant example

A test for the publication of a stock-changed event asserts only that the publisher's method did not throw.

## Compliant example

The same test asserts that the publisher was called once, with the product id, the location id and the new quantity.

## Sources

- No published text of the TeamSystem Quality Model states this rule yet. Proposed by a pilot team from its agentic testing pilot; the example pair comes from that pilot's runs. The rule stays a draft until the Quality Model states it.
- Related statement of the Quality Model: "QM - Quality Compliance AI Templates", Confluence page 1827078344, attachment develop-guidelines.md, section "Testing" (tests are isolated and use mocks or stubs for external dependencies); it does not state what a test asserts.
