---
id: quality.requirement-story-test-traceability
title: Requirement, story and test traceability
summary: "Requirements are traced through to testing: Jira user stories, development tasks and Xray test cases keep a link back to the artifact they come from."
owner: "@e-pelivani"
status: draft
classification: internal
severity: medium
applies_to: [all]
standards: []
tags: [traceability, tracciabilita, requirement, requirements, requisito, requisiti, user-story, user-stories, jira, xray, test-case, test-cases, casi-di-test, link, collegamenti]
superseded_by: null
conflicts_with: []
---
## Rule

- Requirements are traced through to testing: Jira user stories, development tasks and Xray test cases keep a link
  back to the artifact they come from, so that coverage stays visible.
- Development tasks in Jira are linked to their user stories, and Xray test cases are linked to the issues they
  test.

## Scope

Requirements documents, functional analyses, Jira user stories and tasks, and Xray test cases of every product managed
in Jira.

## Rationale

Traceability from requirements down to testing keeps coverage visible: a requirement without a test is found before
release. The Quality Model places this traceability in the Analysis phase, the TS Quality Docs Pilot keeps a link from
every artifact back to its source document, and TS Xray Tests Import links test cases to the issues they test.

## Sources

- TeamSystem Quality Model, Confluence page 1815249278 (Group Technology space), section "Analysis".
- "Quality Model - SDLC", PDF attached to Confluence page 1815249278, slide "TS Quality Docs Pilot".
- "Quality Model - SDLC", PDF attached to Confluence page 1815249278, slide "Some Benefits of Templating".
- "QM - TS Xray Tests Import", Confluence page 1828519991, section "Automatic Issue Linking".
