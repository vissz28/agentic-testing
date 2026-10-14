// The connectors check is a prompt read by setup and start: these pin what keeps it safe and usable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../core/connectors.md', import.meta.url), 'utf8')
const setup = readFileSync(new URL('../commands/setup.md', import.meta.url), 'utf8')
const step = (d, n) => d.slice(d.indexOf(`\n${n}. **`), d.indexOf(`\n${n + 1}. **`))

test('Jira is checked with getAccessibleAtlassianResources and blocks', () => {
  assert.match(doc, /getAccessibleAtlassianResources/)
  assert.ok(doc.includes('Jira is required. Type /mcp, choose atlassian-rovo and sign in'))
  assert.ok(doc.includes('1. Check again'))
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
  assert.match(doc, /`gitlab_oauth_client_id`/)
  assert.match(doc, /read_api/)
  assert.match(doc, /http:\/\/127\.0\.0\.1:8888\/callback/)
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
  assert.ok(s.includes('${CLAUDE_PLUGIN_ROOT}/core/connectors.md'))
  assert.ok(setup.indexOf('\n0. **Connectors.**') < setup.indexOf('\n1. **This project.**'))
})
