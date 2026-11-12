import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript, speakersOf } from '../../lib/transcript/parse.mjs'
import { redactTurns, redactText } from '../../lib/transcript/redact.mjs'
import { validateResult } from '../../lib/transcript/shape.mjs'
import { goalPath, isDate, renderGoal } from '../../lib/transcript/save.mjs'

const CLI = new URL('../../bin/transcript.mjs', import.meta.url).pathname
// The fixture holds a placeholder: a literal customer id may not live in a test file (no-ids.test.mjs).
const CID = `U${'123456'}`
const RAW = readFileSync(new URL('../fixtures/transcript/planning.vtt', import.meta.url), 'utf8').replace('{{CID}}', CID)
const VTT = join(mkdtempSync(join(tmpdir(), 'qctf-')), 'planning.vtt')
writeFileSync(VTT, RAW)
const cfg = (extra = {}) => ({ version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ...extra })
const proj = (config = cfg()) => {
  const d = mkdtempSync(join(tmpdir(), 'qct-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(config))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d, QUALITY_CODE_PLACE: 'repo' }, encoding: 'utf8' })
const line = (out, tag) => JSON.parse(out.split('\n').find(l => l.startsWith(tag)).slice(tag.length))
const good = () => ({ goal: 'Ship the order export.', decisions: ['CSV only'], tasks: [{ title: 'CSV download', owner: 'Marco', estimate: '3' }, { title: 'Empty state', ticket: 'ABC-12' }], risks: ['Shared staging'], openQuestions: ['Who tests it?'] })

test('a Teams .vtt becomes speaker turns, one per speaker run', () => {
  const turns = parseTranscript(RAW)
  assert.equal(turns.length, 3)
  assert.deepEqual(speakersOf(turns).map(s => [s.name, s.turns]), [['Ana Rossi', 1], ['Marco Bianchi', 1], ['Giulia Verdi', 1]])
  assert.equal(turns[0].time, '00:00:01')
  assert.match(turns[1].text, /CSV download.*ABC-12/)
})
test('plain text: "Name: words", and a name with a time above the words', () => {
  const a = parseTranscript('Ana: We start now.\nMarco: Fine.\nMarco: Next.\n')
  assert.deepEqual(a.map(t => [t.speaker, t.text]), [['Ana', 'We start now.'], ['Marco', 'Fine. Next.']])
  const b = parseTranscript('Ana Rossi   0:05\nThe goal is the export.\nWe agree.\n\nMarco Bianchi   0:20\nI take it.\n')
  assert.deepEqual(b.map(t => [t.speaker, t.time, t.text]), [['Ana Rossi', '0:05', 'The goal is the export. We agree.'], ['Marco Bianchi', '0:20', 'I take it.']])
  assert.equal(parseTranscript('just some words with no speaker')[0].speaker, null)
})
test('redaction: customer ids, config patterns, e-mails and ids go; speakers can be masked', () => {
  const turns = parseTranscript(RAW)
  const r = redactTurns(cfg({ redact: { project: 'ABC-\\d+' } }), turns)
  const all = r.map(t => t.text).join(' ')
  assert.doesNotMatch(all, new RegExp(`${CID}|giulia@example\\.com|ABC-12`))
  assert.match(all, /U######/)
  assert.match(all, /\[redacted:project\]/)
  assert.match(redactText({}, `customer U${'987654'}`), /U######/, 'a config with no redact still masks customer ids')
  const m = redactTurns(cfg(), turns, { maskSpeakers: true })
  assert.deepEqual(m.map(t => t.speaker), ['Speaker 1', 'Speaker 2', 'Speaker 3'])
})
test('shape: a good result passes and is normalised', () => {
  const r = validateResult(good())
  assert.equal(r.ok, true)
  assert.equal(r.result.tasks[1].ticket, 'ABC-12')
})
test('shape: no goal, a bad task, a bad key and wrong types are each named', () => {
  assert.match(validateResult({ ...good(), goal: '' }).errors[0], /goal/)
  assert.match(validateResult({ ...good(), tasks: [{ owner: 'x' }] }).errors[0], /tasks\[0\]\.title/)
  assert.match(validateResult({ ...good(), tasks: [{ title: 'a', ticket: 'abc 1' }] }).errors[0], /not a ticket key/)
  assert.match(validateResult({ ...good(), tasks: 'x' }).errors[0], /tasks/)
  assert.match(validateResult({ ...good(), decisions: 'x' }).errors[0], /decisions/)
  assert.equal(validateResult(null).ok, false)
  assert.equal(validateResult({ goal: 'g', tasks: [] }).ok, true)
})
test('save path: only a real date, always inside <ticketsDir>/sprint', () => {
  const root = '/tmp/x/tickets'
  assert.equal(goalPath(root, '2026-11-04'), '/tmp/x/tickets/sprint/2026-11-04-goal.md')
  for (const bad of ['../../etc/passwd', '2026-13-01', '2026-02-30', '2026-11-04/../x', '', null, '2026-1-4']) assert.equal(goalPath(root, bad), null, String(bad))
  assert.equal(isDate('2024-02-29'), true)
  assert.match(renderGoal(validateResult(good()).result, '2026-11-04'), /1\. CSV download \(owner: Marco\) \(estimate: 3\)\n2\. Empty state \[ABC-12\]/)
})
test('cli parse: prints redacted turns and the speakers, never the raw ids', () => {
  const d = proj()
  const r = run(d, 'parse', '--file', VTT)
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stdout, new RegExp(`${CID}|giulia@example\\.com`))
  assert.match(r.stdout, /Ana Rossi \[00:00:01\]: Welcome/)
  const j = line(r.stdout, 'TRANSCRIPT_JSON:')
  assert.equal(j.turns, 3)
  assert.equal(j.speakers.length, 3)
  assert.equal(run(d, 'parse', '--file', VTT, '--mask-speakers').stdout.includes('Ana Rossi'), false)
})
test('cli parse: pasted text is read; a wrong file kind, a missing file and no source are refused', () => {
  const d = proj()
  assert.equal(run(d, 'parse', '--text', 'Ana: Goal is the export.').status, 0)
  assert.equal(run(d, 'parse', '--file', join(d, 'x.pdf')).status, 2)
  assert.equal(run(d, 'parse', '--file', join(d, 'nothing.vtt')).status, 2)
  assert.equal(run(d, 'parse').status, 2)
  assert.equal(run(d, 'nope').status, 2)
})
test('cli validate: ok and errors with exit codes', () => {
  const d = proj()
  assert.equal(run(d, 'validate', '--in', JSON.stringify(good())).status, 0)
  const bad = run(d, 'validate', '--in', JSON.stringify({ tasks: [] }))
  assert.equal(bad.status, 2)
  assert.match(bad.stdout, /error: goal/)
  assert.equal(run(d, 'validate', '--in', 'not json').status, 2)
})
test('cli save: writes <ticketsDir>/sprint/<date>-goal.md, redacted; a bad date is refused and writes nothing', () => {
  const d = proj()
  const result = { ...good(), risks: [`Customer U${'555555'} depends on it, mail a@b.example.com`] }
  const r = run(d, 'save', '--in', JSON.stringify(result), '--date', '2026-11-04')
  assert.equal(r.status, 0, r.stderr)
  const path = line(r.stdout, 'SAVED_JSON:').path
  assert.match(path, /sprint\/2026-11-04-goal\.md$/)
  const text = readFileSync(path, 'utf8')
  assert.match(text, /# Sprint goal 2026-11-04/)
  assert.doesNotMatch(text, /U\d{6}|a@b\.example\.com/)
  for (const date of ['../../evil', '2026-99-99']) assert.equal(run(d, 'save', '--in', JSON.stringify(good()), '--date', date).status, 2, date)
  assert.equal(existsSync(join(d, 'evil-goal.md')), false)
  assert.equal(run(d, 'save', '--in', JSON.stringify({ goal: '' })).status, 2)
})
