import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
