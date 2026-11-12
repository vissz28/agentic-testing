# No Playwright yet: offer it

Used by `/quality-code:check --frontend` (and `--smoke`) when the script stops with `This project has no frontend (Playwright) tests: its config has no "frontend".` or `No @smoke tests found` on a project that has no Playwright config. Playwright runs the app in a real browser; without it there is nothing to check on the frontend. With `--ci`, never ask: show the script's line and stop.

## 1. The card

Ask with the picker (display guide) and end the turn:

```
This project has no Playwright tests yet. Playwright opens the app in a browser, so the frontend can be checked end to end. Set it up now?
1. Yes: install Playwright, add its config and a first test, then run the frontend check
2. No
3. Other (say what you want, for example Cypress, or a different command to start the app)
```

- **2:** say `Nothing changed. The frontend check needs Playwright (or Cypress).` and stop.
- **3:** do what the person says. Cypress is already read by the plugin through `runners.e2e` (set it with `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config set runners.e2e cypress`); a different start command or address is used in step 2. Anything else you cannot do: say so and stop.
- **1:** go on.

## 2. Find what setup needs

1. `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --detect`, read the `SETUP_JSON:` line: `existing` (the project config), `scaffold` (`command`, `url`, `install`, `browsers`, `files`, `problem`).
2. `scaffold` is null or has a `problem` (for example a Playwright config is already there, or this is a monorepo root): say it in one line and stop. For a monorepo, say `Run /quality-code:setup from the frontend folder to add Playwright there.`
3. `scaffold.command` null: ask `Which command starts the app? For example npm run dev.`; `scaffold.url` null: ask `At which address does <command> open the app? For example http://localhost:3000.` (one question per turn; a command is one line, an address starts with http:// or https://).
4. Ask once with the picker: `Does the app need a sign-in?` `1. No` / `2. Yes`. On yes, setup adds the sign-in files and git-ignore lines; the person fills in the test account in `.env.e2e` afterwards, never in the chat.
5. Show what will happen and end the turn:

```
Playwright setup
  Installs  <scaffold.install, or "the Chromium browser" when it is null>
  Writes    <scaffold.files, comma-separated>
  App       <command> at <url>
  Config    adds "frontend": "playwright"
1. Go ahead
2. Stop
```

## 3. Install and write

1. Say `Installing Playwright; this can take a minute.` Run `scaffold.install` when it is set, then `scaffold.browsers`, each exactly as detect gave it, one call each. If one fails, show its last lines and stop: nothing is written.
2. Build the proposal from `existing`: keep every field. Add `"frontend": "playwright"`; `backend` stays as it is. Add `"scaffold": { "command": …, "url": …, "signIn": true|false }` next to `config`.
3. `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'` (the JSON inline, one single-quoted argument; a `'` inside a value is `'\''`). Errors: show them as they are and stop. It never replaces a file that exists.
4. Say `Playwright is set up: <files written>.` then run the check again as the command says (the same suite, `--frontend` or `--smoke`) and show its card.
