---
id: quality.ready-requirement-before-test-generation
title: Ready requirement before test generation
summary: "A test is derived from a requirement only when the requirement states the expected outcome in checkable terms, in its acceptance criteria or in the Xray test case linked to it, and every expected value in the test is stated by the requirement or follows from its rule."
owner: "@e-pelivani"
status: draft
classification: internal
severity: high
applies_to: [all]
standards: []
tags: [requirement, requisito, requisiti, user-story, bug-report, bug, ticket, acceptance-criteria, criteri-di-accettazione, expected-outcome, risultato-atteso, expected-value, valore-atteso, test-generation, generazione-test, generated-test, test-generato, xray, test-case, jira]
superseded_by: null
conflicts_with: []
---
## Rule

- A test is derived from a requirement, a user story or a bug report only when that requirement states the expected outcome of the behaviour under test in checkable terms, a value, a state, an error or a displayed text, in its acceptance criteria or in the Xray test case linked to it.
- Every expected value in the derived test is stated by the requirement or follows from the rule the requirement states, applied to the test's inputs; a value taken from the code under test is not an expected value.

## Scope

Tests derived from a requirement tracked in Jira, in every TeamSystem product, whether a person or an AI agent produces them. Identifiers, timestamps and fixtures that the test infrastructure needs are test inputs, not expected values. The readiness of a user story for a sprint is the subject of `quality.definition-of-ready-gate`; this rule covers only what a requirement states before a test is derived from it.

## Rationale

A requirement that does not state its expected outcome yields a test that asserts a guess, and a green run on such a test confirms the guess rather than the requirement. When the guess is taken from the code under test, the test confirms the defect it was meant to catch, and that defect reaches production behind a green suite. The Quality Model starts quality at the requirement, with acceptance criteria written before development and test cases defined during analysis; the same bar applies before a test is derived from the requirement, by a person or by an agent.

## Non-compliant example

A bug report says that a stock report shows a wrong quantity for a product. A test derived from it expects 911, the quantity the report shows today, taken from the code; the test is green and the defect stays.

## Compliant example

The bug report states that the product master data holds 914 units and the report shows 911 for the same product and date. The derived test expects 914 from the report for that product and date.

## Sources

- No published text of the TeamSystem Quality Model states this rule yet. Proposed by a pilot team from its agentic testing pilot; the example pair comes from that pilot's runs. The rule stays a draft until the Quality Model states it.
- Related statements of the Quality Model: TeamSystem Quality Model, Confluence page 1815249278 (Group Technology space), sections "Foundations" (acceptance criteria written before development), "Analysis" (test cases defined during analysis) and "Testing" (AI-assisted generation); none states what a requirement holds before a test is derived from it.
