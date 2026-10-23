// The config command is a prompt, not code: these pin that scripts do every write, and that no
// secret setting ever reaches a command's text (a ${user_config.x} there is shown to the model).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/config.md', import.meta.url), 'utf8')
const plugin = JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
const step = n => doc.slice(doc.indexOf(`\n${n}. **`), doc.indexOf(`\n${n + 1}. **`) === -1 ? doc.indexOf('\n## Examples') : doc.indexOf(`\n${n + 1}. **`))
const BIN = 'node "${CLAUDE_PLUGIN_ROOT}/bin'

test('no command puts a secret setting in its text', () => {
  const secrets = Object.entries(plugin.userConfig).filter(([, s]) => s.sensitive).map(([k]) => k)
  assert.ok(secrets.includes('xray_client_secret'))
  const dir = new URL('../../commands/', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const t = readFileSync(new URL(f, dir), 'utf8')
    for (const k of secrets) assert.ok(!t.includes(`user_config.${k}`), `${f}: ${k}`)
  }
})
test('steps in order: read, the card, change one, done', () => {
  const at = ['Read', 'The card', 'Change one', 'Done'].map((s, i) => doc.indexOf(`\n${i + 1}. **${s}`))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
})
test('step 1: the config check finds repo or personal; the plugin settings come from user_config, secrets never', () => {
  const s = step(1)
  assert.ok(s.includes(`${BIN}/ticket.mjs" config check`))
  for (const k of ['jira_email', 'gitlab_api_url', 'gitlab_username', 'xray_api_url']) assert.ok(s.includes(`\${user_config.${k}}`), k)
  assert.ok(s.includes('`Quality Code is not set up here yet: run /quality-code:setup.`'))
})
test('the card: project, plugin settings, and tokens with their status; the rest to setup advanced', () => {
  const s = step(2)
  assert.match(s, /Project · <path>/)
  assert.match(s, /Your accounts · saved on this computer only, not shared with the team/)
  assert.match(s, /Tokens and keys · kept in your keychain, set in \/plugin/)
  for (const t of ['9. GitLab token', '10. Figma key', '11. Xray API key', '12. GitHub']) assert.ok(s.includes(t), t)
  assert.ok(s.includes('/quality-code:setup advanced'))
  assert.doesNotMatch(doc, /Languages|Italian/, 'languages are not offered: English stays the default')
})
test('token status comes from the connectors\' tools and gh, never from reading a token', () => {
  const s = step(1)
  assert.match(s, /A token connector offers tools only when its token is set/)
  for (const c of ['`gitlab-token`', '`figma-token`', '`xray`']) assert.ok(s.includes(c), c)
  assert.match(s, /`here\.github`/)
})
test('a token is set in /plugin, never in the chat; then checked again', () => {
  const s = step(3)
  assert.match(s, /Never ask for one here: what is typed in the chat is kept in the conversation/)
  assert.ok(s.includes('Set it in /plugin, never in the chat (it goes to your keychain):'))
  for (const k of ['`gitlab_token`', '`figma_api_key`', '`xray_client_id` and `xray_client_secret`']) assert.ok(s.includes(k), k)
  assert.match(s, /`read_api` scope/)
  assert.ok(s.includes('`Still not set: did you run /reload-plugins?`'))
  assert.ok(s.includes('`In a terminal, run gh auth login --hostname <host>, then come back.`'))
})
test('step 3: every write goes through a script that checks it; the project config is the file with one value changed', () => {
  const s = step(3)
  assert.ok(s.includes(`${BIN}/setup.mjs" --write '<proposal JSON>'`))
  assert.ok(s.includes(`${BIN}/setup.mjs" --write-personal '<proposal JSON>'`))
  assert.match(s, /exactly as it is, with only that value changed/)
  for (const flag of ['--jira-save', '--gitlab-check', '--gitlab-save', '--xray-save']) assert.ok(s.includes(`${BIN}/connector-settings.mjs" ${flag}`), flag)
  assert.match(doc, /Never edit `\.claude\/quality-code\.json`, the personal config or a settings file yourself/)
  assert.match(doc, /Never ask for a token/)
})
test('step 4: commit a repo change, reload after a plugin setting', () => {
  const s = step(4)
  assert.ok(s.includes('`Commit .claude/quality-code.json so your team gets it too.`'))
  assert.ok(s.includes('`Type /reload-plugins for it to take effect.`'))
})
