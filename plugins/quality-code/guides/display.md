# How results look in the chat

Every command follows this guide when it shows a card or a script's output. It changes the look, never the content: every number, score, verdict, rule id, path, test name and option stays exactly as the script or the card gives it (a file's path may sit behind a `HERE` link, see **Files are links**). Nothing is added that the output does not say, and nothing is graded. Where a command says to show something "exactly as printed" or "as printed", that holds for its words, numbers and order; how it is laid out is this guide's. A reader who is not technical (a manager, a CTO) should get each result at a glance, and so should a developer: plain words, the result in bold, nothing to read twice.

## Progress

A command with more than two steps shows its progress as a live checklist, with the to-do list tool (`TodoWrite`, or `TaskCreate` and `TaskUpdate` where those are the ones available), not with sentences:

- **At the start**, before the first script runs, write the whole list, one item per step the reader cares about, in plain words. For `/quality-code:spec`: `Check the setup`, `Read the ticket`, `Readiness gate`, `Read from Central Context`, `Find the code to test`, `Plan the tests`, `Write the tests`, `Run the checks`, `Result`. Another command takes its own steps the same way.
- **As you go**, set the step you start to in progress and the one you finish to completed, and put its result in the item, short: `Readiness gate · 85% ✅`, `Read from Central Context · 6 testing rules ✅`, `Find the code to test · discount.ts`. A step the run skips is completed with `· skipped`; a step that stops the run says why, `Readiness gate · 15% ❌`.
- **No narration.** Never write a sentence that says what you are about to do or what just worked ("Reading the ticket worked", "Now I'm scoring it", "Running the checks: this can take a few minutes"): the checklist says it. Where a command says to "say" such a line, update the checklist instead. Lines that carry a result the reader needs (the target and why, a clash with the QA plan, a warning) stay, as one short line each. When Claude Code reminds you that the user has not heard from you in a while, the checklist is the update: tick or advance its item, and write a line only for such a result, never for what you are doing.
- Without the tool, one short line per finished step, `✅ Readiness gate · 85%`, and nothing else.

## The shape

- **A section only where the reader reads or decides**: the gate's score, the plan, the result, a Jira post, a warning. Its heading has three hashes, an emoji and two or three words: `### 🎫 Ticket`, `### 🧪 Plan`, `### 🏁 Result`, `### 📝 Jira`. Other steps pick a fitting emoji the same way. Every other step is only its checklist item. Headings are in the language of the conversation.
- **The headline first.** Right under the heading, one bold line with the outcome, then the details. Never a paragraph of more than two lines; between sections nothing but the checklist.
- **Plain words.** Write so a 12-year-old follows it: short sentences, everyday words, one idea per line. A technical word the reader needs (a tag, a test name, a command) stays as it is, with a few plain words after it the first time: `@anchor` *(the tests that catch the bug)*. Say "fails" and "passes", not "red" and "green", outside the verdict.
- **Bold carries the result**: the verdict, the count that matters, the thing the reader has to do. One or two bold phrases per line, never a whole sentence.
- **Files are links.** A file is never shown as its path: name it in plain words and link the word `HERE` to it, `the test file [HERE](/Users/me/shop/e2e/tests/orders.abc-123.spec.ts)`. The link target is the file's full path on this computer, so a click opens it. Two files on one line: `Excel [HERE](…) · CSV [HERE](…)`. A folder works the same way.
- **Lists become tables** when they have two or more columns of meaning. At most 8 rows; then a last row `… and N more` (the run log has them all).
- **Status is a colour.** Use these marks, and keep the scripts' own: ✅ pass or ready, ❌ failed, ⚠️ not run or not verified, 🔴 tests red or a risk, ➖ not applicable. Ids, tags and commands go in `code`; files are `HERE` links.
- **Green and red lines** (passed and failed tests, scores against the bar) go in a `diff` block: `+ ` for green, `- ` for red, one line each.
- **Hints and rules** go in a quote: `> 💡 **To pass:** …`, `> 🛠️ **What to do:** …`.
- **Never a code block for a card.** The commands write their cards inside code blocks only to fix the words. In the chat a card is never in a code block, and never a gray box of indented lines: its information is a section laid out as below, and its options are the picker. The only code blocks you show are the `diff` blocks of tests.
- **Machine lines** (`…_JSON:`) are never shown, as before.

## Each result

**Connectors.** In the `Check the setup` item: `Check the setup · ✅ Jira · ⚠️ GitLab`. A connector the run needs and lacks is a warning line too.

**Central Context** (`rules.mjs`). Central Context is the company's own source of rules, so every time it is read the reader sees it, right then, as a completed step: the `Read from Central Context` item, `Read from Central Context · 6 testing rules ✅`, or `Read from Central Context · not read ⚠️` with the reason after it. Without the checklist, the line `rules.mjs` prints, on its own, as printed. Never skip it or fold it into another step, and never list the rules: the tests follow them, the reader does not need to read them.

**Ticket readiness** (the gate). The headline is the key, the score and the band: `**ABC-123 · 85% · ✅ ready** (bar 70%)`, or `❌ too thin`. Under it a bar of ten squares, one per 10 points of the printed score, rounded down: 🟩 filled when it passes, 🟥 filled when it is refused, ⬜ empty (`🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜`). This is the only arithmetic allowed, and only on the printed score. Then what is missing, as a table:

| Missing | Points |
|---|---|
| Acceptance criteria | 25 |

then the `To pass:` line in a 💡 quote, and the flags in one short list.

**Target and side.** In the `Find the code to test` item: `Find the code to test · discount.ts (backend)`. Why that file, and where the spec goes when it is not the usual place, in one short line under the plan.

**The plan.** A table with one row per test:

| Layer | Test | We check |
|---|---|---|
| unit | Discount over 100 € | the total is 108.00 |

Extra probes get their own rows, marked `➕ extra`.

**The pipeline card.** The headline is the verdict with its mark: `**✅ green**`, `**❌ checks failed**`, `**⚠️ not verified**` or `**🔴 tests red**`, then the line under it that says what it means. The tests as a count, then a `diff` block, `+ ✓ <test>` for each passed test and `- ✗ <test>` for each failed one (at most 8, then `… and N more`). The checks as a table:

| Check | | Result |
|---|---|---|
| honesty | ✅ | no assertion or test removed |

`What to do` as a numbered list in a 🛠️ quote. A `🔴 [RISK / NOT RECOMMENDED]` line stays as it is, on its own line, never softened. The `Rules:` line and `Full details: [HERE](…)` last, on two small lines.

**Anything else a script prints** (a setup summary, a KPI or consumption report, a list of tickets): the same way, a headline, then a table for what has columns and a short list for the rest.

## The wrap-up

What you write after the last card (what was made, what went wrong, what is left) is read in one go: **at most 250 words**, the card above it not counted. It never repeats the card's tests or checks. Always in this order, leaving out a section with nothing in it:

1. **The verdict**, one bold line with its mark, then one plain sentence on what it means for the reader.
2. `### 📄 What we made`: a table, one row per thing made, with what it is, what it does in a few words, and its `HERE` link.
3. `### 🛠️ Needs you`: a numbered list, only what the reader has to do, each starting with a bold verb. Nothing to do: leave it out.
4. `### ℹ️ Good to know`: at most three one-line bullets, each with a bold label: what was fixed on the way, what could not be checked, what is not committed.

Over 250 words: cut **Good to know** first, then shorten rows. Never cut a step from **Needs you**, a ❌ or a 🔴 line.

For example, after a `tests red` card:

---

**❌ Checks failed**, but not because of the tests. **4 of 5 tests fail on the bug**, as they should; one setting from outside this run tripped the checks.

### 📄 What we made
| | What | Where |
|---|---|---|
| 🧪 | **5 tests** for the order form: 4 catch the bug `@anchor`, 1 control passes | [HERE](/Users/me/shop/e2e/tests/orders.abc-123.spec.ts) |
| 📋 | **5 Xray cases** (TC 1 to TC 5) | [HERE](/Users/me/shop/.claude/harness/testcases.csv) |
| 📊 | **QA files** | Excel [HERE](/Users/me/shop/e2e/tickets/ABC-123/case.xlsx) · CSV [HERE](/Users/me/shop/e2e/tickets/ABC-123/case.csv) |

### 🛠️ Needs you
1. **Remove** the `outputStyle` setting [HERE](/Users/me/shop/.claude/settings.json) (not added by this run), then run `/quality-code:run-frontend` again for a clean result.

### ℹ️ Good to know
- **Fixed on the way:** the form needs a date the ticket does not mention, so the tests fill one in.
- **Not checked:** the Confluence QA plan (no access).
- **Not committed:** nothing is committed yet.

---

## Questions

A card with numbered options becomes a question in the picker (the `AskUserQuestion` tool) when that tool is available, instead of a numbered list. Calling the tool is how the card is shown: never print its numbered options as well. Wherever a command says "show this card and end the turn", call the picker instead:

- **question**: the card's question or title line, one sentence; **header**: two words at most, like `Plan` or `Gate`.
- **options**: the card's options in their order, the label as the card words it (shortened to a few words when it is long), and a one-line description of what happens on that choice.
- The picker takes four options at most and always offers a typed answer (`Other`). A card with more than four drops its Stop or Cancel option: a person who types `stop` there still stops. Still more than four: show the numbered card as written.
- The picked option is that option's number; a typed answer is read as the command's Replies rule says. The answer comes back in the same turn: go on as the command says for that answer, without ending the turn first.
- Information the card shows above its options (a plan, a score, a preview) goes above the picker as its own section, laid out as above.
- `--ci`, `--yes` and every rule that says not to ask stay as they are: no picker either. Without the tool, show the numbered card as written and end the turn.
