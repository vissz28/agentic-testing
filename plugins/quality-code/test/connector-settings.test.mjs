import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { apiUrlOf, checkGitlab, saveGitlabSettings, saveJiraSettings, validEmail, validUser } from '../core/connector-settings.mjs'

test('apiUrlOf: a host, a site or an API address all give the API address', () => {
  for (const a of ['gitlab.example.com', 'https://gitlab.example.com', 'https://gitlab.example.com/', 'https://gitlab.example.com/api/v4', ' https://gitlab.example.com/api/v4/ '])
    assert.equal(apiUrlOf(a), 'https://gitlab.example.com/api/v4', a)
  assert.equal(apiUrlOf('https://git.example.com/gitlab/api/v4'), 'https://git.example.com/gitlab/api/v4')
})
test('apiUrlOf: plain http only for this machine; anything else is refused', () => {
  assert.equal(apiUrlOf('http://127.0.0.1:9/api/v4'), 'http://127.0.0.1:9/api/v4')
  for (const bad of ['http://gitlab.example.com', 'ftp://x', '', 'not a host', 'https://user:pw@gitlab.example.com', 'https://a.com/x\ny'])
    assert.equal(apiUrlOf(bad), null, JSON.stringify(bad))
})
test('validUser: a username or an email, never a token', () => {
  for (const ok of ['jane.doe', 'jane_doe-2', '@jane', 'jane.doe@example.com']) assert.ok(validUser(ok), ok)
  for (const bad of ['', 'two words', 'glpat-abcdefghijklmnopqrst', 'a'.repeat(256), 'x\ny']) assert.ok(!validUser(bad), bad)
})

const serve = status => new Promise(done => {
  const s = createServer((req, res) => { res.writeHead(req.url === '/api/v4/version' ? status : 404, { 'content-type': 'application/json' }); res.end('{}') })
  s.listen(0, '127.0.0.1', () => done(s))
})
test('checkGitlab: 401 or 200 on /version is a GitLab; anything else is not', async () => {
  for (const [status, ok] of [[401, true], [200, true], [404, false], [500, false]]) {
    const s = await serve(status)
    const r = await checkGitlab(`http://127.0.0.1:${s.address().port}/api/v4`)
    s.close()
    assert.equal(r.ok, ok, String(status))
  }
  const r = await checkGitlab('http://127.0.0.1:1/api/v4')
  assert.equal(r.ok, false)
  assert.match(r.reason, /could not reach/)
})

const settingsFile = initial => {
  const f = join(mkdtempSync(join(tmpdir(), 'qc-gl-settings-')), 'settings.json')
  if (initial !== undefined) writeFileSync(f, JSON.stringify(initial, null, 2))
  return f
}
test('save: only the address and the username go into pluginConfigs; everything else is kept', () => {
  const f = settingsFile({ theme: 'dark', enabledPlugins: { 'quality-code@quality-code': true }, pluginConfigs: { 'other@x': { options: { a: 1 } }, 'quality-code@quality-code': { options: { figma_api_key_hint: 'keep' } } } })
  const r = saveGitlabSettings({ file: f, url: 'biosphere.example.com', user: '@jane.doe' })
  assert.deepEqual(r, { ok: true, plugin: 'quality-code@quality-code', options: { gitlab_api_url: 'https://biosphere.example.com/api/v4', gitlab_username: 'jane.doe' } })
  const d = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(d.theme, 'dark')
  assert.deepEqual(d.pluginConfigs['other@x'], { options: { a: 1 } })
  assert.deepEqual(d.pluginConfigs['quality-code@quality-code'].options,
    { figma_api_key_hint: 'keep', gitlab_api_url: 'https://biosphere.example.com/api/v4', gitlab_username: 'jane.doe' })
  assert.ok(!JSON.stringify(d).includes('gitlab_token'))
})
test('save: the plugin id comes from enabledPlugins; no settings file yet is fine', () => {
  const f = settingsFile({ enabledPlugins: { 'quality-code@team-market': true } })
  assert.equal(saveGitlabSettings({ file: f, url: 'g.example.com', user: 'jane' }).plugin, 'quality-code@team-market')
  const g = settingsFile()
  assert.equal(saveGitlabSettings({ file: g, url: 'g.example.com', user: 'jane' }).ok, true)
  assert.equal(JSON.parse(readFileSync(g, 'utf8')).pluginConfigs['quality-code@quality-code'].options.gitlab_username, 'jane')
})
test('save: a bad address, a bad user or an unreadable settings file changes nothing', () => {
  const f = settingsFile({ theme: 'dark' })
  assert.match(saveGitlabSettings({ file: f, url: 'http://gitlab.example.com', user: 'jane' }).reason, /address/)
  assert.match(saveGitlabSettings({ file: f, url: 'g.example.com', user: 'glpat-abcdefghijklmnopqrst' }).reason, /username or email/)
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { theme: 'dark' })
  const broken = settingsFile()
  writeFileSync(broken, '{ not json')
  assert.match(saveGitlabSettings({ file: broken, url: 'g.example.com', user: 'jane' }).reason, /could not read/)
  assert.equal(readFileSync(broken, 'utf8'), '{ not json')
})
test('jira: the email is saved lower-case next to the GitLab settings; a token or a bad email is refused', () => {
  const f = settingsFile({ pluginConfigs: { 'quality-code@quality-code': { options: { gitlab_username: 'jane' } } } })
  assert.deepEqual(saveJiraSettings({ file: f, email: ' Jane.Doe@Example.com ' }), { ok: true, plugin: 'quality-code@quality-code', options: { jira_email: 'jane.doe@example.com' } })
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).pluginConfigs['quality-code@quality-code'].options, { gitlab_username: 'jane', jira_email: 'jane.doe@example.com' })
  for (const bad of ['jane', 'ATATT3xFfGF0abcdef', 'a b@c.d', '']) {
    assert.ok(!validEmail(bad), bad)
    assert.match(saveJiraSettings({ file: f, email: bad }).reason, /email of your Atlassian account/)
  }
})
test('cli: one JSON line, exit 0 on ok, 1 on a refused value, 2 on bad usage; writes under CLAUDE_CONFIG_DIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-cfgdir-'))
  const cli = new URL('../core/connector-settings.mjs', import.meta.url).pathname
  const run = (...a) => { try { return { code: 0, out: execFileSync('node', [cli, ...a], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8', stdio: 'pipe' }) } } catch (e) { return { code: e.status, out: String(e.stdout) } } }
  const ok = run('--jira-save', 'jane@example.com')
  assert.equal(ok.code, 0)
  assert.match(ok.out, /^CONNECTOR_SETTINGS_JSON:\{"ok":true/)
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).pluginConfigs['quality-code@quality-code'].options.jira_email, 'jane@example.com')
  assert.equal(run('--gitlab-save', 'g.example.com', 'glpat-abcdefghijklmnopqrst').code, 1)
  assert.equal(run('--nope').code, 2)
})
