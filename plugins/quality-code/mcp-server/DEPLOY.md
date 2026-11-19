# Deploy the shared Quality Code MCP server

How to run the shared server (QA and PO, Jira-only tools) in three environments, with sign-in through Microsoft Entra ID, on TeamSystem's platform. For what the server does and how it checks the token, read [README.md](README.md) first.

Status: draft for AGT-157. Every statement is marked by where it comes from:

- **Checked here:** run on this server's code.
- **Documented:** written in the TeamSystem Development Portal (AI Platform docs) or in Confluence. The source is named.
- **Proposal:** our suggestion, not yet agreed.
- **To confirm:** nobody has answered it yet. It needs the platform team.

## 1. What the server does today (checked here)

Run locally with test IDs:

| Request | Result |
|---|---|
| `GET /health`, no token | 200 `{"status":"ok"}` |
| `POST /mcp`, no token | 401 |
| `GET /.well-known/oauth-protected-resource` | JSON that names the public address as the resource and `https://login.microsoftonline.com/<tenant>/v2.0` as the authorization server |

- It accepts only a valid Entra ID access token: signature, issuer (v1 and v2), tenant, audience (`<client id>` or `api://<client id>`), expiry, and optionally a scope or app role.
- It refuses to start without `QUALITY_CODE_ENTRA_TENANT_ID`, `QUALITY_CODE_ENTRA_CLIENT_ID` and `QUALITY_CODE_PUBLIC_URL`. Optional: `QUALITY_CODE_ENTRA_REQUIRED_SCOPE`, `QUALITY_CODE_ENTRA_AUTHORITY`, and for the sign-in page `QUALITY_CODE_ENTRA_CLIENT_SECRET` and `QUALITY_CODE_SESSION_SECRET`.
- **Claude connector sign-in (optional).** Set `QUALITY_CODE_TOKEN_SECRET` (32 or more random characters, for example `openssl rand -base64 32`; a Container Apps secret, never in git or chat) to let people add this server as a connector in Claude. The server then issues its own tokens after the Entra sign-in and a page with the TeamSystem rules; Entra's own tokens keep working on `/mcp`. The rules text is `quality_code_mcp/static/rules.md`, or the file named by `QUALITY_CODE_RULES_FILE`: replace the placeholder before anyone is asked to accept it. Changing the text asks everyone again. Nothing is stored: rotating the secret signs everyone out. No new Entra redirect URI is needed. The web sign-in also needs `QUALITY_CODE_ENTRA_CLIENT_SECRET`. With `QUALITY_CODE_ENTRA_REQUIRED_SCOPE` set, the connector sign-in checks it in the Microsoft ID token, which carries app roles (`roles`) but not delegated scopes: for the connector, make it an **app role** assigned to the users or groups, or nobody can connect. A refresh of a connector token checks again the rules version and the required role, and stops 14 days after the Microsoft sign-in (people connect again then). It does not ask Microsoft again, so a person removed in Entra keeps access until then at the latest. With `QUALITY_CODE_TOKEN_SECRET` set and no `QUALITY_CODE_SESSION_SECRET`, the sign-in cookies are signed with a key derived from it.
- `GET /` is a sign-in page for people (Microsoft, then the `/mcp` address and the commands to connect). It needs a **Web** redirect URI `<public address>/auth/callback` on the app registration and a client secret. The `/mcp` endpoint does not use the secret.
- The Docker image (`mcp-server/Dockerfile`, built from `plugins/quality-code`) listens on port 8000, runs as a non-root user and has a health check on `/health`. It runs the scripts in `/data`, which stays empty: they get their config in their environment and write no file.
- It does not read the platform's headers (`X-User-ID`, `X-Owner-ID`, `X-Correlation-ID`), does not call a TSID auth service, and has no MLflow tracing. None of these appears in its code.
- Not tried: a sign-in against the real tenant, and any MCP client signing in to it.

## 2. What the platform documents

Sources: Development Portal, AI Platform docs (*Building an MCP Server*, *Release process of an MCP Server*, *How to publish an MCP Server*, *Registering an MCP Server on Gateway and Registry*), and Confluence (*MCP Deployment*, TS Enterprise; *Guida passo-passo per la migrazione da MCP a Witboost*, TS Professional; *Onboarding MCP di piattaforma*, TS HR).

- **Platform MCP servers** use FastMCP over HTTP and expose `/mcp` and `/health`.
- **Two ways to publish.** On *AI Platform hosting*, you add Kubernetes manifests to `k8s-oneplatform-deploy-configs` and Argo CD deploys them into the `ai-services` namespace on port 8000, in `dev`, `test` and `prod`. On *BU hosting*, "each BU is independent", with two constraints: the server must be publicly reachable, and it must be zero trust.
- **Zero trust, as the platform describes it.** The blueprint's middleware checks the `Authorization: Bearer` token against a B2B auth service (`AUTH_SERVICE_URL`) and rejects requests with no `X-Correlation-ID`. One page notes that enforcement is "not yet applied across all MCPs".
- **Registration in Witboost** (an AI Product with an *AI Endpoint MCP*) creates a route on the Azure API Management gateway and registers the server in the registry. The deployment runs reachability and zero-trust checks first, and a server that fails is not registered. This is what lets a TS AI assistant call the server, with a TSID token.
- **A deploy pipeline on Biosphere** (*MCP Deployment* page): the target is Azure Container App; the repository needs `.gitlab-ci.yml`, `README_PIPELINE.md` and `terraform/` copied from another MCP project; environments are `dev`, `stage` and `prod`, created under Operate > Environments; CI/CD variables are set with `gitlab_variables.py` (`export`, `apply --dry-run`, `apply`); `dev` deploys by itself; `stage` and `prod` deploy from a new tag and one manual step; the checks `uvx ruff check` and `uvx ruff format --check` run before commit. `APP_NAME` must follow the naming convention, for example `fi-balance-sheet`.
- **The onboarding page** describes a different pipeline for platform MCPs: a tag starts a pipeline, then `deploy-docker`, then a manual `k8s-trigger-dev`.

## 3. Proposal

Run it like a BU-hosted server: its own address, Entra ID sign-in, no assistant mapping.

| Environment | Address (proposal) |
|---|---|
| dev | `https://qualitycode-dev.teamsystem.cloud/mcp` |
| test | `https://qualitycode-test.teamsystem.cloud/mcp` |
| main | `https://qualitycode.teamsystem.cloud/mcp` |

The *MCP Deployment* page names the second Biosphere environment `stage` and the third `prod`. We call them `test` and `main`. Whether the copied pipeline accepts those names, or they must be `stage` and `prod`: to confirm (section 4).

Steps:

1. **One Entra app registration per environment.** Note the client ID and tenant ID. Set the Application ID URI to `api://<client id>`. Add a scope or app role `QualityCode.Use` and assign it to the users or groups who may use the server. Add the redirect URIs of the clients that will sign in.
2. **One set of CI/CD variables per environment:** the three required variables, plus `QUALITY_CODE_ENTRA_REQUIRED_SCOPE=QualityCode.Use`. `QUALITY_CODE_PUBLIC_URL` is that environment's https address. The MCP endpoint needs no client secret, because it only verifies tokens; the sign-in page does (`QUALITY_CODE_ENTRA_CLIENT_SECRET`, with `QUALITY_CODE_SESSION_SECRET`), and its redirect URI is `<public address>/auth/callback`.
3. **A Biosphere repository with the pipeline,** copied from an existing MCP project as the *MCP Deployment* page says. The build is `docker build -f mcp-server/Dockerfile .`, run in `plugins/quality-code`. Tag releases with the plugin version.
4. **After each deploy, run the checks of section 1** against the environment's address, and one real `quality_code_ticket` call with a valid Entra token.
5. **To connect a client:** add the environment's address as a remote MCP server (Claude Code: `claude mcp add --transport http quality-code <address>`, then `/mcp` to sign in). Jira is reached through each person's own Atlassian connector, or, with the Atlassian sign-in on (README), through the server's `quality_code_jira_*` tools as that person.

## 4. To confirm with the platform team

1. Is Entra ID sign-in accepted as "zero trust" for this server, or must it validate TSID tokens? This decides the whole sign-in design.
2. Which pipeline and hosting apply: the Container App pipeline (*MCP Deployment*) or the Kubernetes one (*How to publish*)?
3. The plugin lives on GitHub and the pipeline runs on Biosphere. Which repository does the deploy use: a small one that holds `plugins/quality-code`, or a mirror?
4. The final host names, the Azure side of the Container App, and whether the pipeline's environments can be named `dev`, `test` and `main` instead of `dev`, `stage` and `prod`.
5. **Client registration.** Entra ID does not support dynamic client registration, which some MCP clients expect. Either register each client as its own Entra app and give users its client ID, or put an OAuth proxy in front of the server. Try Claude, Cursor and Copilot in dev first.
6. Is access limited to the company network or VPN?
7. The Jira site and projects of each environment (`QUALITY_CODE_JIRA_SITE`, `QUALITY_CODE_JIRA_PROJECTS`), or neither for TeamSystem's Jira and any project. No config file is needed on the server.
8. How to roll back, where the logs are, and who is told when the health check fails.
9. Whether `mcp-server` passes `uvx ruff check` and `ruff format --check`. Not tried.
10. Whether the server must also be a tool in a TS AI assistant. That needs a different server: TSID validation, the platform headers, MLflow tracing on every tool, and the Witboost registration. It is not planned.

## Known limits

- **One replica for the connector sign-in.** Two things live in the server's memory: the codes already used (a code works once), and, with the Atlassian, GitLab or GitHub sign-in on, the person's details between those sign-ins (too big for a cookie). Run one replica (Container Apps: min and max replicas 1). With more, a sign-in that lands on another replica stops with "This sign-in was started on another copy of the server" and has to start again, and a used code could be swapped once more on another replica within its 5 minutes (it still needs the PKCE verifier). Options to scale out: session affinity (sticky sessions) on the ingress, a shared store such as Redis for both, or splitting the details over several cookies. A restart only makes an unfinished sign-in start again.
- All callers share one script folder, but the scripts read no file there and save none (the chat holds the ticket), so no caller sees another one's tickets.
- At most 4 scripts run at once; more get `busy`. There is no other rate limit.
