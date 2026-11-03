---
id: quality.test-weakening-justified
title: Justified changes to existing tests
summary: "A change that loosens an assertion, removes a test or skips one carries, in the same merge request, the requirement change or the ticket that justifies it; a red suite otherwise turns green by a change to the code under test."
owner: "@e-pelivani"
status: draft
classification: internal
severity: high
applies_to: [all]
standards: []
tags: [test, tests, assertion, asserzione, skip, skipped-test, test-saltato, skip-test, removed-test, test-rimosso, loosened-assertion, green, verde, pipeline, red-suite, ticket, justification, giustificazione]
superseded_by: null
conflicts_with: []
---
## Rule

- A red suite turns green by a change to the code under test.
- A change that loosens an assertion, removes a test or skips one carries, in the same merge request, the requirement change or the ticket that justifies it; a skip names that ticket in its reason.

## Scope

Every change to a test file in every TeamSystem product, whoever makes it. A test removed together with the feature it covered, or corrected because it asserted a wrong value, is justified by the requirement or the ticket named in the change. What a test asserts in the first place is the subject of `quality.test-asserts-observable-outcome`.

## Rationale

An assertion loosened to make a run green, a test deleted, or a skip added without a ticket turns the suite into a record of what the team wanted to see rather than what the code does, and the defect the test caught reaches production. The justification in the same merge request is what lets a reviewer tell a corrected test from a silenced one on the diff.

## Non-compliant example

A merge request turns a red pipeline green by changing an assertion on the stock quantity from an exact value to a check that the value is a number, with no ticket or requirement change named.

## Compliant example

The same merge request fixes the rounding in the stock calculation; the assertion on the exact quantity is unchanged and now passes.

## Sources

- No published text of the TeamSystem Quality Model states this rule yet. Proposed by a pilot team from its agentic testing pilot; the example pair comes from that pilot's runs. The rule stays a draft until the Quality Model states it.
- Related statement of the Quality Model: TeamSystem Quality Model, Confluence page 1815249278 (Group Technology space), section "Development"; it does not state how a change to a test is justified.
