// `ticket.mjs config set|get`: dotted keys, typing, validation, no write on error, secrets, scope.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseValue, KEYS } from '../../lib/config/set.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../bin/ticket.mjs')
const base = () => ({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] })
function setup({ repo = true, personal = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-set-')), claude = mkdtempSync(join(tmpdir(), 'qc-setc-'))
  if (repo) { mkdirSync(join(d, '.claude')); writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(base())) }
  if (personal) writeFileSync(join(claude, 'quality-code.json'), JSON.stringify(base()))
  const file = p => join(p, p === d ? '.claude/quality-code.json' : 'quality-code.json')
  const run = (...args) => spawnSync(process.execPath, [CLI, 'config', ...args], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: 'repo' }, encoding: 'utf8' })
  const repoCfg = () => JSON.parse(readFileSync(file(d), 'utf8'))
  const persCfg = () => JSON.parse(readFileSync(file(claude), 'utf8'))
  return { d, claude, run, repoCfg, persCfg }
}

test('set previews old -> new and writes nothing without --yes', () => {
  const s = setup()
  const r = s.run('set', 'git.base', 'develop')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /git\.base: not set -> develop/)
  assert.match(r.stdout, /Run again with --yes/)
  assert.match(r.stdout, /CONFIG_SET_JSON:.*"status":"preview"/)
  assert.equal(s.repoCfg().git, undefined)
})
test('set --yes writes a nested key into the repo config', () => {
  const s = setup()
  const r = s.run('set', 'git.base', 'develop', '--yes')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"status":"written"/)
  assert.equal(s.repoCfg().git.base, 'develop')
  assert.equal(s.repoCfg().jira.site, 'https://e.atlassian.net')
})
test('lists are split on commas and trimmed; the old list is shown', () => {
  const s = setup()
  const r = s.run('set', 'jira.projects', 'ABC, DEF', '--yes')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /jira\.projects: \["DEMO"\] -> \["ABC","DEF"\]/)
  assert.deepEqual(s.repoCfg().jira.projects, ['ABC', 'DEF'])
})
test('a jira site without a scheme becomes https', () => {
  const s = setup()
  assert.equal(s.run('set', 'jira.site', 'acme.atlassian.net', '--yes').status, 0)
  assert.equal(s.repoCfg().jira.site, 'https://acme.atlassian.net')
})
test('ticketsDir is set and a bad folder is refused', () => {
  const s = setup()
  assert.equal(s.run('set', 'ticketsDir', '.qc/tickets', '--yes').status, 0)
  assert.equal(s.repoCfg().ticketsDir, '.qc/tickets')
  const r = s.run('set', 'ticketsDir', '../outside', '--yes')
  assert.equal(r.status, 2)
  assert.equal(s.repoCfg().ticketsDir, '.qc/tickets')
})
test('booleans and numbers are typed', () => {
  const s = setup()
  assert.equal(s.run('set', 'qa.autoPass', 'yes', '--yes').status, 0)
  assert.equal(s.run('set', 'qa.blockedStop', '3', '--yes').status, 0)
  assert.deepEqual(s.repoCfg().qa, { autoPass: true, blockedStop: 3 })
  assert.deepEqual([parseValue(KEYS['qa.autoPass'], 'k', 'off').value, parseValue(KEYS['qa.blockedStop'], 'k', '7').value], [false, 7])
})
test('a wrong type or value is a clear error and nothing is written', () => {
  const s = setup()
  const before = readFileSync(join(s.d, '.claude/quality-code.json'), 'utf8')
  for (const [k, v, re] of [['qa.autoPass', 'maybe', /true or false/], ['qa.blockedStop', 'abc', /whole number/], ['qa.blockedStop', '99', /0 to 20/], ['jira.projects', 'abc', /upper-case/], ['git.base', 'a b', /branch name/], ['testFlow', 'weird', /"project" or "quality-code"/], ['qa.app', 'ftp://x', /http/]]) {
    const r = s.run('set', k, v, '--yes')
    assert.equal(r.status, 2, `${k}=${v}`)
    assert.match(r.stderr, re, `${k}=${v}`)
    assert.match(r.stderr, /nothing was written|must be/)
  }
  assert.equal(readFileSync(join(s.d, '.claude/quality-code.json'), 'utf8'), before)
})
test('an unknown key is refused with the list of settable keys', () => {
  const s = setup()
  const r = s.run('set', 'jira.nope', 'x', '--yes')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown key/)
  assert.match(r.stderr, /git\.base/)
})
test('secret-like keys and values are refused, never repeated, nothing written', () => {
  const s = setup()
  const before = readFileSync(join(s.d, '.claude/quality-code.json'), 'utf8')
  for (const [k, v] of [['gitlab_token', 'x'], ['jira.apiKey', 'x'], ['xray_client_secret', 'x'], ['password', 'x']]) {
    const r = s.run('set', k, v, '--yes')
    assert.equal(r.status, 2, k)
    assert.match(r.stderr, /\/plugin/)
  }
  for (const v of ['glpat-abcdefghij1234567890', 'ghp_abcdefghijklmnop', 'Bearer abc.def', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG']) {
    const r = s.run('set', 'git.base', v, '--yes')
    assert.equal(r.status, 2, v)
    assert.match(r.stderr, /looks like a token/)
    assert.ok(!r.stderr.includes(v) && !r.stdout.includes(v), 'the value is not echoed')
  }
  assert.equal(readFileSync(join(s.d, '.claude/quality-code.json'), 'utf8'), before)
})
test('plugin settings (Jira email, GitLab, Xray address) point to /plugin', () => {
  const s = setup()
  for (const k of ['jira_email', 'gitlab_api_url', 'gitlab_username', 'xray_api_url']) {
    const r = s.run('set', k, 'x', '--yes')
    assert.equal(r.status, 2, k)
    assert.match(r.stderr, /plugin setting.*Set it in \/plugin/s)
  }
})
test('get reads a key, the default of ticketsDir, and a key that is not set', () => {
  const s = setup()
  const a = s.run('get', 'jira.site')
  assert.equal(a.status, 0)
  assert.match(a.stdout, /jira\.site = https:\/\/e\.atlassian\.net/)
  assert.match(s.run('get', 'git.base').stdout, /git\.base = not set/)
  assert.match(s.run('get', 'ticketsDir').stdout, /default \.quality-code\/tickets/)
  assert.equal(s.run('get', 'gitlab_token').status, 2)
  assert.equal(s.run('get', 'nope').status, 2)
})
test('none removes an optional key and its emptied block; a required key cannot be cleared', () => {
  const s = setup()
  s.run('set', 'qa.autoPass', 'true', '--yes')
  assert.equal(s.run('set', 'qa.autoPass', 'none', '--yes').status, 0)
  assert.equal(s.repoCfg().qa, undefined)
  assert.equal(s.run('set', 'jira.projects', 'none', '--yes').status, 2, 'jira.projects is required: none is read as a value and fails the key rule')
})
test('scope: default is the config that exists; --personal and --project pick one', () => {
  const s = setup({ repo: false, personal: true })
  assert.equal(s.run('set', 'git.base', 'dev', '--yes').status, 0)
  assert.equal(s.persCfg().git.base, 'dev')
  assert.match(s.run('get', 'git.base').stdout, /\(personal:/)
  const none = s.run('set', 'git.base', 'dev', '--project', '--yes')
  assert.equal(none.status, 2)
  assert.match(none.stderr, /no project config/)
  const both = setup({ repo: true, personal: true })
  assert.equal(both.run('set', 'git.base', 'p', '--personal', '--yes').status, 0)
  assert.equal(both.persCfg().git.base, 'p')
  assert.equal(both.repoCfg().git, undefined)
  assert.equal(both.run('set', 'git.base', 'r', '--yes').status, 0)
  assert.equal(both.repoCfg().git.base, 'r')
  assert.equal(both.run('set', 'git.base', 'r', '--personal', '--project').status, 2)
})
test('a personal config has no testFlow; no config at all is a setup hint', () => {
  const s = setup({ repo: false, personal: true })
  const r = s.run('set', 'testFlow', 'project', '--yes')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /personal config/)
  const none = setup({ repo: false })
  const r2 = none.run('set', 'git.base', 'x', '--yes')
  assert.equal(r2.status, 2)
  assert.match(r2.stderr, /run \/quality-code:setup/)
})
test('place: previews, then moves where files and logs are kept; personal has no repo place', () => {
  const s = setup()
  assert.match(s.run('get', 'place').stdout, /place = repo/)
  const p = s.run('set', 'place', 'local')
  assert.match(p.stdout, /place: repo -> local/)
  assert.match(p.stdout, /Run again with --yes/)
  const w = s.run('set', 'place', 'chat', '--yes')
  assert.equal(w.status, 0, w.stderr)
  assert.match(s.run('get', 'place').stdout, /place = chat/)
  assert.equal(s.run('set', 'place', 'nowhere', '--yes').status, 2)
  const pers = setup({ repo: false, personal: true })
  assert.equal(pers.run('set', 'place', 'repo', '--yes').status, 2)
})
test('usage errors: missing value, extra value, unknown flag', () => {
  const s = setup()
  for (const args of [['set', 'git.base'], ['set', 'git.base', 'a', 'b'], ['get'], ['set', 'git.base', 'a', '--force']]) assert.equal(s.run(...args).status, 2, args.join(' '))
})
