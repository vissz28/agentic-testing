# Quality Code MCP server

A Python MCP server that exposes Quality Code to any MCP client (Claude Desktop, Cursor, Copilot, your own agent), not only Claude Code.

- **One tool per command:** `quality_code_setup`, `quality_code_config`, `quality_code_spec`, `quality_code_ticket_eval`, `quality_code_tickets_eval`, `quality_code_ticket`, `quality_code_seed`, `quality_code_xray`, `quality_code_qa`, `quality_code_kpi`, `quality_code_consumption`, `quality_code_check_update`, `quality_code_ci`, `quality_code_routine`, `quality_code_run_frontend`, `quality_code_run_backend`, `quality_code_run_pipeline`. Each takes `arguments` (the same text you would type after the slash command) and returns that command's instructions, with the plugin folder and your arguments filled in. The model follows them. New commands appear on their own: the server reads `commands/`.
- **`quality_code_run_script`:** runs one of the plugin's checked scripts (`ticket`, `setup`, `pipeline`, `kpi`…) with Node, in the project folder you give as `cwd`. No shell: each argument is its own list item. Only `bin/*.mjs` scripts of the plugin run, and the connector launcher is hidden. The scripts score and check; the model never does.
- **`quality_code_guide`** and the resources `quality-code://guides/<name>`: the guides the commands point to.

Needs Python 3.10+ and Node.js 18+ (the scripts).

## Install the local server (developers)

```bash
plugins/quality-code/mcp-server/install.sh
```

It makes a virtual environment next to the script, installs the server, runs a check (Python, Node 18+, all 16 tools) and prints the config for your client with this install's own paths: the JSON for Claude Desktop, Cursor or a `.mcp.json`, and the `claude mcp add …` line for Claude Code. Run `.venv/bin/quality-code-mcp --check` any time to check it again, and `--print-config` to print the config again.

Your client starts the server itself when it needs it: nothing runs in the background and nothing is hosted. Then ask the client to run a command, for example "run quality_code_ticket_eval for ABC-123".

The commands also use Jira, GitLab, Figma and file tools: the client brings those (connect the Atlassian MCP server next to this one). The plugin settings that Claude Code fills in are read from `QUALITY_CODE_JIRA_EMAIL`, `QUALITY_CODE_GITLAB_API_URL`, `QUALITY_CODE_GITLAB_USERNAME` and `QUALITY_CODE_XRAY_API_URL` when set.

## Two ways to run it

| | Local (stdio) | Shared (HTTP) |
|---|---|---|
| For | developers | QA and PO |
| Runs | on your computer, started by the client | one server for the team, behind HTTPS |
| Sign-in | none: it is your machine | Microsoft Entra ID on every request |
| Tools | every command and script | only the Jira-only ones: `ticket`, `ticket-eval`, `tickets-eval`, the read-only scripts `ticket` and `branch`, and the guides they use |

The shared server cannot see anyone's checkout, so `spec`, the run commands, `seed`, `xray`, `qa`, `setup`, `config` and `kpi` stay on the local server. Over HTTP the caller never picks the folder (no `cwd`), at most 4 scripts run at once (more get `busy`), and `/health` answers without a token for the platform's health checks.

## Sign-in with Microsoft Entra ID (shared server)

The shared server accepts only a valid Entra ID access token, and refuses to start without its settings.

1. In Entra, register an app for the server (App registrations). Note its **Application (client) ID** and your **Directory (tenant) ID**. Under *Expose an API*, set the Application ID URI (`api://<client id>`) and, to limit who can call, add a scope or an app role (for example `QualityCode.Use`) and assign it to your users or groups.
2. Put a project folder on the server with `.claude/quality-code.json` (the Jira site and projects; `/quality-code:setup` writes it). The scripts read it.
3. Start it, in Docker (recommended):

```bash
docker build -f mcp-server/Dockerfile -t quality-code-mcp .      # from plugins/quality-code
docker run -d -p 8000:8000 -v /srv/project:/data \
  -e QUALITY_CODE_ENTRA_TENANT_ID=<tenant id> \
  -e QUALITY_CODE_ENTRA_CLIENT_ID=<client id> \
  -e QUALITY_CODE_PUBLIC_URL=https://qc-mcp.example.com \
  -e QUALITY_CODE_ENTRA_REQUIRED_SCOPE=QualityCode.Use \
  quality-code-mcp
```

or without Docker: set the same variables plus `QUALITY_CODE_PROJECT_DIR=/srv/project` and run `quality-code-mcp --transport http --port 8000`.

`QUALITY_CODE_ENTRA_REQUIRED_SCOPE` is optional: when set, the token must carry that scope (`scp`) or app role (`roles`). `QUALITY_CODE_ENTRA_AUTHORITY` is optional too: the login host, `https://login.microsoftonline.com` by default (for a sovereign cloud use for example `https://login.microsoftonline.us`). Terminate HTTPS in front of the container (a load balancer or reverse proxy); the public address must be `https://`. The container runs as a non-root user and has a health check.

What is checked on every request: the signature (against the tenant's published keys, cached), the issuer (v1.0 or v2.0 of your tenant), the tenant (`tid`), the audience (your client ID or `api://<client id>`), the expiry, and the scope or role when you require one. Anything else gets `401`. Clients sign in through the usual MCP OAuth flow against Entra; the server never sees a password.

Known limits: the scripts see one shared project folder, so ticket copies that the commands save are shared by all callers; and Jira itself is reached by the caller's own Atlassian connector, not by this server. There is no rate limit beyond the 4 concurrent runs: put the server behind a gateway for that.

## Test

```bash
.venv/bin/pip install -e ".[test]" && .venv/bin/python -m pytest
```
