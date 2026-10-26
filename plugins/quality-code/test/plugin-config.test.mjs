// The connectors and personal settings the plugin ships: each service can be reached by browser
// sign-in or by a token, GitLab only ever reads, packages are pinned, and secrets stay secret.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mcp = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8')).mcpServers
const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
const settings = plugin.userConfig

test('the seven connectors: Jira, Figma and GitLab by browser sign-in, Figma and GitLab by token, Xray by API key, Jira files by API token', () => {
  assert.deepEqual(Object.keys(mcp).sort(), ['atlassian-rovo', 'figma', 'figma-token', 'gitlab', 'gitlab-token', 'jira-files', 'xray'])
  assert.deepEqual(mcp['atlassian-rovo'], { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' })
  assert.deepEqual(mcp.figma, { type: 'http', url: 'https://mcp.figma.com/mcp' })
})
// The token connectors start through bin/mcp-launch.mjs: the real server with a token, a server
// with no tools without one, so a connector nobody set up is never reported as failed.
const LAUNCH = '${CLAUDE_PLUGIN_ROOT}/bin/mcp-launch.mjs'
test('figma-token: the pinned Framelink server with the secret key, through the launcher', () => {
  const f = mcp['figma-token']
  assert.equal(f.command, 'node')
  assert.deepEqual(f.args, [LAUNCH, 'figma-token', '--', 'npx', '-y', 'figma-developer-mcp@0.13.2', '--stdio'])
  assert.deepEqual(f.env, { FIGMA_API_KEY: '${user_config.figma_api_key}' })
})
test('the launcher knows each token connector and the variable its env sets', async () => {
  const { CONNECTORS } = await import('../bin/mcp-launch.mjs')
  const launched = Object.entries(mcp).filter(([, s]) => s.command === 'node')
  assert.deepEqual(launched.map(([n]) => n).sort(), Object.keys(CONNECTORS).sort())
  for (const [name, s] of launched) {
    assert.deepEqual(s.args.slice(0, 3), [LAUNCH, name, '--'], name)
    assert.match(s.env[CONNECTORS[name]], /^\$\{user_config\.\w+\}$/, name)
  }
})
test('gitlab: browser sign-in through GitLab\'s own MCP server, like Jira; token through the pinned read-only package', () => {
  assert.deepEqual(mcp.gitlab, { type: 'http', url: '${user_config.gitlab_api_url}/mcp' })
  assert.equal(mcp['gitlab-token'].command, 'node')
  assert.deepEqual(mcp['gitlab-token'].args, [LAUNCH, 'gitlab-token', '--', 'npx', '-y', '@zereight/mcp-gitlab@2.2.5'])
  assert.deepEqual(mcp['gitlab-token'].env, {
    GITLAB_API_URL: '${user_config.gitlab_api_url}',
    GITLAB_PERSONAL_ACCESS_TOKEN: '${user_config.gitlab_token}',
    GITLAB_PERMISSION_MODE: 'readonly',
  })
})
test('xray: the plugin\'s own API server, through the launcher, with the key and the address from the settings', () => {
  assert.deepEqual(mcp.xray.args, [LAUNCH, 'xray', '--', 'node', '${CLAUDE_PLUGIN_ROOT}/bin/xray-api.mjs'])
  assert.deepEqual(mcp.xray.env, {
    XRAY_API_URL: '${user_config.xray_api_url}',
    XRAY_CLIENT_ID: '${user_config.xray_client_id}',
    XRAY_CLIENT_SECRET: '${user_config.xray_client_secret}',
  })
})
test('jira-files: the plugin\'s own attachment reader, through the launcher, with the email and the API token from the settings', () => {
  assert.deepEqual(mcp['jira-files'].args, [LAUNCH, 'jira-files', '--', 'node', '${CLAUDE_PLUGIN_ROOT}/bin/jira-files.mjs'])
  assert.deepEqual(mcp['jira-files'].env, { JIRA_EMAIL: '${user_config.jira_email}', JIRA_API_TOKEN: '${user_config.jira_api_token}' })
})
test('no connector runs an unpinned package', () => {
  // The package is the argument after npx's -y; every token connector runs one, except the plugin's own script.
  for (const [name, s] of Object.entries(mcp)) {
    const args = s.args ?? []
    if (args.includes('${CLAUDE_PLUGIN_ROOT}/bin/xray-api.mjs') || args.includes('${CLAUDE_PLUGIN_ROOT}/bin/jira-files.mjs')) continue
    const pkgs = args.filter((_, i) => args[i - 1] === '-y')
    if (args.length) assert.equal(pkgs.length, 1, name)
    for (const a of pkgs) assert.doesNotMatch(a, /@latest$|^[a-z@][^@]*[^@\d]$/, `${name}: ${a}`)
  }
})
test('settings: tokens are secret, the rest are not; every setting a connector uses exists', () => {
  assert.deepEqual(Object.keys(settings).sort(), ['figma_api_key', 'gitlab_api_url', 'gitlab_token', 'gitlab_username', 'jira_api_token', 'jira_email', 'xray_api_url', 'xray_client_id', 'xray_client_secret'])
  for (const k of ['figma_api_key', 'gitlab_token', 'jira_api_token', 'xray_client_id', 'xray_client_secret']) assert.equal(settings[k].sensitive, true, k)
  assert.notEqual(settings.xray_api_url.sensitive, true)
  assert.equal(settings.xray_api_url.default, 'https://xray.cloud.getxray.app')
  assert.notEqual(settings.gitlab_api_url.sensitive, true)
  assert.notEqual(settings.gitlab_username.sensitive, true)
  assert.notEqual(settings.jira_email.sensitive, true)
  // A generic default, never one team's GitLab; a self-hosted GitLab is set per user.
  assert.equal(settings.gitlab_api_url.default, 'https://gitlab.com/api/v4')
  const used = JSON.stringify(mcp).match(/\$\{user_config\.(\w+)\}/g).map(s => s.slice(14, -1))
  for (const u of used) assert.ok(settings[u], u)
})
test('setting descriptions say which way each one is for', () => {
  assert.match(settings.gitlab_token.description, /read_api/)
  assert.match(settings.gitlab_username.description, /confirms/)
  assert.match(settings.gitlab_api_url.description, /no \/ at the end/)
  assert.match(settings.figma_api_key.description, /optional/i)
})
