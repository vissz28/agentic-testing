---
description: Check whether a newer version of the quality-code plugin is out, and what changed since yours. Read-only: it installs nothing, it tells you the two commands to type.
argument-hint: (no arguments)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/check-update.mjs":*)
model: haiku
effort: low
---

Checks the plugin's own version. You relay; the script reads and compares. Plain English, short sentences. End your turn after the card.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `check-update.mjs` reads the installed version and the latest one and compares them. Never compare, guess or invent a version or a change yourself.
- **Read-only.** Run only the script below; no other tool. It reads two public files of the plugin's GitHub repository (or its git tags) and sends nothing about the user or the project.
- **You cannot install the update.** `/plugin update` and `/reload-plugins` are commands the user types in Claude Code; never try to run them, edit the plugin's folder or its cache.
- **Never ask for a token**, key or password in the chat.

## Steps

1. **Run.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/check-update.mjs"`. It takes no arguments; do not pass `--json`.
   - Exit 3: the latest version could not be read. Show its lines as they are and stop.
   - Exit 2: show its lines as they are and stop.
2. **Card.** Show the card exactly as printed. Drop the `CHECK_UPDATE_JSON:` line. Add nothing, explain nothing. When it says a new version is out, the two commands are already on the card: do not run them, and end your turn. After an update the user types `/reload-plugins` (or opens a new session), then `/quality-code:check-update` again to confirm.

## Examples

- `/quality-code:check-update` says `You have the latest version.`, or lists what each newer version changed and the two commands to type.
