// Every plugin file that is named as plain text exists. The command prompts, the hook, the manifests, the
// MCP server, the Dockerfile, the CI workflows and the docs name files as text, so a moved or renamed file breaks
// them without any import failing: only a user running that command would find out. This test finds out first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('../', import.meta.url))
const REPO = join(PLUGIN, '../..')
const TOP = 'bin|lib|guides|commands|resources|rules|hooks|output-styles'
const FILE = '[A-Za-z0-9_./-]+'

const filesIn = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter(f => ext.some(e => f.endsWith(e))).map(f => join(dir, f)) : [])
const lineOf = (text, index) => text.slice(0, index).split('\n').length
/** A path that names a pattern or a placeholder, not one file: <script>, …, * */
const placeholder = (text, end) => /^[<…*{]/.test(text.slice(end))
const tidy = p => p.replace(/[.,:;]+$/, '').replace(/\/$/, '')

/** [where, path, base] for every path a file names, with the folder it is relative to. */
function referencesIn(file, rules) {
  const text = readFileSync(file, 'utf8')
  const found = []
  for (const { re, base, group = 1 } of rules) {
    for (const m of text.matchAll(re)) {
      const path = m[group]
      if (placeholder(text, m.index + m[0].length)) continue
      found.push([`${relative(REPO, file)}:${lineOf(text, m.index)}`, tidy(path), base])
    }
  }
  return found
}

// In the plugin's own text: ${CLAUDE_PLUGIN_ROOT}/x, a bare bin/x.mjs or guides/x.md, and run-node.cmd's script.
const PLUGIN_RULES = [
  { re: new RegExp(`\\$\\{CLAUDE_PLUGIN_ROOT\\}/(${FILE})`, 'g'), base: PLUGIN },
  { re: new RegExp(`(?<=[\`( "'])((?:${TOP})/${FILE}\\.(?:mjs|md|json|pdf|cmd|ps1|png))`, 'g'), base: PLUGIN },
  { re: /run-node\.cmd\\?"? ([a-z-]+\.mjs)/g, base: join(PLUGIN, 'bin') },
]
// In the repo: plugins/quality-code/x, up to the first glob character.
const REPO_RULES = [{ re: /(plugins\/quality-code\/[A-Za-z0-9_./*-]*)/g, base: REPO }]

function allReferences() {
  const plugin = [
    ...filesIn(join(PLUGIN, 'commands'), ['.md']), ...filesIn(join(PLUGIN, 'guides'), ['.md']),
    ...filesIn(join(PLUGIN, 'output-styles'), ['.md']), ...filesIn(join(PLUGIN, 'resources'), ['.md']),
    join(PLUGIN, 'hooks/hooks.json'), join(PLUGIN, '.mcp.json'), join(PLUGIN, 'README.md'),
  ]
  const repo = [
    join(REPO, 'README.md'), ...filesIn(join(REPO, 'docs'), ['.md']), ...filesIn(join(REPO, 'docs/rollout'), ['.md']),
    ...filesIn(join(REPO, '.github/workflows'), ['.yml', '.yaml']), ...filesIn(join(REPO, 'scripts'), ['.py', '.mjs']),
  ]
  return [...plugin.flatMap(f => referencesIn(f, PLUGIN_RULES)), ...repo.flatMap(f => referencesIn(f, REPO_RULES))]
    .map(([where, path, base]) => [where, path.replace(/\*.*$/, '').replace(/\/$/, ''), base])
}

test('every plugin file named in the prompts, hook, docs, workflows and scripts exists', () => {
  const refs = allReferences()
  assert.ok(refs.length > 100, `only ${refs.length} references found: the patterns no longer match the files`)
  const missing = refs.filter(([, path, base]) => !existsSync(join(base, path))).map(([where, path]) => `${where}: ${path}`)
  assert.deepEqual(missing, [])
})

test('the manifests, the Dockerfile and the MCP server name files and folders that exist', () => {
  const missing = []
  const need = (where, path, base = PLUGIN) => { if (!existsSync(join(base, path))) missing.push(`${where}: ${path}`) }
  const claude = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'))
  if (claude.icon) need('.claude-plugin/plugin.json icon', claude.icon)
  const copilot = JSON.parse(readFileSync(join(PLUGIN, '.plugin/plugin.json'), 'utf8'))
  for (const k of ['commands', 'mcpServers', 'skills', 'hooks', 'agents']) if (typeof copilot[k] === 'string') need(`.plugin/plugin.json ${k}`, copilot[k])
  // The image is built from the plugin folder: every COPY source is in it.
  const docker = readFileSync(join(PLUGIN, 'mcp-server/Dockerfile'), 'utf8')
  for (const m of docker.matchAll(/^COPY (\S+) /gm)) need(`mcp-server/Dockerfile COPY`, m[1])
  // The MCP server reads these folders of the plugin by name.
  for (const f of filesIn(join(PLUGIN, 'mcp-server/quality_code_mcp'), ['.py'])) {
    for (const m of readFileSync(f, 'utf8').matchAll(/root \/ "([a-z-]+)"/g)) need(`${relative(PLUGIN, f)}`, m[1])
  }
  assert.deepEqual(missing, [])
})
