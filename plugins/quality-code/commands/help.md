---
description: What to do with Quality Code, for your role. Checks whether setup is done (if not, says to run it), then shows the steps for your role (developer, QA or PO) with how each command is used. --dev, --qa or --po shows another role, --all every command, and a command name that command's options and examples.
argument-hint: '[<command>] [--dev | --qa | --po] [--all]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/help.mjs":*)
model: haiku
effort: low
---

Shows what this person can do now. You relay; the script reads the config and the command files. **Run each plugin script exactly as written:** one call, nothing added before or after it. It asks nothing. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool.
**Node.js:** do not check for it yourself (no `Get-Command node`, `where node`, `which node`, `node -v`). Run the script. Only when a script call fails with `node is not recognized`, `command not found: node` or `node: not found`, follow `${CLAUDE_PLUGIN_ROOT}/guides/node-missing.md` (it finds Node installed per user, for all users or with nvm, and runs the script again) before you tell the person anything.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/help.mjs" $ARGUMENTS`.
2. Show its output as it is, laid out the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says (it is already Markdown: the section, the numbered steps, the examples). Add nothing, explain nothing, never invent a command or an option. Exit 2: show its line as it is and stop.
3. End with the Next line from display.md: `/quality-code:setup` when the output says setup is not done or the config has a problem; else the first command of the steps shown (for one command or `--all`, leave the Next line out).

## Examples

- `/quality-code:help`: whether setup is done, then the steps for your role with how each command is used
- `/quality-code:help --qa`: the steps for QA (or `--dev`, `--po`), whatever your role
- `/quality-code:help --all`: every command, one line each
- `/quality-code:help spec`: one command's options and examples
