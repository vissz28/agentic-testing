import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LAUNCHER = new URL('../../bin/run-node.cmd', import.meta.url).pathname
const HOOKS = new URL('../../hooks/hooks.json', import.meta.url).pathname
const unix = process.platform !== 'win32'

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'qc-runnode-'))
  copyFileSync(LAUNCHER, join(d, 'run-node.cmd'))
  chmodSync(join(d, 'run-node.cmd'), 0o755)
  writeFileSync(join(d, 'echo.mjs'), 'process.stdout.write(`args=${process.argv.slice(2).join(",")} stdin=${require("node:fs").readFileSync(0, "utf8")}`)\n'.replace('require("node:fs")', '(await import("node:fs"))'))
  return d
}

test('the hook runs through the launcher, which finds node itself', () => {
  const hooks = JSON.parse(readFileSync(HOOKS, 'utf8'))
  const cmd = hooks.hooks.PreToolUse[0].hooks[0].command
  assert.match(cmd, /bin\/run-node\.cmd" checks\.mjs boundary --hook$/)
  assert.ok(!/^node /.test(cmd), 'a bare node would fail where node is not on the hook PATH')
  const matcher = new RegExp(`^(?:${hooks.hooks.PreToolUse[0].matcher})$`)
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash']) assert.ok(matcher.test(tool), `${tool} goes through the boundary hook`)
})

test('launcher: runs the script with its arguments and stdin', { skip: !unix }, () => {
  const d = setup()
  const r = spawnSync('/bin/sh', [join(d, 'run-node.cmd'), 'echo.mjs', 'boundary', '--hook'], { input: '{"a":1}', encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'args=boundary,--hook stdin={"a":1}')
})

test('launcher: with node off the PATH it still finds node, or skips with exit 0 and one line, never an error', { skip: !unix }, () => {
  const d = setup()
  const r = spawnSync('/bin/sh', [join(d, 'run-node.cmd'), 'echo.mjs', 'x'], { input: '', encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: join(d, 'nohome') } })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.startsWith('args=x') || /node was not found, so echo\.mjs was skipped/.test(r.stderr), r.stdout + r.stderr)
})

test('launcher: with node nowhere, the hook blocks (exit 2) while a run is active and skips (exit 0) otherwise', { skip: !unix }, () => {
  const d = setup()
  // The machine's own node must not be found: the launcher's fixed places point nowhere.
  const launcher = readFileSync(join(d, 'run-node.cmd'), 'utf8').replace(/for c in [^;]*;/, `for c in ${join(d, 'none/node')};`)
  assert.ok(launcher.includes(join(d, 'none/node')))
  writeFileSync(join(d, 'run-node.cmd'), launcher)
  const project = mkdtempSync(join(tmpdir(), 'qc-runnode-p-'))
  const env = { PATH: '/nowhere', HOME: join(d, 'nohome'), NVM_DIR: join(d, 'nonvm'), CLAUDE_PROJECT_DIR: project }
  const go = args => spawnSync('/bin/sh', [join(d, 'run-node.cmd'), 'checks.mjs', ...args], { input: '{}', encoding: 'utf8', env })
  let r = go(['boundary', '--hook'])
  assert.equal(r.status, 0, 'no run: a missing node never blocks editing')
  assert.match(r.stderr, /node was not found, so checks\.mjs was skipped/)
  mkdirSync(join(project, '.claude/quality-code'), { recursive: true })
  writeFileSync(join(project, '.claude/quality-code/run.active'), '')
  r = go(['boundary', '--hook'])
  assert.equal(r.status, 2, 'a run is active: exit 2 blocks the tool call')
  assert.match(r.stderr, /node was not found and a test run is active, so this is blocked/)
  assert.equal(go(['run', 'status']).status, 0, 'only the hook blocks')
})
