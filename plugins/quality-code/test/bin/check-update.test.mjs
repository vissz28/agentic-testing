import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, fetchLatest, githubRepo, main, newerSections, statusOf } from '../../bin/check-update.mjs'

const REPO = 'https://github.com/vissz28/agentic-testing'
const MANIFEST = version => ({ name: 'quality-code', version, repository: REPO })
const CHANGELOG = `# Changelog

## [Unreleased]

## [0.28.1] - 2026-10-29

### Fixed

- A whole-suite run no longer says "not verified".

## [0.28.0] - 2026-10-29

### Fixed

- **Spec discovery.** Specs next to the code are found.
- Expected check reads only the outcome.

## [0.27.0] - 2026-10-28

### Added

- Testcontainers.
`
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => body })
const remote = (version, changelog = CHANGELOG) => async url =>
  url.endsWith('plugin.json') ? reply(JSON.stringify({ version })) : url.includes('/plugins/') ? reply('', 404) : reply(changelog)
async function run(installed, opts = {}) {
  let out = ''
  let err = ''
  const code = await main(opts.argv ?? [], {}, '/', { stdout: s => { out += s }, stderr: s => { err += s }, installedManifest: MANIFEST(installed), fetchImpl: opts.fetchImpl ?? remote('0.28.1'), ls: opts.ls })
  return { code, out, err }
}

test('compareVersions orders numbers, not text', () => {
  assert.equal(compareVersions('0.28.1', '0.28.0'), 1)
  assert.equal(compareVersions('0.9.0', '0.28.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('nope', '0.1.0'), -1)
})
test('githubRepo reads https, ssh and .git addresses', () => {
  assert.equal(githubRepo('https://github.com/vissz28/agentic-testing'), 'vissz28/agentic-testing')
  assert.equal(githubRepo('git@github.com:vissz28/agentic-testing.git'), 'vissz28/agentic-testing')
  assert.equal(githubRepo('https://gitlab.com/a/b'), null)
})
test('statusOf: update, current, ahead', () => {
  assert.deepEqual(['0.27.0', '0.28.1', '0.29.0'].map(v => statusOf(v, '0.28.1')), ['update', 'current', 'ahead'])
})
test('newerSections keeps only versions after the installed one, newest first, plain text', () => {
  const s = newerSections(CHANGELOG, '0.27.0', '0.28.1')
  assert.deepEqual(s.map(x => x.version), ['0.28.1', '0.28.0'])
  assert.equal(s[1].date, '2026-10-29')
  assert.deepEqual(s[1].lines.items, ['Spec discovery. Specs next to the code are found.', 'Expected check reads only the outcome.'])
})
test('a newer version: card with the changes and the two commands, exit 0', async () => {
  const r = await run('0.27.0')
  assert.equal(r.code, 0)
  assert.match(r.out, /Installed {2}0\.27\.0\n {2}Latest {5}0\.28\.1 {3}\(from github\)/)
  assert.match(r.out, /A new version is out: 0\.27\.0 -> 0\.28\.1\./)
  assert.match(r.out, /0\.28\.0 {2}\(2026-10-29\)\n {4}- Spec discovery/)
  assert.match(r.out, /\/plugin update quality-code@teamsystem\n {2}\/reload-plugins/)
  assert.match(r.out, /CHECK_UPDATE_JSON:\{"installed":"0\.27\.0","latest":"0\.28\.1","status":"update"\}\n$/)
})
test('up to date: one line, no commands to type', async () => {
  const r = await run('0.28.1')
  assert.equal(r.code, 0)
  assert.match(r.out, /You have the latest version\./)
  assert.doesNotMatch(r.out, /\/plugin update/)
})
test('ahead of the published version is said, not called an update', async () => {
  const r = await run('0.29.0')
  assert.match(r.out, /ahead of the published version/)
})
test('--json prints the report only', async () => {
  const r = await run('0.27.0', { argv: ['--json'] })
  const j = JSON.parse(r.out)
  assert.equal(j.status, 'update')
  assert.deepEqual(j.versions, ['0.28.1', '0.28.0'])
})
test('a long history is cut to six versions with a pointer to the changelog', async () => {
  const many = Array.from({ length: 9 }, (_, i) => `## [0.${30 - i}.0] - 2026-10-01\n\n- change ${i}\n`).join('\n')
  const r = await run('0.1.0', { fetchImpl: remote('0.30.0', many) })
  assert.match(r.out, /\.\.\. and 3 older versions: see the CHANGELOG\./)
})
test('raw files unreachable: falls back to the repository tags', async () => {
  const ls = () => 'abc\trefs/tags/quality-code--v0.9.0\ndef\trefs/tags/quality-code--v0.28.1\nghi\trefs/tags/other--v9.9.9\n'
  const r = await run('0.27.0', { fetchImpl: async () => reply('', 404), ls })
  assert.equal(r.code, 0)
  assert.match(r.out, /Latest {5}0\.28\.1 {3}\(from git tags\)/)
  assert.match(r.out, /\/reload-plugins/)
})
test('nothing reachable: exit 3 with the reason and the installed version', async () => {
  const r = await run('0.27.0', { fetchImpl: async () => { throw new Error('offline') }, ls: () => { throw new Error('no network') } })
  assert.equal(r.code, 3)
  assert.match(r.out, /Could not read the latest version: offline; no network\./)
  assert.match(r.out, /Installed: 0\.27\.0/)
})
test('a remote manifest without a version is not trusted', async () => {
  await assert.rejects(fetchLatest({ repository: REPO, name: 'quality-code', fetchImpl: async () => reply('{}'), ls: () => '' }), /no version in the remote plugin\.json/)
})
test('unknown option: exit 2', async () => {
  const r = await run('0.27.0', { argv: ['--now'] })
  assert.equal(r.code, 2)
  assert.match(r.err, /unknown option --now/)
})
