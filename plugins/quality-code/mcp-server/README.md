# Quality Code MCP server

A Python MCP server that exposes Quality Code to any MCP client (Claude Desktop, Cursor, Copilot, your own agent), not only Claude Code.

- **One tool per command:** `quality_code_setup`, `quality_code_config`, `quality_code_spec`, `quality_code_ticket_eval`, `quality_code_tickets_eval`, `quality_code_ticket`, `quality_code_seed`, `quality_code_xray`, `quality_code_qa`, `quality_code_kpi`, `quality_code_consumption`, `quality_code_run_frontend`, `quality_code_run_backend`, `quality_code_run_pipeline`. Each takes `arguments` (the same text you would type after the slash command) and returns that command's instructions, with the plugin folder and your arguments filled in. The model follows them. New commands appear on their own: the server reads `commands/`.
- **`quality_code_run_script`:** runs one of the plugin's checked scripts (`ticket`, `setup`, `pipeline`, `kpi`…) with Node, in the project folder you give as `cwd`. No shell: each argument is its own list item. Only `bin/*.mjs` scripts of the plugin run, and the connector launcher is hidden. The scripts score and check; the model never does.
- **`quality_code_guide`** and the resources `quality-code://guides/<name>`: the guides the commands point to.

Needs Python 3.10+ and Node.js 18+ (the scripts).

## Run it

```bash
cd plugins/quality-code/mcp-server
python3 -m venv .venv && .venv/bin/pip install -e .
```

In the client's MCP settings:

```json
{ "mcpServers": { "quality-code": { "command": "/path/to/mcp-server/.venv/bin/quality-code-mcp" } } }
```

It finds the plugin by its place in the repo. Installed elsewhere, set `QUALITY_CODE_PLUGIN_ROOT` to the `plugins/quality-code` folder. The plugin settings that Claude Code fills in are read from `QUALITY_CODE_JIRA_EMAIL`, `QUALITY_CODE_GITLAB_API_URL`, `QUALITY_CODE_GITLAB_USERNAME` and `QUALITY_CODE_XRAY_API_URL` when set.

The commands also use Jira, GitLab, Figma and file tools: the client brings those (connect the Atlassian MCP server next to this one).

## Test

```bash
.venv/bin/pip install -e ".[test]" && .venv/bin/python -m pytest
```
