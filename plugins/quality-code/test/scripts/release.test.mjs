// scripts/release.mjs: the three manifests and the changelog move together; a bump never reuses a version or a tag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MANIFESTS, bump, changelogState, check } from '../../../../scripts/release.mjs'

const LOG = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A thing.\n\n## [1.2.3] - 2026-11-01\n\n- Old.\n'
function repo({ versions = ['1.2.3', '1.2.3', '1.2.3'], log = LOG } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-release-'))
  const body = [`{\n  "name": "quality-code",\n"version": "${versions[0]}",\n  "x": 1\n}\n`, `{\n  "name": "quality-code",\n  "version": "${versions[1]}"\n}\n`, `[project]\nname = "q"\nversion = "${versions[2]}"\n`]
  MANIFESTS.forEach((p, i) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), body[i]) })
  writeFileSync(join(d, 'CHANGELOG.md'), log)
  return d
}

test('the real repo: the three manifests and the newest changelog section name the same version', () => {
  assert.deepEqual(check(), [])
})

test('bump writes the version in the three manifests and dates the Unreleased notes; check then passes', () => {
  const d = repo()
  assert.deepEqual(bump('1.3.0', { root: d, today: '2026-11-17' }), [])
  for (const p of MANIFESTS) assert.match(readFileSync(join(d, p), 'utf8'), /1\.3\.0/, p)
  const log = readFileSync(join(d, 'CHANGELOG.md'), 'utf8')
  assert.match(log, /## \[Unreleased\]\n\n## \[1\.3\.0\] - 2026-11-17\n\n### Fixed\n\n- A thing\./)
  assert.deepEqual(changelogState(log), { unreleased: '', released: '1.3.0' })
  assert.deepEqual(check(d), [])
})

test('bump refuses: not X.Y.Z, not newer, a tag that exists, nothing to release', () => {
  assert.match(bump('1.3', { root: repo() })[0], /usage/)
  assert.match(bump('1.2.3', { root: repo() })[0], /not newer than 1\.2\.3/)
  assert.match(bump('1.2.10', { root: repo({ versions: ['1.2.10', '1.2.10', '1.2.10'] }) })[0], /not newer/)
  assert.deepEqual(bump('1.2.10', { root: repo(), today: '2026-11-17' }), [], '1.2.10 is newer than 1.2.3')
  assert.match(bump('1.3.0', { root: repo(), tagExists: t => t === 'quality-code--v1.3.0' })[0], /quality-code--v1\.3\.0 exists already/)
  assert.match(bump('1.3.0', { root: repo({ log: '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-11-01\n' }) })[0], /nothing under ## \[Unreleased\]/)
  const d = repo()
  bump('1.3', { root: d })
  assert.equal(readFileSync(join(d, MANIFESTS[0]), 'utf8').includes('1.2.3'), true, 'a refused bump writes nothing')
})

test('check names manifests that disagree and a changelog that lags', () => {
  assert.match(check(repo({ versions: ['1.2.3', '1.2.4', '1.2.3'] }))[0], /the manifests disagree/)
  assert.match(check(repo({ versions: ['1.2.4', '1.2.4', '1.2.4'] }))[0], /the newest section is 1\.2\.3, the manifests say 1\.2\.4/)
})
