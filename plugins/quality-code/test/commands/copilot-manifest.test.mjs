// Copilot CLI loads a plugin's commands only when its own manifest lists them; Claude Code reads .claude-plugin and ignores .plugin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

test('the Copilot manifest lists the commands folder and the MCP file, and is the same version as the plugin', () => {
  const copilot = read('../../.plugin/plugin.json')
  assert.equal(copilot.name, 'quality-code')
  assert.equal(copilot.commands, 'commands')
  assert.ok(existsSync(new URL('../../commands/', import.meta.url)))
  assert.ok(existsSync(new URL('../../' + copilot.mcpServers, import.meta.url)))
  assert.equal(copilot.version, read('../../.claude-plugin/plugin.json').version)
})

test('every command frontmatter is strict YAML: Copilot skips a command whose frontmatter does not parse', () => {
  const dir = new URL('../../commands/', import.meta.url)
  for (const f of readdirSync(dir).filter(n => n.endsWith('.md'))) {
    const lines = readFileSync(new URL(f, dir), 'utf8').split('\n---\n')[0].split('\n').slice(1)
    for (const line of lines.filter(l => /^[a-z-]+: /.test(l))) {
      const v = line.slice(line.indexOf(': ') + 2)
      const ok = /^'(?:[^']|'')*'$/.test(v) || /^"(?:[^"\\]|\\.)*"$/.test(v) || !(/: |^[|>&*!%@`\[{#'"-]| #/.test(v))
      assert.ok(ok, `${f}: ${line.slice(0, 60)} is not valid YAML as written: quote the value`)
    }
  }
})
