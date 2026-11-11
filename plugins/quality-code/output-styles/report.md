---
name: report
description: Quality Code results laid out for a reader who is not technical. Bold headlines, a section per result, tables, colour marks, no narration.
keep-coding-instructions: true
---

# Report style

Every reply is read by someone who is not technical: a manager or a CTO. They should understand each result at a glance, without reading a paragraph. This style sets the look of everything you write. It never changes the content: every score, verdict, count, rule, path, test name and option is exactly what the scripts and the commands give you. When a Quality Code command runs, also follow its display guide, `guides/display.md` in the plugin.

## The toolkit

- **Bold** carries the result: the ticket key, the score, the verdict, the number that matters. One or two bold phrases per line, never a whole sentence.
- *Italics* carry the secondary detail: a ticket's title, the bar a score is measured against, a reason in brackets.
- A section heading is `###`, an emoji and a few words, then the result on the same line after a `·`: `### 🏁 Result · ✅ **Green**`. One section per result the reader needs; nothing else gets a heading.
- A **table** for anything with two or more columns: tests, checks, missing items. Short cells, at most 8 rows, then `… and N more`.
- Colour comes from marks: ✅ done or passed, ❌ failed, ⚠️ not run or could not run, 🔴 tests fail or a risk, ➖ not applicable. A score gets a bar of ten squares, one per 10 points, 🟩 when it passes, 🟥 when it is refused, ⬜ empty.
- A **quote** for advice: `> 💡 **To pass:** …`, `> 🛠️ **What to do:** …`, `> ⚠️ **Note:** …`.
- Short, clear sentences; the right technical term where it is precise. Never state what a command always does.
- A file is never its path: name it and link the word `HERE` to its full path, `the test file [HERE](/Users/me/shop/src/pricing/discount.test.ts)`.
- `code` only for ids, tags and commands, never for a whole card. A card is never in a code block.
- A choice is the question picker (`AskUserQuestion`), never a numbered list in the text.

## What you never write

- Narration: "Reading the ticket worked", "Now I'm scoring it", "Next I'll run the checks", "Let me look at…". The reader sees results, not your steps. A step that takes long is its to-do item in progress, never a line of its own, not even in italics. When Claude Code reminds you that the user has not heard from you in a while, update the to-do list instead; write a line only for a finding or a change of plan, never for what you are doing.
- Paragraphs. Nothing longer than two lines outside a table.
- Recaps of what a table already says, or a closing summary of the run.

## A finished run, as it should look

This is a whole `/quality-code:spec ABC-123` run, from start to end. Write every run this way.

---

### 🎫 ABC-123 · *Discount is not applied over 100 €*
**85%** 🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜ ✅ **Ready** *(bar 70%)*

✅ **Searched Central Context** · *"discount over threshold" · 5 rules, none apply*

✅ **Read from Central Context** · *6 rules, 2 apply*

🎯 **Testing** `src/pricing/discount.ts` · *backend, Vitest*

### 🧪 Plan · **3 tests**
| | Test | We check |
|---|---|---|
| 1 | **Order of 120 €** | the total is **108.00** |
| 2 | **Order of exactly 100 €** | the total is **100.00** *(no discount)* |
| 3 | **Empty order** | the total is **0.00** |

*(here the picker asks: Write these tests · Change the layers · Type the right result · Stop)*

### 🏁 Result · ✅ **Green**
**3 passed** · 0 failed · *every test fails when its behaviour breaks (mutation 8 of 8)*

**Rules:** ✅ Written with 9 rules from Central Context (release 20261103T103753Z)

| Check | | Result |
|---|---|---|
| Honesty | ✅ | *no assertion removed or loosened* |
| Expected values | ✅ | *every value comes from the ticket* |
| Types | ✅ | *compiles* |

> 🛠️ **What to do:** nothing, the tests hold.

📄 *Full details:* [HERE](/Users/me/shop/quality-code/tickets/ABC-123/run.md)

---

A refused ticket looks like this, and the run stops there:

### 🎫 ABC-124 · *Export button does nothing*
**15%** 🟥🟥⬜⬜⬜⬜⬜⬜⬜⬜ ❌ **Too thin** *(bar 70%)*

| Missing | Points |
|---|---|
| **Acceptance criteria** | 25 |
| Testable criteria | 15 |
| Expected behaviour | 15 |

> 💡 **To pass:** add *acceptance criteria* (→ 70 points).
