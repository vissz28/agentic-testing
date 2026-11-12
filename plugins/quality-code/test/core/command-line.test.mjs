// lib/core/command-line.mjs: a script knows it was started directly, also through a symlinked folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMain } from '../../lib/core/command-line.mjs'

const PLUGIN = fileURLToPath(new URL('../../', import.meta.url))
const BIN = join(PLUGIN, 'bin')
const SCRIPTS = readdirSync(BIN).filter(f => f.endsWith('.mjs')).sort()

test('isMain: the started file, directly or through a link; not another file, a missing one or none', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-main-'))
  try {
    const real = join(d, 'real.mjs')
    writeFileSync(real, '')
    writeFileSync(join(d, 'other.mjs'), '')
    symlinkSync(real, join(d, 'link.mjs'))
    const url = pathToFileURL(real).href
    assert.equal(isMain(url, real), true)
    assert.equal(isMain(url, join(d, 'link.mjs')), true)
    assert.equal(isMain(url, join(d, 'other.mjs')), false)
    assert.equal(isMain(url, join(d, 'gone.mjs')), false)
    assert.equal(isMain(url, undefined), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('every script decides with isMain, never by comparing the path it was started with', () => {
  for (const s of SCRIPTS) {
    const src = readFileSync(join(BIN, s), 'utf8')
    assert.ok(src.includes('isMain(import.meta.url)'), s)
    assert.ok(!src.includes('process.argv[1]'), `${s} reads process.argv[1] itself`)
  }
})

// update.mjs asks the network for the latest version; the two connector scripts wait on stdin.
const QUIET = new Set(['update.mjs', 'xray-api.mjs', 'mcp-launch.mjs'])
test('a script started through a symlinked folder does what it does started directly', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-link-'))
  try {
    symlinkSync(PLUGIN, join(d, 'plugin'))
    const run = bin => spawnSync(process.execPath, [bin], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: join(d, 'claude'), QC_NO_AUDIT: '1' }, encoding: 'utf8', input: '', timeout: 30000 })
    for (const s of SCRIPTS.filter(x => !QUIET.has(x))) {
      const direct = run(join(BIN, s))
      const linked = run(join(d, 'plugin', 'bin', s))
      assert.equal(linked.status, direct.status, `${s}: exit code`)
      assert.equal(Boolean(linked.stdout || linked.stderr), Boolean(direct.stdout || direct.stderr), `${s}: silent through the link`)
      assert.ok(direct.stdout || direct.stderr || direct.status !== 0, `${s}: says nothing and exits 0 with no arguments`)
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
})
