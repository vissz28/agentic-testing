import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandInfo, main } from '../../bin/help.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'qc-help-'))
const jira = { site: 'https://e.atlassian.net', projects: ['DEMO'] }
const run = (argv, { personal, repo } = {}) => {
  const claude = tmp(), cwd = tmp()
  mkdirSync(join(cwd, '.git'))
  if (personal) writeFileSync(join(claude, 'quality-code.json'), JSON.stringify({ version: 1, adapter: 'fullstack', jira, ...personal }))
  if (repo) { mkdirSync(join(cwd, '.claude')); writeFileSync(join(cwd, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira })) }
  let out = '', err = ''
  const code = main(argv, { env: { CLAUDE_CONFIG_DIR: claude, QUALITY_CODE_PLACE: 'repo' }, cwd, stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}

test('no setup: says to run setup first, and shows no steps unless a role is asked for', () => {
  const r = run([])
  assert.equal(r.code, 0)
  assert.match(r.out, /not set up here yet\. Run `\/quality-code:setup` first/)
  assert.doesNotMatch(r.out, /What you can do now/)
  assert.match(run(['--qa']).out, /What you can do now \(QA\)/)
})

test('the role comes from the config: a repo is a developer, a personal setup keeps qa or po', () => {
  assert.match(run([], { repo: true }).out, /Set up: Jira e\.atlassian\.net, project\(s\) DEMO \(this repo\)[\s\S]*What you can do now \(Developer\)/)
  const qa = run([], { personal: { role: 'qa' } }).out
  assert.match(qa, /What you can do now \(QA\)/)
  assert.doesNotMatch(qa, /\(PO\)|\(Developer\)/)
  const old = run([], { personal: {} }).out
  assert.match(old, /\(QA\)[\s\S]*\(PO\)/)
  assert.match(run(['--po'], { repo: true }).out, /What you can do now \(PO\)/)
})

test('each step shows its command\'s own examples, filtered by the step\'s flag', () => {
  const dev = run(['--dev']).out
  assert.ok(dev.includes('   - `/quality-code:check --branch`'))
  const qa = run(['--qa']).out
  const ticket = qa.slice(qa.indexOf('`/quality-code:ticket`:'), qa.indexOf('2. '))
  assert.match(ticket, /--eval/)
  assert.doesNotMatch(ticket, /assignee:me/)
})

test('--all lists every command; a name shows that command; bad input is exit 2', () => {
  const all = run(['--all']).out
  for (const f of readdirSync(new URL('../../commands/', import.meta.url))) assert.ok(all.includes(`\`/quality-code:${f.slice(0, -3)}\``), f)
  const spec = run(['/quality-code:spec']).out
  assert.ok(spec.startsWith('### `/quality-code:spec`'))
  assert.equal(spec.split('\n').filter(l => l.startsWith('- `/quality-code:spec')).length, commandInfo('spec').examples.length)
  assert.equal(run(['nope']).code, 2)
  assert.equal(run(['--bogus']).code, 2)
  assert.equal(run(['--qa', '--po']).code, 2)
})

test('every command a role names exists and has examples', () => {
  for (const role of ['--dev', '--qa', '--po']) {
    for (const [, name] of run([role]).out.matchAll(/^\d\. `\/quality-code:([a-z-]+)`/gm)) assert.ok(commandInfo(name)?.examples.length, name)
  }
})
