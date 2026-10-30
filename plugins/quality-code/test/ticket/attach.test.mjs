import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachmentsSignal } from '../../lib/ticket/rubrics/shared.mjs'
import { evalTickets, formatCard } from '../../lib/ticket/batch.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const config = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }

test('attachments: counted until read, then only a file that gave text (or one added since) counts', () => {
  assert.equal(attachmentsSignal({ attachments: 0 }), false)
  assert.equal(attachmentsSignal({ attachments: 2 }), true)
  assert.equal(attachmentsSignal({ attachments: 1, attachmentsRead: 1, attachmentsWithText: 0 }), false)
  assert.equal(attachmentsSignal({ attachments: 1, attachmentsRead: 1, attachmentsWithText: 1 }), true)
  assert.equal(attachmentsSignal({ attachments: 2, attachmentsRead: 1, attachmentsWithText: 0 }), true)
})

test('attach: a refused ticket passes once a linked page holds the criteria; the text file goes, the text is redacted', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(config))
  const run = (...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
  const dir = run('config', 'check').stdout.match(/^tickets folder: (.+?) \(/m)[1]
  const keyDir = join(d, dir, 'DEMO-1')
  mkdirSync(keyDir, { recursive: true })
  const ticket = join(dir, 'DEMO-1', 'ticket.json')
  writeFileSync(join(d, ticket), JSON.stringify({ key: 'DEMO-1', issuetype: 'Story', summary: 's', labels: [], text: { description: 'See the attached analysis.' }, attachments: 1, links: [] }))
  assert.equal(run('score', '--in', `@${ticket}`).status, 1)

  const txt = join(dir, 'DEMO-1', 'attached.txt')
  writeFileSync(join(d, txt), [
    'The accounting team re-sends a corrected invoice when its tax id was wrong, so the authority gets the right data. Ask mario.rossi@acme.it.',
    '## Acceptance criteria',
    'Given a sent invoice with a wrong tax id',
    'When the user clicks "Re-send"',
    'Then the invoice status is "Re-sent"',
    'And the dialog shows "Invoice re-sent"',
  ].join('\n'))
  const r = run('attach', '--in', `@${ticket}`, 'page', `@${txt}`)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Added linked page 1: /m)
  assert.equal(existsSync(join(d, txt)), false)
  const saved = JSON.parse(readFileSync(join(d, ticket), 'utf8'))
  assert.match(saved.text.description, /^## Linked page 1$/m)
  assert.doesNotMatch(saved.text.description, /mario\.rossi/)
  assert.equal(saved.attachmentsRead, undefined)
  assert.equal(run('score', '--in', `@${ticket}`).status, 0)

  // An image with no words: read, nothing added, and it no longer earns the attachment points.
  writeFileSync(join(d, txt), '')
  assert.match(run('attach', '--in', `@${ticket}`, 'screenshot', `@${txt}`).stdout, /^Nothing to add from this file/m)
  assert.deepEqual(['attachmentsRead', 'attachmentsWithText'].map(k => JSON.parse(readFileSync(join(d, ticket), 'utf8'))[k]), [1, 0])

  // Only a file in the ticket's own folder is read (and deleted).
  writeFileSync(join(d, 'other.txt'), 'x')
  assert.equal(run('attach', '--in', `@${ticket}`, 'page', '@other.txt').status, 2)
  assert.equal(existsSync(join(d, 'other.txt')), true)
})

test('tickets-eval: a pass rate per Jira component, and refused tickets with unread files are counted', () => {
  const t = (key, components, description, attachments = 0) => ({ key, issuetype: 'Story', summary: 's', labels: [], components, text: { description }, attachments, links: [] })
  const good = '## Context\nPayments close the order.\n\n## User story\nAs a buyer I want to pay so that my order is placed.\n\n## Acceptance criteria\nGiven a cart\nWhen the user pays\nThen the order status is "Paid"'
  const r = evalTickets(config, [t('DEMO-1', ['Billing'], good), t('DEMO-2', ['Billing'], 'Fix it.', 1), t('DEMO-3', [], 'Fix it.')])
  assert.equal(r.rows.find(x => x.key === 'DEMO-1').gate, 'pass')
  assert.deepEqual(r.summary.byTeam.map(g => [g.team, g.scored, g.passing]), [['no component', 1, 0], ['Billing', 2, 1]])
  assert.equal(r.summary.unreadFiles, 1)
  const card = formatCard(r)
  assert.match(card, /^By component \(lowest pass rate first\):$/m)
  assert.match(card, /^1 refused ticket has files this report does not read/m)
  // One component only: no breakdown, the project line says it all.
  assert.deepEqual(evalTickets(config, [t('DEMO-1', ['Billing'], good)]).summary.byTeam, [])
})
