# Claude connector sign-in: our server as the authorization server

Date: 2026-11-16. Status: draft for approval. Code under `plugins/quality-code/mcp-server/quality_code_mcp/`.

## Intent

People at TeamSystem should be able to add the Quality Code MCP server (https://qualitycode.teamsystem.cloud/) as a connector in Claude. Before Claude gets a token, the person proves who they are with Microsoft Entra ID, is checked to be in the TeamSystem tenant, reads and accepts the TeamSystem rules, and confirms a few non-secret details. After Claude is connected, the server has done its part: it stores nothing about the person.

Why now: the server is deployed. Today `/mcp` accepts only a bearer token issued by Entra itself. Claude cannot obtain one, because Entra does not support Dynamic Client Registration (DCR) and Claude's automatic sign-in needs it. The rules and identity step has to sit in the sign-in itself, so it cannot be skipped.

## Goals

1. Adding the connector in Claude (claude.ai, and Claude Code and Desktop where they use the same flow) ends with a working, signed-in connection, with no secret typed by the user.
2. Sign-in goes through Entra. Only users of the TeamSystem tenant (`tid`) get a token.
3. A page shows what we read from Entra (name, email) and the TeamSystem rules. The user accepts, and may correct a Jira email and give a GitLab username. These are non-secret.
4. The token Claude receives identifies the person (`oid`, email, name) and records the rules version accepted and the two optional details, so the MCP can read them per call with no database.
5. The existing site sign-in (`/`, `/login`, `/auth/callback`, `/logout`) and the existing Entra-token access to `/mcp` keep working.

## Non-goals

- Storing a profile, rules acceptance or any user data on the server. State lives in signed tokens.
- Getting Jira, GitLab, Figma or Xray tokens from the Entra login. They stay separate sign-ins (`/mcp` connector approval or `/plugin` settings).
- Changing the Claude Code plugin's setup flow in this part (see Part 2).
- Group or role based access (open question below).

## Anti-goals (a failure even if it technically works)

- A secret (password, API key, client secret, a downstream token) typed into the page or passed through chat.
- A token Claude can use after the user declined the rules.
- An open redirect: the server must only send people back to Claude's own callback (and a loopback address for local clients), never to an address a caller chose.
- A restart that logs everyone out, or a rotation of the signing secret that nobody notices.

## How it works (the flow)

1. Claude asks the server for its metadata and registers itself (`/register`, DCR). The server answers as the authorization server for `/mcp`.
2. Claude sends the user to `/authorize` (PKCE `S256`, `state`, the redirect URI Claude registered).
3. The server redirects to Entra. This reuses the existing `/login` flow (state, nonce, PKCE with Entra), tagged as a connector sign-in, with the Claude request carried in the signed flow cookie.
4. Entra returns to `/auth/callback` (the redirect URI already registered). The server verifies the ID token as today and checks `tid`.
5. The server shows the page: the name and email from Entra, the rules, a Jira email field (prefilled with the Entra email), and an optional GitLab username field. Two buttons: Accept and Cancel.
6. Accept (`POST /connect/accept`, session cookie plus a CSRF token) mints a short-lived authorization code and redirects to Claude's registered redirect URI with `code` and `state`. Cancel sends `error=access_denied` to the same address.
7. Claude calls `/token` with the code and its PKCE verifier. The server returns an access token and a refresh token, both signed by the server.
8. Claude calls `/mcp` with the access token. The server verifies it (signature, expiry, audience) and reads `oid`, email, name and the accepted details from its claims.

## Design decisions

These are the decisions of this design. The ones marked (call) are my choices, not yours; please check them.

- **Library (call):** implement the official `mcp` SDK's `OAuthAuthorizationServerProvider` protocol (the repo uses `mcp` 2.3.0, `AuthSettings.client_registration_options` turns on `/register`). Do not switch to FastMCP: it would replace the server's base, and its `AzureProvider` stores client data in a database by default.
- **Stateless where possible (call):**
  - *Client registration:* `client_id` is a signed blob holding the registered redirect URIs and name. `get_client` verifies and decodes it, so a restart loses nothing.
  - *Tokens:* access token (1 hour) and refresh token (30 days) are signed JWTs (`HS256`, key from `QUALITY_CODE_TOKEN_SECRET`, at least 32 random bytes). `aud` is the server's public URL; `iss` is the same.
  - *Authorization code:* a signed JWT valid 5 minutes, bound to the client, the redirect URI and the PKCE challenge. The only memory kept is a set of used codes (so a code works once). A restart inside those 5 minutes can only make an unfinished sign-in start again.
- **Redirect allowlist (call):** exact match on `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` (Anthropic has said the host may change), plus loopback addresses (`http://localhost:<port>/…`, `http://127.0.0.1:<port>/…`) for Claude Code. A registration with any other redirect URI is refused.
- **Two token kinds accepted at `/mcp` (call):** the new server-issued tokens and, as today, Entra-issued bearer tokens (`EntraTokenVerifier`). Nothing that works today stops working.
- **Tenant check:** `tid` must equal the configured tenant. Nothing else is required to get a token.
- **Rules text:** loaded from a file in the image (`static/rules.md`) with a version string. The version goes in the token. Changing the file changes the version, and the next sign-in asks again. The wording is not ours to write (open question).
- **Page fields (call):** Jira email (prefilled from Entra, editable, validated as an email) and GitLab username (optional, letters, digits, `.`, `_`, `-`, at most 64). Both are claims in the tokens, named `jira_email` and `gitlab_username`.
- **Cookies:** the flow cookie and session cookie stay signed, `HttpOnly`, `Secure`, `SameSite=Lax` (Entra returns with a top-level GET). The accept form carries a CSRF token tied to the session.

## Constraints

- The Entra app registration already has `https://qualitycode.teamsystem.cloud/auth/callback`; no new Entra redirect URI is needed (the person registering Entra settings must confirm it).
- `QUALITY_CODE_TOKEN_SECRET` is a new deployment secret (Azure Container Apps secret). The user sets it; nobody pastes it into chat, a file in git, or a test. Rotating it signs everyone out and invalidates registrations, which is the intended way to revoke everything at once.
- `mcp` 2.3.0's auth API is used as it is; no fork.
- Python tests run in `mcp-server/.venv`; the deploy pipeline (`harbor.yml`) is unchanged.
- `dev` is the working branch; releases to `main` through a pull request.

## Part 2 (separate, later)

A small MCP tool, `quality_code_whoami`, returns the caller's email, name, `jira_email` and `gitlab_username` from the token. The plugin's setup phase calls it to prefill `jira_email` and `gitlab_username` with one confirmation. Plugin commands and their tests change in that part, not this one.

## Testing

- Unit tests (pytest): provider methods (`register_client` accepts only allowed redirect URIs, `authorize`, code single-use and expiry, PKCE mismatch refused, refresh, expired token refused), claims round trip, CSRF refusal, tenant mismatch refused, cancel returns `access_denied`, an open-redirect attempt refused. Entra's token exchange is faked, as the current web tests do.
- A flow test with Starlette's test client from `/register` to `/mcp` with the issued token.
- A real check, by a person: add the connector in Claude with a TeamSystem account on the deployed server. Public reports mention Azure sign-in trouble with Claude's callback, whose cause I could not confirm, so this check comes early.

## Left to the builder

File layout inside `quality_code_mcp/`, names of the new routes beyond those above, the page's look (match `web.py`), error wording, and how the token secret is read and validated at start (refuse to start the connector flow when it is missing or short, and say why).

## Open questions for you

1. **The rules text:** who writes it, and where does it live (a file in this repo, or a link to a TeamSystem page)?
2. **Group access:** is a TeamSystem tenant member enough, or must the user be in a specific group (that needs the `groups` claim configured in Entra)?
3. **Keep the Entra-token path** for `/mcp` next to the new tokens? (My call is yes.)
