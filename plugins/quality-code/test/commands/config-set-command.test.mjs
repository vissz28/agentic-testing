// The config-set and config-get commands: thin text over `ticket.mjs config set|get|keys`, tokens refused with the /plugin steps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { KEYS, EXAMPLES, keyRows, refusal, pluginSteps } from '../../lib/config/set.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const set = read('commands/config-set.md')
const get = read('commands/config-get.md')
const CLI = fileURLToPath(new URL('../../bin/ticket.mjs', import.meta.url))
const BIN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs"'
const TOKEN_KEYS = ['gitlab_token', 'figma_api_key', 'xray_client_id', 'xray_client_secret', 'jira_api_token']

test('frontmatter: argument hints and models', () => {
  assert.match(set, /^---\ndescription: .+\nargument-hint: <key> <value> \[--personal\|--project\] \[--yes\]\n/)
  assert.match(set, /\nmodel: sonnet\n---/)
  assert.match(get, /^---\ndescription: .+\nargument-hint: <key> \[--personal\|--project\]\n/)
  assert.match(get, /\nmodel: haiku\neffort: low\n---/)
})
test('config-set: same script and flow as config set, one yes via the picker, --yes skips it', () => {
  assert.ok(set.includes(`${BIN} config set <key> <value>`))
  assert.match(set, /without `--yes`/)
  assert.match(set, /<old> -> <new>/)
  assert.match(set, /\| Setting \| Old \| New \|/)
  assert.match(set, /AskUserQuestion/)
  assert.ok(set.includes('`Yes` / `No`'))
  assert.match(set, /same command again with `--yes`/)
  assert.match(set, /With `--yes` in `\$ARGUMENTS`/)
  assert.match(set, /An error writes nothing/)
  assert.ok(set.includes('guides/display.md') && set.includes('guides/language.md'))
  assert.match(set, /Run each plugin script exactly as written/)
})
test('config-set: no arguments lists the keys from the script', () => {
  assert.ok(set.includes(`${BIN} config keys`))
  assert.match(set, /\| Key \| Takes \| Example \|/)
  assert.match(set, /Next line/)
})
test('config-get runs config get and never shows a token', () => {
  assert.ok(get.includes(`${BIN} config get <key>`))
  assert.match(get, /Never show a token/)
  assert.match(get, /only `set` or `not set`/)
})
test('config keys prints every settable key with an example, from the key table', () => {
  const r = spawnSync(process.execPath, [CLI, 'config', 'keys'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const rows = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('CONFIG_KEYS_JSON:')).slice('CONFIG_KEYS_JSON:'.length))
  assert.deepEqual(rows.map(x => x.key), Object.keys(KEYS))
  assert.ok(rows.every(x => x.example), 'every key has an example')
  assert.deepEqual(Object.keys(EXAMPLES).sort(), Object.keys(KEYS).sort())
  assert.equal(keyRows().length, Object.keys(KEYS).length)
  for (const k of ['jira.projects', 'git.base', 'ticketsDir', 'place']) assert.ok(r.stdout.includes(k), k)
})
test('a token key is refused with the exact /plugin steps and no value is echoed', () => {
  const secret = 'glpat-AbCdEf0123456789xyz'
  for (const k of TOKEN_KEYS) {
    const m = refusal(k, secret)
    assert.match(m, /protected plugin setting/, k)
    assert.ok(m.includes('/plugin configure quality-code@teamsystem'), k)
    assert.ok(m.includes('/reload-plugins'), k)
    assert.ok(!m.includes(secret), k)
    const r = spawnSync(process.execPath, [CLI, 'config', 'set', k, secret, '--yes'], { encoding: 'utf8' })
    assert.equal(r.status, 2, k)
    assert.ok(!(r.stdout + r.stderr).includes(secret), `${k} echoed the value`)
    assert.ok(r.stderr.includes('/plugin configure quality-code@teamsystem'), k)
  }
  const g = refusal('gitlab_token')
  assert.ok(g.includes('field gitlab_token') && g.includes('read_api'))
  assert.ok(g.includes('/quality-code:config shows only "set" or "not set"'))
  assert.ok(refusal('figma_api_key').includes('field figma_api_key'))
})
test('plugin settings that are not secret point to the same screen', () => {
  for (const k of ['jira_email', 'gitlab_username', 'gitlab_api_url']) {
    assert.ok(refusal(k, 'x').includes('/plugin configure quality-code@teamsystem'), k)
    assert.ok(pluginSteps(k).join('\n').includes(`field ${k}`), k)
  }
})
test('a secret-like value in an ordinary key is not used or echoed', () => {
  const v = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
  const m = refusal('git.base', v)
  assert.match(m, /looks like a token/)
  assert.ok(!m.includes(v))
})
test('the command text names the steps for the token fields and never asks for a value', () => {
  for (const f of ['gitlab_token', 'figma_api_key', 'xray_client_id', 'xray_client_secret', 'read_api']) assert.ok(set.includes(f), f)
  assert.ok(set.includes('/plugin configure quality-code@teamsystem'))
  assert.ok(set.includes('/reload-plugins'))
  assert.match(set, /Never ask for a token/)
  assert.match(set, /never repeat a value the person typed/)
  assert.ok(set.includes('shows only set or not set'))
})
test('config set still works through /quality-code:config', () => {
  assert.ok(read('commands/config.md').includes(`${BIN} config set <key> <value>`))
})
test('wiring: README table, MCP README tools', () => {
  const readme = read('README.md'), mcp = read('mcp-server/README.md')
  assert.ok(readme.includes('/quality-code:config-set <key> <value>') && readme.includes('/quality-code:config-get <key>'))
  assert.ok(mcp.includes('quality_code_config_set') && mcp.includes('quality_code_config_get'))
})
