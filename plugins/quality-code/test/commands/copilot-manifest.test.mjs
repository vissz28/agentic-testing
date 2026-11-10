// Copilot CLI loads a plugin's commands only when its own manifest lists them; Claude Code reads .claude-plugin and ignores .plugin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

test('the Copilot manifest lists the commands folder and the MCP file, and is the same version as the plugin', () => {
  const copilot = read('../../.plugin/plugin.json')
  assert.equal(copilot.name, 'quality-code')
  assert.equal(copilot.commands, 'commands')
  assert.ok(existsSync(new URL('../../commands/', import.meta.url)))
  assert.ok(existsSync(new URL('../../' + copilot.mcpServers, import.meta.url)))
  assert.equal(copilot.version, read('../../.claude-plugin/plugin.json').version)
})
