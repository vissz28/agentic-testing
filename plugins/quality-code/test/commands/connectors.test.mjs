// The connectors check is a prompt read by setup and start: these pin what keeps it safe and usable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../guides/connectors.md', import.meta.url), 'utf8')
const setup = readFileSync(new URL('../../commands/setup.md', import.meta.url), 'utf8')
const step = (d, n) => d.slice(d.indexOf(`\n${n}. **`), d.indexOf(`\n${n + 1}. **`))

test('Jira is checked with getAccessibleAtlassianResources and blocks', () => {
  assert.match(doc, /getAccessibleAtlassianResources/)
  assert.ok(doc.includes('Jira is required. Type /mcp, choose atlassian-rovo and sign in'))
  assert.ok(doc.includes('1. Check again'))
  assert.ok(doc.includes('2. Set my Jira email'))
  assert.match(doc, /Never go past this card without Jira/)
})
test('GitLab and Figma never block', () => {
  assert.match(doc, /GitLab and Figma never block/)
  assert.ok(doc.includes('2. Continue without it'))
})
test('Figma only for playwright', () => {
  assert.match(doc, /Figma only when the adapter is `playwright`/)
  assert.match(doc, /For `vitest`, leave Figma off the card/)
})
test('the card has the three states and the two choices', () => {
  for (const s of ['✅', '⚠️', '➖', '1. Continue', '2. Fix one first']) assert.ok(doc.includes(s), s)
})
test('no token is ever asked for or shown; fixes go through the plugin settings', () => {
  assert.match(doc, /Never ask for a token, key or password in the chat/)
  assert.match(doc, /`gitlab_token`/)
  assert.match(doc, /`figma_api_key`/)
  assert.match(doc, /Do not paste it here/)
})
test('GitLab and Figma: browser sign-in or token, either one is enough', () => {
  for (const c of ['`gitlab`', '`gitlab-token`', '`figma`', '`figma-token`']) assert.ok(doc.includes(c), c)
  assert.match(doc, /either connector answers/)
  assert.match(doc, /read_api/)
  assert.doesNotMatch(doc, /gitlab_oauth_client_id|8888\/callback/)
  assert.match(doc, /`gitlab_api_url`/)
  assert.match(doc, /unused one stays disconnected/)
  assert.doesNotMatch(doc, /gitlab_mcp_url/)
})
test('connector status is not written to the config', () => {
  assert.match(doc, /Nothing here is written to `\.claude\/quality-code\.json`/)
})
test('tools are named by operation, never by an mcp__ name', () => {
  assert.doesNotMatch(doc, /mcp__/)
})
test('setup step 0 reads the connectors check before the project card', () => {
  const s = step(setup, 0)
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/guides/connectors.md'))
  assert.ok(setup.indexOf('\n0. **Connectors.**') < setup.indexOf('\n1. **This project.**'))
})
test('GitLab browser sign-in is like Jira: /mcp, choose gitlab, sign in; an instance without the server says so', () => {
  assert.ok(doc.includes('type /mcp, choose `gitlab` and sign in in the browser'))
  assert.match(doc, /no application to create/)
  assert.match(doc, /\/api\/v4\/mcp/)
  assert.match(doc, /ask a GitLab admin/)
})
test('the GitLab username is confirmed against who is signed in, and shown on the card', () => {
  assert.match(doc, /`gitlab_username`/)
  assert.ok(doc.includes('✅ GitLab             <username> on <host>'))
  assert.match(doc, /belongs to <actual>, not <gitlab_username>/)
})
test('every command that checks connectors hands over the GitLab username from the settings', () => {
  for (const c of ['setup', 'spec', 'seed']) {
    const t = readFileSync(new URL(`../../commands/${c}.md`, import.meta.url), 'utf8')
    for (const k of ['jira_email', 'gitlab_username', 'gitlab_api_url']) assert.ok(t.includes(`\`\${user_config.${k}}\``), `${c} ${k}`)
  }
})
test('only what is not secret is asked in the chat, and saved by the script, never by hand', () => {
  assert.match(doc, /Only what is not secret: your Jira email, your GitLab address, your GitLab username or email/)
  assert.match(doc, /never by editing a settings file yourself/)
  for (const c of ['--jira-save', '--gitlab-check', '--gitlab-save']) assert.ok(doc.includes(`bin/connector-settings.mjs" ${c}`), c)
  assert.match(doc, /A token is set only in the `\/plugin` dialog/)
})
test('a pasted token is never used, repeated or saved', () => {
  assert.ok(doc.includes("Please don't paste tokens here. Revoke that one and set a new one from /plugin."))
  assert.match(doc, /do not use it, do not repeat it and do not save it/)
})
test('Jira shows the signed-in email on the site and warns on another account or a site it cannot see', () => {
  assert.match(doc, /atlassianUserInfo/)
  assert.ok(doc.includes('✅ Jira (Atlassian)   <email> on <site host>'))
  assert.match(doc, /signed in as <actual>, not <jira_email>/)
  assert.match(doc, /this account cannot see <site host>/)
})
test('after saving, the fixes say to reload plugins before reconnecting', () => {
  assert.equal((doc.match(/\/reload-plugins/g) ?? []).length, 3)
})
test('the token way asks the address, checks it is a GitLab, asks the user, and leaves only the token to /plugin', () => {
  const g = doc.slice(doc.indexOf('**GitLab fix.**'), doc.indexOf('**Figma fix.**'))
  const order = ['Your GitLab address?', '--gitlab-check', 'Your GitLab username or email?', '--gitlab-save', 'set `gitlab_token`']
  const at = order.map(x => g.indexOf(x))
  assert.ok(at.every(i => i >= 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('all connectors ✅: one line and go on, no card; optional ones missing never stop the command', () => {
  assert.ok(doc.includes('Connectors: ✅ Jira <email> on <site host> · ✅ GitLab <username> on <host>'))
  assert.match(doc, /Every service ✅: show only that line and go on, with no card/)
  assert.match(doc, /Only Jira not ✅ stops the command/)
})
test('every Rovo operation the commands use has its claude.ai connector name, or discover', () => {
  for (const [rovo, other] of [['addCommentToJiraIssue', 'addOrEditJiraIssueComment'], ['searchConfluenceUsingCql', 'searchConfluence'], ['reading a Confluence page', 'getConfluenceContent']]) {
    assert.match(doc, new RegExp(`\\| \`?${rovo}\`? \\| \`${other}\``), rovo)
  }
  for (const op of ['getVisibleJiraProjects', 'getJiraProjectIssueTypesMetadata', 'getJiraIssueTypeMetaWithFields', 'listJiraIssueRemoteIssueLinks', 'lookupJiraAccountId']) assert.ok(doc.includes(`\`${op}\``), op)
  assert.match(doc, /find the operation with `discover`.*`executeRead`/)
  assert.match(doc, /\*\*Updating a comment\.\*\* .*`addOrEditJiraIssueComment` with that comment's id/)
  for (const c of ['setup', 'ticket-eval', 'ticket']) {
    const t = readFileSync(new URL(`../../commands/${c}.md`, import.meta.url), 'utf8')
    assert.ok(t.includes('"Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`'), c)
  }
})
test('which connectors: GitLab only for a GitLab remote, Figma for playwright and fullstack; every caller listed', () => {
  assert.match(doc, /GitLab when `here\.gitlab` is set .* or `gitlab_api_url` is: otherwise \(a GitHub or other remote, or none\) leave GitLab off the card/)
  assert.match(doc, /Figma only when the adapter is `playwright` or `fullstack`/)
  assert.match(doc, /From `spec`, `seed` and `xray`, an optional service/)
  for (const c of ['setup', 'spec', 'seed', 'xray']) assert.ok(doc.split('\n')[2].includes(`/quality-code:${c}`), c)
})
