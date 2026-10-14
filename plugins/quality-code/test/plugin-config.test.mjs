// The connectors and personal settings the plugin ships: each service can be reached by browser
// sign-in or by a token, GitLab only ever reads, packages are pinned, and secrets stay secret.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mcp = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8')).mcpServers
const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
const settings = plugin.userConfig

test('the five connectors: Jira, Figma and GitLab by browser sign-in, Figma and GitLab by token', () => {
  assert.deepEqual(Object.keys(mcp).sort(), ['atlassian-rovo', 'figma', 'figma-token', 'gitlab', 'gitlab-token'])
  assert.deepEqual(mcp['atlassian-rovo'], { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' })
  assert.deepEqual(mcp.figma, { type: 'http', url: 'https://mcp.figma.com/mcp' })
})
test('figma-token: the pinned Framelink server with the secret key', () => {
  const f = mcp['figma-token']
  assert.equal(f.command, 'npx')
  assert.deepEqual(f.args, ['-y', 'figma-developer-mcp@0.13.2', '--stdio'])
  assert.deepEqual(f.env, { FIGMA_API_KEY: '${user_config.figma_api_key}' })
})
test('gitlab: browser sign-in (public OAuth app, PKCE) and token, both read-only, same pinned package', () => {
  const pkg = ['-y', '@zereight/mcp-gitlab@2.2.5']
  assert.deepEqual(mcp.gitlab.args, pkg)
  assert.deepEqual(mcp['gitlab-token'].args, pkg)
  assert.deepEqual(mcp.gitlab.env, {
    GITLAB_API_URL: '${user_config.gitlab_api_url}',
    GITLAB_USE_OAUTH: 'true',
    GITLAB_OAUTH_CLIENT_ID: '${user_config.gitlab_oauth_client_id}',
    GITLAB_OAUTH_REDIRECT_URI: 'http://127.0.0.1:8888/callback',
    GITLAB_PERMISSION_MODE: 'readonly',
  })
  assert.deepEqual(mcp['gitlab-token'].env, {
    GITLAB_API_URL: '${user_config.gitlab_api_url}',
    GITLAB_PERSONAL_ACCESS_TOKEN: '${user_config.gitlab_token}',
    GITLAB_PERMISSION_MODE: 'readonly',
  })
})
test('no connector runs an unpinned package', () => {
  for (const [name, s] of Object.entries(mcp)) for (const a of s.args ?? []) assert.doesNotMatch(a, /@latest$|^[a-z@][^@]*[^@\d]$/, `${name}: ${a}`)
})
test('settings: tokens are secret, the rest are not; every setting a connector uses exists', () => {
  assert.deepEqual(Object.keys(settings).sort(), ['figma_api_key', 'gitlab_api_url', 'gitlab_oauth_client_id', 'gitlab_token'])
  assert.equal(settings.figma_api_key.sensitive, true)
  assert.equal(settings.gitlab_token.sensitive, true)
  assert.notEqual(settings.gitlab_api_url.sensitive, true)
  assert.notEqual(settings.gitlab_oauth_client_id.sensitive, true)
  assert.equal(settings.gitlab_api_url.default, 'https://biosphere.teamsystem.com/api/v4')
  const used = JSON.stringify(mcp).match(/\$\{user_config\.(\w+)\}/g).map(s => s.slice(14, -1))
  for (const u of used) assert.ok(settings[u], u)
})
test('setting descriptions say which way each one is for', () => {
  assert.match(settings.gitlab_token.description, /read_api/)
  assert.match(settings.gitlab_oauth_client_id.description, /Application ID/)
  assert.match(settings.figma_api_key.description, /optional/i)
})
