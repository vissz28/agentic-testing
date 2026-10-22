---
description: Write and check tests for a Jira ticket. The same as /quality-code:spec <KEY>, kept so the old name works.
argument-hint: <KEY> [--layer NAME] [--target PATH] [--route PATH] [--no-extras] [--yes] [--dry-run] [--ci]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

`/quality-code:write` is now `/quality-code:spec`. Read `${CLAUDE_PLUGIN_ROOT}/commands/spec.md` and follow it with `$ARGUMENTS` as they are. Its rules apply: **Run each plugin script exactly as written**, one call each. Here a key is required: with none, say `pass a key: /quality-code:write <KEY>, or /quality-code:spec on your feature branch` and stop.
