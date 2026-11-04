# Smoke tests: the critical few

Used by `/quality-code:spec` (Playwright) and read by `/quality-code:run-smoke`. A smoke suite is the handful of tests that must pass on any environment, in seconds: can a user get in, see the main screen, do the one thing the product exists for. The tag is `@smoke`.

## At the plan card (spec, Playwright only)

- When the plan has two or more scenarios, add one line to the plan card under the scenarios: `Smoke (critical, run on every deploy)  <none yet>`. After the answer `1. Yes, write these tests`, ask once with the AskUserQuestion picker, multi-select: `Which of these are critical enough to run on every deploy (@smoke)?` with each scenario as an option and `None` as the last. Skip the question with `--ci` (no tag) and for Cypress (it has no tags).
- Suggest at most two, never more than a third of the scenarios: the ones that open the main screen or finish the main action. Never suggest an `Extra:` probe. The person decides.
- Tag each picked test on its own `test(` line, in its tag list: `test('<scenario>', { tag: '@smoke' }, …)`, or add `'@smoke'` to the list step 6 writes (`{ tag: ['@anchor', '@<KEY>', '@smoke'] }`). Keep the tag list on the `test(` line. A scenario that is `test.fixme` is never tagged.
- Say nothing else about it: one line in the wrap-up, `Smoke: <n> test(s) tagged @smoke; run them with /quality-code:run-smoke`.

## What a smoke run is

`/quality-code:run-smoke [--url U]` runs only the tests that carry `@smoke` (Playwright `--grep @smoke`), against the running app or the URL given. It reads the app and writes nothing: the plugin creates, changes and deletes no data, so the tagged tests themselves must be read-only (look, click through, sign in with a test user). No mutation run, no code is changed. Backend specs have no smoke tag yet: they are not run.
