// /quality-code:config get|set|keys: thin text over `ticket.mjs config get|set|keys`, tokens refused with the /plugin steps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { KEYS, EXAMPLES, keyRows, refusal, pluginSteps } from '../../lib/config/set.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const config = read('commands/config.md')
const CLI = fileURLToPath(new URL('../../bin/ticket.mjs', import.meta.url))
const BIN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs"'
const TOKEN_KEYS = ['gitlab_token', 'figma_api_key', 'xray_client_id', 'xray_client_secret']

test('frontmatter: the argument hint names get, set and keys', () => {
  assert.match(config, /\nargument-hint: '?\[get <key> \| set <key> <value> \| keys\] \[--personal\|--project\] \[--yes\]'?\n/)
})
test('config set: preview without --yes, one yes via the picker, --yes skips it, already set stops', () => {
  assert.ok(config.includes(`${BIN} config set <key> <value>`))
  assert.match(config, /without `--yes`/)
  assert.match(config, /<old> -> <new>/)
  assert.match(config, /\| Setting \| Old \| New \|/)
  assert.ok(config.includes('`Yes` / `No`'))
  assert.match(config, /run the same command again with `--yes`/)
  assert.match(config, /already wrote `--yes`/)
  assert.ok(config.includes('Nothing to change: already set.'))
})
test('config keys lists the keys from the script; config get reads one', () => {
  assert.ok(config.includes(`${BIN} config keys`))
  assert.match(config, /\| Key \| Takes \| Example \|/)
  assert.ok(config.includes(`${BIN} config get <key>`))
})
test('config never asks for or shows a token, and points to /plugin', () => {
  assert.match(config, /Never ask for a token/)
  assert.ok(config.includes('/plugin, choose quality-code, Configure options, then /reload-plugins'))
})
test('config-get and config-set are gone: /quality-code:config does both', () => {
  for (const f of ['config-get', 'config-set']) assert.throws(() => read(`commands/${f}.md`), f)
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
test('wiring: README table, MCP README tools', () => {
  const readme = read('README.md'), mcp = read('mcp-server/README.md')
  assert.ok(readme.includes('`config set <key> <value>`') && readme.includes('`config get <key>`') && readme.includes('`config keys`'))
  assert.ok(mcp.includes('`quality_code_config`') && !mcp.includes('quality_code_config_set') && !mcp.includes('quality_code_config_get'))
})
