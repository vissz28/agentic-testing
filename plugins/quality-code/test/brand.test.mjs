// The brand: one display name, the tagline, the logo files and the listing metadata.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
const market = JSON.parse(readFileSync(new URL('../../../.claude-plugin/marketplace.json', import.meta.url), 'utf8'))
const TAGLINE = 'From Jira ticket to tests you can trust.'

test('the display name is Quality Code everywhere a person reads it; the install name stays quality-code', () => {
  assert.equal(plugin.name, 'quality-code')
  assert.equal(plugin.displayName, 'Quality Code')
  assert.equal(market.plugins.find(p => p.name === 'quality-code').displayName, 'Quality Code')
})
test('the marketplace is teamsystem, so the plugin installs as quality-code@teamsystem; the owner and author stay', () => {
  assert.equal(market.name, 'teamsystem')
  assert.equal(market.plugins.find(p => p.name === 'quality-code').source, './plugins/quality-code')
  assert.equal(market.owner.name, 'Elvis Zefaj')
  assert.equal(plugin.author.name, 'Elvis Zefaj')
})
test('the plugin README opens with the tagline and has a Try it section ending in the start command', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(readme.startsWith(`# Quality Code\n\n${TAGLINE}`))
  assert.match(readme, /## Try it\n\n(- ".+"\n)+\n…or type `\/quality-code:spec` in any chat/)
})
test('the plugin description opens with the tagline', () => {
  assert.ok(plugin.description.startsWith(TAGLINE))
  assert.match(market.metadata.description, /from Jira ticket to tests you can trust/)
})
test('the icon is the logo PNG inside the plugin, with its SVG source next to it', () => {
  assert.equal(plugin.icon, './assets/logo.png')
  for (const f of ['../assets/logo.png', '../assets/logo.svg']) assert.ok(existsSync(new URL(f, import.meta.url)), f)
  const png = readFileSync(new URL('../assets/logo.png', import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 512])
})
test('the listing links point at this repository', () => {
  for (const k of ['homepage', 'repository', 'documentationUrl', 'supportUrl']) assert.match(plugin[k], /^https:\/\/github\.com\/vissz28\/agentic-testing/, k)
})
