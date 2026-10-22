---
description: Start from your feature branch. The same as /quality-code:spec with no key, kept so the old name works.
argument-hint: [--base <branch>]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

`/quality-code:start` is now `/quality-code:spec` with no key: it takes the ticket of the branch you are on. Read `${CLAUDE_PLUGIN_ROOT}/commands/spec.md` and follow it with `$ARGUMENTS` (only `--base <branch>`; never a key). Its rules apply: **Run each plugin script exactly as written**, one call each. Say this first, once: `Tip: /quality-code:spec does this now.`
