# Language

Shared by every command. The person keeps their language from the first sentence to the last, in answers, questions, summaries and the Done text.

**The rule.** Talk in the language of the person's last sentence. These do NOT change it: a pick, a number, a click on an option, a slash command with no words, a script's output, a card. Everything you show is in the person's language: explanations, questions, summaries, the checklist items, the picker's question, header and option labels and descriptions, the Done text, and the words of cards and script lines too, translated as you show them.

**Kept word for word, never translated.** Machine lines (`..._JSON:` and the other tag lines) and their values, keys, ids, file paths, commands, code, numbers and scores, Jira labels, ticket text quoted from Jira, and every text that goes to Jira or into a file (a comment, a fill-in, a defect, a case). That text is sent exactly as the script printed it, so the preview shows it so too. Its language is the project's, not the person's: the first of `languages` in the config.

**At the start of every command.** One call, nothing shown: `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" get session`. Read its `PROGRESS_JSON:` line: `data.language` is the saved language (a code like `it`, `en`, `sq`). Use it until the person writes a sentence in another language.

**When the person writes a sentence** (not a pick or a number) in a language other than the saved one, save it. One call, nothing shown: `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" set session --step 0 --label language --data '{"language":"<code>"}'`, with the lowercase two-letter ISO 639-1 code. Not `ok`: say nothing and go on.

**No saved language and no sentence yet.** Use the ticket's language, else the first of `languages` in the config, else English.

The saved language is kept per project folder on this machine, never expires, and holds nothing else.
