import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (f) => readFileSync(join(root, f), 'utf8')

test('the display guide sends every command to the node-missing guide', () => {
  assert.match(read('guides/display.md'), /guides\/node-missing\.md/)
  assert.ok(existsSync(join(root, 'guides/node-missing.md')))
})

test('the Windows finder looks per user, for all users, in version managers and in every profile', () => {
  const ps = read('bin/find-node.ps1')
  for (const part of ["'Machine'", "'User'", 'LOCALAPPDATA', 'ProgramFiles', 'nvm', 'fnm', 'Volta', 'scoop', "C:\\Users"]) {
    assert.ok(ps.includes(part), part)
  }
  assert.match(ps, /NODE_EXE=/)
  assert.match(read('guides/node-missing.md'), /find-node\.ps1/)
})
