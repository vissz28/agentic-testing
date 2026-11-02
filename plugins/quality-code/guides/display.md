# How results look in the chat

Every command follows this guide when it shows a card or a script's output. It changes the look, never the content: every number, score, verdict, rule id, path, test name and option stays exactly as the script or the card gives it. Nothing is added that the output does not say, and nothing is graded. Where a command says to show something "exactly as printed" or "as printed", that holds for its words, numbers and order; how it is laid out is this guide's. A reader who is not technical (a manager, a CTO) should get each result at a glance.

## The shape

- **One section per thing that happens**, with a heading of three hashes, an emoji and two or three words: `### 🔌 Connectors`, `### 📚 Central Context`, `### 🎫 Ticket`, `### 🎯 Target`, `### 🧪 Plan`, `### ⚙️ Running the checks`, `### 🏁 Result`, `### 📝 Jira`. Other steps pick a fitting emoji the same way. Headings are in the language of the conversation.
- **The headline first.** Right under the heading, one bold line with the outcome, then the details. Never a paragraph of more than two lines; between sections at most one short sentence.
- **Lists become tables** when they have two or more columns of meaning. At most 8 rows; then a last row `… and N more` (the run log has them all).
- **Status is a colour.** Use these marks, and keep the scripts' own: ✅ pass or ready, ❌ failed, ⚠️ not run or not verified, 🔴 tests red or a risk, ➖ not applicable. Paths, ids and commands go in `code`.
- **Green and red lines** (passed and failed tests, scores against the bar) go in a `diff` block: `+ ` for green, `- ` for red, one line each.
- **Hints and rules** go in a quote: `> 💡 **To pass:** …`, `> 📚 Central Context: …`, `> 🛠️ **What to do:** …`.
- **Machine lines** (`…_JSON:`) are never shown, as before.

## Each result

**Connectors.** One line: `✅ Jira · ✅ GitLab · ⚠️ Figma (not connected)`, from the connector check, nothing more.

**Central Context rules** (`rules.mjs`). Central Context is the company's own source of rules, so the reader always sees what came from it. Every time it is read, show this section right then, never folded into another one, shortened or skipped: every rule read (no `… and N more` here), and the same section when nothing was read, with the reason. First one small line with where it came from: the hub, the release and the side asked for. Then a table:

| Rule | Severity | What it asks |
|---|---|---|
| `quality.repeatable-isolated-tests` | **high** | Tests are isolated and independent… |

With no rule read: one line, `> 📚 Central Context: no rule applied (<reason>)`.

**Ticket readiness** (the gate). The headline is the key, the score and the band: `**AGT-144 · 85% · ✅ ready** (bar 70%)`, or `❌ too thin`. Under it a bar of ten squares, one per 10 points of the printed score, rounded down: 🟩 filled when it passes, 🟥 filled when it is refused, ⬜ empty (`🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜`). This is the only arithmetic allowed, and only on the printed score. Then what is missing, as a table:

| Missing | Points |
|---|---|
| Acceptance criteria | 25 |

then the `To pass:` line in a 💡 quote, and the flags in one short list.

**Target and side.** Two lines: `🎯 **Target:** \`src/…/kpi.repository.ts\` (why, in a few words)` and `🧭 **Side:** backend (Vitest tests)`.

**The plan.** A table with one row per test:

| Layer | Test | We check |
|---|---|---|
| unit | Incoming movement with unit cost 0 | the KPI lastCost is 0 |

Extra probes get their own rows, marked `➕ extra`. The `Central Context:` lines go in a 📚 quote under the table.

**The pipeline card.** The headline is the verdict with its mark: `**✅ green**`, `**❌ checks failed**`, `**⚠️ not verified**` or `**🔴 tests red**`, then the line under it that says what it means. The tests as a count, then a `diff` block, `+ ✓ <test>` for each passed test and `- ✗ <test>` for each failed one (at most 8, then `… and N more`). The checks as a table:

| Check | | Result |
|---|---|---|
| honesty | ✅ | no assertion or test removed |

`What to do` as a numbered list in a 🛠️ quote. A `🔴 [RISK / NOT RECOMMENDED]` line stays as it is, on its own line, never softened. The `Rules:` line and `Full details:` path last, on two small lines.

**Anything else a script prints** (a setup summary, a KPI or consumption report, a list of tickets): the same way, a headline, then a table for what has columns and a short list for the rest.

## Questions

A card with numbered options becomes a question in the picker (the `AskUserQuestion` tool) when that tool is available, instead of a numbered list:

- **question**: the card's question or title line, one sentence; **header**: two words at most, like `Plan` or `Gate`.
- **options**: the card's options in their order, the label as the card words it (shortened to a few words when it is long), and a one-line description of what happens on that choice.
- The picker takes four options at most and always offers a typed answer (`Other`). A card with more than four drops its Stop or Cancel option: a person who types `stop` there still stops. Still more than four: show the numbered card as written.
- The picked option is that option's number; a typed answer is read as the command's Replies rule says. The answer comes back in the same turn: go on as the command says for that answer, without ending the turn first.
- Information the card shows above its options (a plan, a score, a preview) goes above the picker as its own section, laid out as above.
- `--ci`, `--yes` and every rule that says not to ask stay as they are: no picker either. Without the tool, show the numbered card as written and end the turn.
