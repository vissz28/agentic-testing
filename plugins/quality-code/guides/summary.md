# The run summary (summary.md)

Followed after the card of `guides/run.md` (step 6) and `/quality-code:spec` (step 7). `run.md` is the full log for developers; `summary.md` is the page anyone can open and show: a manager, a product owner, a tester new to QA. It sits next to `run.md` and is opened in the VS Code preview.

## When

Only when the card printed a `Full details: <path>/run.md` line (a run with a ticket key, logs on). Write `<path>/summary.md` in the same folder, overwriting the last one. No line, no summary. Not with `--ci`. Write it once, after the last run of the command, and say one line under the card: `Summary for sharing: <path>/summary.md`.

## What you read

- The **facts**: the `PIPELINE_JSON:` line and `run.md`. Verdict, counts, which checks passed, what failed. Copy them; never compute, change or soften one (the rules of `guides/run.md` hold).
- The **meaning**: `ticket.json` in the same folder (its summary and acceptance criteria) and the spec files of the run. Read them only to say in plain words what each test does and which criterion it covers. This is the one place the run guide's "never read file contents" gives way; still never copy code, a diff, a selector or a secret into the summary.
- The **story**: what this command did on the way (a rewrite of the tests and why, a re-run, a run forced past the readiness check).

## How it reads

- Words a person outside QA knows. No `assertion`, `mutant`, `spec`, `boundary`, `suite`, `fixture`, `stub`, `locator`, `CI`. Say `test file`, `check`, `expected result`, `the app`, `the code`.
- Each test is one sentence of what a user does and sees: `When an order is exactly €100, the 10% discount applies`, not `order exactly at the discount threshold`. Use the ticket's real values.
- Short. The whole page fits on one screen and a half.
- The language of the ticket (`guides/language.md`); the headings too.

## Layout

Fill this in. Leave out a section that has nothing to say (no `Things to look at` on a green run), never leave a heading empty.

```markdown
# <mark> <KEY> · <ticket summary>

> **<one-line verdict in plain words>**
> <date, YYYY-MM-DD> · <n> tests · <test type: screen tests in the browser | code tests | both>

## In short

- <3 to 5 bullets: what was tested, the result, the one thing to know>

## What the tests check

| | When… | We expect… | Covers |
|---|---|---|---|
| ✅ | <what the user does or the situation> | <what they see, with the ticket's value> | <criterion number> |

<One line if there are extra tests: "Tests marked ➕ go beyond the ticket: cases it does not mention.">

## Does every part of the ticket have a test?

| # | The ticket asks for… | Tested by | |
|---|---|---|---|
| 1 | <criterion in plain words> | <test sentence, short> | ✅ |

<Closing line: "Every part of the ticket has a test." or "<n> parts have no test: <which>, because <why>.">

## How we know the tests are real

| | What we did | What it shows |
|---|---|---|
| ✅ | <check in plain words> | <one sentence> |

## Things to look at

- <one bullet per item on the card's "What to do" or "Failing tests", in plain words, with who should act>

---

<sub>Full technical log: [run.md](run.md) · Run it again: `<the run.md "Run it again" command>`</sub>
```

## Marks and wording

- **Title mark and verdict line**, from the verdict: green `✅` `The tests pass and they really check the ticket.`; tests red `🔴` `The tests are sound, and some fail: the app does not do yet what the ticket says.` (for a Bug whose fix is not merged: `Expected for now: the tests show the bug the ticket describes.`); checks failed `🛠️` `The tests themselves need fixing before they can be trusted.`; could not run `⚠️` `The tests could not run, so nothing is proven yet.`
- **Test rows:** `✅` passed, `❌` failed, `⏳` to do (the ticket does not say yet what should happen), `➕` before the row's mark for an extra test (`Extra:` in its name). A failed row says in the `We expect…` cell what happened instead, in plain words.
- **Ticket table:** a criterion with no test gets `⚠️` and the `Tested by` cell `no test`; one whose tests fail gets `❌`. A test that covers no criterion and is not an extra goes in no row of this table.
- **Proof rows**, one per check the card lists that applied (leave out `not applicable`), with its real numbers:
  - tests: `We ran every test` · `<passed> of <total> passed`
  - mutation: `We swapped each expected result for a wrong one, <total> times` · `The tests failed every time, so they really check those results` (or `<survived> times they did not notice: those tests check too little`)
  - stryker: `We made small changes to the code itself, <total> times` · `The tests caught <killed> of them`
  - expected: `We compared the tests with the ticket` · `Every expected value comes from the ticket`
  - assertions: `We looked inside every test` · `Each one checks a result, none just runs without checking`
  - honesty: `We compared with the earlier version` · `No test or check was deleted or switched off`
  - boundary: `We looked at what this run changed` · `Only tests changed, never the app`
  - types: `We compiled the tests` · `No errors`
  - flaky: `We ran each test <n> times` · `Same result every time`
  - A failed or not-run check keeps its row with `❌` or `⚠️` and says what went wrong in plain words.
- **In short:** the first bullet says what the ticket is about in one sentence; the others give the count, the verdict in plain words, and whatever this run did on the way (`The first tests missed a value from the ticket; they were rewritten and checked again.`). Keep the `Ticket incomplete` risk as a bullet when the card had it: `⚠️ The ticket was missing details; these tests were written anyway, at the team's risk.`
