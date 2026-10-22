// Cost and speed per command: the model, the effort and the pre-approved plugin scripts. These apply
// to the turn a command starts in; later turns run on the session's model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../../commands/', import.meta.url)
const commands = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
const front = c => {
  const t = readFileSync(new URL(`${c}.md`, dir), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n/.exec(t)
  return { text: t, fields: Object.fromEntries((m?.[1] ?? '').split('\n').map(l => l.split(/:\s(.*)/s).slice(0, 2))) }
}
// spec writes tests, and start and write are its aliases: all three run on the session model.
const MODEL = { kpi: 'haiku', consumption: 'haiku', check: 'haiku', setup: 'sonnet', ticket: 'sonnet', 'ticket-eval': 'sonnet', 'tickets-eval': 'sonnet' }
const SCRIPTS = 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)'

test('every command is listed here, so a new one gets a deliberate model choice', () => {
  assert.deepEqual(commands.sort(), ['check', 'consumption', 'kpi', 'seed', 'setup', 'spec', 'start', 'ticket', 'ticket-eval', 'tickets-eval', 'write', 'xray'])
})
test('simple commands run on Haiku with low effort, the gate on Sonnet, writing on the session model', () => {
  for (const c of commands) {
    const { fields } = front(c)
    assert.equal(fields.model, MODEL[c], `${c} model`)
    assert.equal(fields.effort, MODEL[c] === 'haiku' ? 'low' : undefined, `${c} effort`)
  }
})
// kpi and consumption may run only their own script (kpi also consumption's, for its option 1); the rest any of the plugin's scripts, nothing else.
// ticket-eval also reads the branch diff (read-only) for the Figma drafts.
const OWN = { 'ticket-eval': 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*) Bash(git diff *)', kpi: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kpi.mjs":*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs":*)', consumption: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs":*)' }
test('every command pre-approves only the plugin\'s own scripts', () => {
  for (const c of commands) assert.equal(front(c).fields['allowed-tools'], OWN[c] ?? SCRIPTS, c)
})
test('every command runs plugin scripts exactly as written, so the pre-approval matches', () => {
  for (const c of commands) assert.ok(front(c).text.includes('Run each plugin script exactly as written'), c)
})
