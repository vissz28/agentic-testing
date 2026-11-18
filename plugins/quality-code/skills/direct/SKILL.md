---
name: direct
description: Quality Code direct, the one entry for the whole plugin. Use when the person's message starts with "Quality Code", "Quality Code direct" or "Using Quality Code", for example "Quality Code ticket PFO-123", "Using Quality Code spec ABC-1" or just "Quality Code" for what to do next. Takes the rest of the message as the command and its arguments.
argument-hint: <command> [arguments]   e.g. ticket PFO-123, spec ABC-1, qa EXEC-9, help
---

Say `Using Quality Code` first, then run the person's request.

1. **With the Quality Code connector (the MCP server):** call the tool `quality_code_direct` with the person's whole message, exactly as written. It names the command after the keyword (a bare Jira key means `ticket`), and returns that command's instructions, parameters and suggestions. Follow them as written, one step at a time, ending your turn at every card. If it answers that it could not tell the command, show its list and ask which one.
2. **Without the connector (the plugin alone):** take the word after the keyword as the command name (`ticket`, `spec`, `check`, `ci`, `qa`, `xray`, `transcript-goal`, `seed`, `routine`, `report`, `config`, `setup`, `clean`, `update`, `help`; a bare Jira key means `ticket`; nothing after the keyword means `help`) and run it with the Skill tool as `quality-code:<command>`, passing the rest of the message as its arguments.
3. Never invent a command or a parameter. A command the person did not name and you cannot tell: show the list of commands and ask.
