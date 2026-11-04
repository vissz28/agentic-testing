// The config command's text: the quick `set`/`get` way, the short summary card first, scripts write.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/config.md', import.meta.url), 'utf8')
const BIN = 'node "${CLAUDE_PLUGIN_ROOT}/bin'
const quick = doc.slice(doc.indexOf('## The quick way'), doc.indexOf('## Steps'))

test('the quick way runs config get and config set, previews first, --yes on the yes', () => {
  assert.ok(quick.length > 200)
  assert.ok(quick.includes(`${BIN}/ticket.mjs" config get <key>\``))
  assert.ok(quick.includes(`${BIN}/ticket.mjs" config set <key> <value>\``))
  assert.match(quick, /without `--yes`/)
  assert.match(quick, /<old> -> <new>/)
  assert.match(quick, /picker/)
  assert.match(quick, /same command again with `--yes`/)
  assert.match(quick, /`--personal` or `--project`/)
})
test('the quick way lists the keys and the examples of the ticket', () => {
  for (const k of ['jira.projects', 'git.base', 'ticketsDir', 'jira.site', 'place']) assert.ok(quick.includes(`\`${k}\``) || doc.includes(`config set ${k}`) || doc.includes(`config get ${k}`), k)
  assert.ok(quick.includes('/quality-code:config set jira.projects ABC,DEF'))
})
test('tokens and plugin settings stay out, with the /plugin steps', () => {
  assert.match(quick, /tokens, keys, passwords and the plugin settings/)
  assert.match(quick, /Set it in \/plugin, never in the chat/)
  assert.match(quick, /looks like a token or key/)
})
test('the card starts short and shows the quick way; the full card stays for `all`', () => {
  const s = doc.slice(doc.indexOf('\n2. **The card'), doc.indexOf('\n3. **Change one'))
  assert.match(s, /short summary/)
  assert.match(s, /"all" for every setting/)
  assert.match(s, /The quick way: \/quality-code:config set <key> <value>/)
  assert.ok(s.includes('11. GitLab token'))
})
test('scripts write: ticket.mjs config set is named beside setup.mjs', () => {
  assert.match(doc, /written only by `setup\.mjs` or `ticket\.mjs config set`/)
})
