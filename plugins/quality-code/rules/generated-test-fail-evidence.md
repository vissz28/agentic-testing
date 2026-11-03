---
id: quality.generated-test-fail-evidence
title: Fail evidence for generated tests
summary: "A test derived from a requirement enters the suite only with recorded evidence that it fails when the behaviour it checks is broken: a failing run on the code before a bug fix, or a run in which the test kills a mutant of the code under test. Coverage is not that evidence."
owner: "@e-pelivani"
status: draft
classification: internal
severity: high
applies_to: [all]
standards: []
tags: [test, tests, generated-test, test-generato, test-generati, derived-test, ai-generated, mutation, mutazione, mutation-testing, mutant, mutante, mutant-killed, mutante-ucciso, fail-first, red-first, evidence, evidenza, bug-fix, parent-commit, agent, agente]
superseded_by: null
conflicts_with: []
---
## Rule

- A test derived from a requirement enters the suite only with recorded evidence that it fails when the behaviour it checks is absent or broken.
- For a bug fix, the evidence is a run of the test on the code before the fix, in which the test fails.
- For any other change, the evidence is a run in which the test fails on a deliberate change to the code under test, a mutant of the behaviour the requirement states, or on the code with that behaviour removed.
- The merge request that adds the test holds the evidence.
- Line or branch coverage is not evidence that a test can fail.

## Scope

Unit, integration and end-to-end tests derived from a requirement or a bug report, in every TeamSystem product, whether a person or an AI agent produces them. The mutation tool and the job that runs a new test on the parent commit are the product's choice; the evidence is that tool's report, attached to or linked from the merge request.

## Rationale

A suite produced by an agent reaches a high coverage figure with tests that pass without checking anything, because the agent optimises for a green run. A test that has never failed carries no information about the defect it is meant to catch, and that defect reaches production behind a green suite. A failing run before the fix, and green runs that come from a change to the code rather than to the tests, are what a reviewer needs; the recorded evidence of a failing run is what makes that checkable after the fact.

## Non-compliant example

A merge request adds twelve derived tests for a stock calculation, with a coverage report as the only attachment. None of the tests was run on the code before the fix, and none was run against a mutant of the calculation.

## Compliant example

The same merge request links a run in which the three tests for the bug fail on the parent commit and pass on the fix, and a mutation report in which each of the nine other tests kills at least one mutant of the stock calculation.

## Sources

- No published text of the TeamSystem Quality Model states this rule yet. Proposed by a pilot team from its agentic testing pilot; the example pair comes from that pilot's runs. The rule stays a draft until the Quality Model states it.
- Related statement of the Quality Model: TeamSystem Quality Model, Confluence page 1815249278 (Group Technology space), section "Testing" (mutation testing as a testing paradigm; AI-assisted generation of tests); it does not state the fail evidence.
