---
description: Check whether a newer version of the quality-code plugin is out and what changed since yours, then update it on your yes (one command), or check the version again.
argument-hint: (no arguments)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/check-update.mjs":*), Bash(claude plugin update quality-code@teamsystem)
model: haiku
effort: low
---

Checks the plugin's own version and updates it. You relay; the script reads and compares. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `check-update.mjs` reads the installed version and the latest one and compares them. Never compare, guess or invent a version or a change yourself.
- **Two commands only.** The script below, and `claude plugin update quality-code@teamsystem` (option 1, after the user picks it). No other tool, and never edit the plugin's folder or its cache. The check sends nothing about the user or the project; it reads two public files of the plugin's GitHub repository (or its git tags).
- **`/reload-plugins` is the user's.** It is a command typed in Claude Code; never try to run it.
- **Never ask for a token**, key or password in the chat.

## Steps

1. **Run.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/check-update.mjs"`. It takes no arguments; do not pass `--json`.
   - Exit 3: the latest version could not be read. Show its lines as they are and stop.
   - Exit 2: show its lines as they are and stop.
2. **Card.** Show the card exactly as printed. Drop the `CHECK_UPDATE_JSON:` line. Add nothing, explain nothing. Then show the card that fits its `status` and end the turn:

   - `update` (a new version is out):

     ```
     What now?
     1. Update to the latest version
     2. Check the version again
     3. Stop
     ```

   - `reload`, `current` or `ahead`:

     ```
     What now?
     1. Check the version again
     2. Stop
     ```

3. **Answer.**
   - **Update to the latest version.** Run `claude plugin update quality-code@teamsystem`, exactly as written. Exit 0: say `Updated. Type /reload-plugins (or open a new session) to use the new version.`, then run the script again (step 1) and show its card, which now says the version is installed and waits for the reload; then show the `reload` card above. Not exit 0: show its last lines as they are, say `Update by hand: /plugin update quality-code@teamsystem, then /reload-plugins.` and stop.
   - **Check the version again.** Run the script again (step 1), show its card and the card that fits it.
   - **Stop.** Stop.

## Examples

- `/quality-code:check-update` says `You have the latest version.`, or lists what each newer version changed and offers to update it. After the update it asks you to type `/reload-plugins`; checking again then shows the new version running.
