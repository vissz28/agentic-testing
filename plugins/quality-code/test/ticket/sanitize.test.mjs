import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { adfToText, redact, findMergeRequest, sanitizeTicket } from '../../lib/ticket/sanitize.mjs'

const cfg = r => validateConfig({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ...(r ? { redact: r } : {}) }).config
const id = 'U' + '123456'

test('default patterns', () => {
  assert.equal(redact(cfg(), `mail a.b@example.org id ${id} ws 3f2c1e4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a`),
    'mail user@example.test id U###### ws 00000000-0000-4000-8000-000000000001')
})
test('a team pattern', () => {
  assert.equal(redact(cfg({ vat: 'IT\\d{11}' }), 'IT12345678901'), '[redacted:vat]')
})
test('only summary, description and criteria field are touched', () => {
  const t = sanitizeTicket(cfg(), { key: 'DEMO-1', summary: id, text: { description: id, acField: id }, labels: [id] })
  assert.deepEqual([t.summary, t.text.description, t.text.acField, t.labels[0]], ['U######', 'U######', 'U######', id])
})
test('adf is flattened and ticket keys stay', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shows 150.' }] }] }
  assert.ok(adfToText(adf).includes('Shows 150.'))
  assert.equal(redact(cfg(), 'see DEMO-13441'), 'see DEMO-13441')
  assert.equal(redact(cfg(), null), '')
})
test('merge request found on any host', () => {
  assert.deepEqual(findMergeRequest({ text: { description: 'see https://git.example/g/r/-/merge_requests/61.' } }), { url: 'https://git.example/g/r/-/merge_requests/61', iid: 61 })
  assert.equal(findMergeRequest({ x: 1 }), null)
  const t = sanitizeTicket(cfg(), { remoteLinks: [{ url: 'https://other.example/a/merge_requests/9' }] })
  assert.equal(t.gitlab.iid, 9)
})
test('default customer id is whole-word', () => {
  assert.equal(redact(cfg(), 'ABC' + id + ' and ' + id), 'ABC' + id + ' and U######')
})
test('team patterns run before e-mail and uuid replacement', () => {
  assert.equal(redact(cfg({ x: 'example' }), 'a@b.com'), 'user@example.test')
})
test('harvested free text is redacted: every string in scenarios, qaPlan and flags (spec §10 #8)', () => {
  const mail = 'mario' + '@' + 'acme.example'
  const t = sanitizeTicket(cfg(), {
    key: 'DEMO-1',
    scenarios: [{ then: `shows ${id}`, steps: [`log in as ${mail}`], n: 3 }, `Then ${id} sees 80`],
    qaPlan: { url: 'https://e.atlassian.net/wiki/x', title: `plan for ${id}`, scenarios: [{ expected: `mail ${mail}` }] },
    flags: [`customer ${id}`],
  })
  assert.deepEqual(t.scenarios, [{ then: 'shows U######', steps: ['log in as user@example.test'], n: 3 }, 'Then U###### sees 80'])
  assert.deepEqual(t.qaPlan, { url: 'https://e.atlassian.net/wiki/x', title: 'plan for U######', scenarios: [{ expected: 'mail user@example.test' }] })
  assert.deepEqual(t.flags, ['customer U######'])
  assert.equal('qaPlan' in sanitizeTicket(cfg(), { key: 'DEMO-1' }), false, 'absent fields stay absent')
  assert.equal(sanitizeTicket(cfg(), { key: 'DEMO-1', qaPlan: null }).qaPlan, null)
})

test('ADF: one block per line, inline runs joined as written, hardBreak a line break', () => {
  const p = (...content) => ({ type: 'paragraph', content })
  const t = text => ({ type: 'text', text })
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [t('Acceptance criteria')] },
    p(t('Given an order '), t('at 40.00')),
    p(t('When I open it'), { type: 'hardBreak' }, t('Then the total is '), t('108.00')),
  ] }
  assert.equal(adfToText(doc), 'Acceptance criteria\nGiven an order at 40.00\nWhen I open it\nThen the total is 108.00')
})
test('distinct UUIDs keep distinct placeholders across a ticket; a file name is no e-mail', () => {
  const a = '3f2c1e4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a'
  const b = '16475e6a-1b2c-4d3e-8f9a-0b1c2d3e4f5a'
  const out = sanitizeTicket(cfg(), { key: 'DEMO-1', summary: `ws ${b}`, text: { description: `A ${a} is not B ${b}; see icon@2x.png`, acField: `Then ${a.toUpperCase()}` } })
  assert.equal(out.summary, 'ws 00000000-0000-4000-8000-000000000001')
  assert.equal(out.text.description, 'A 00000000-0000-4000-8000-000000000002 is not B 00000000-0000-4000-8000-000000000001; see icon@2x.png')
  assert.equal(out.text.acField, 'Then 00000000-0000-4000-8000-000000000002')
})
test('a GitHub pull request and a Bitbucket one are found like a GitLab merge request', () => {
  assert.deepEqual(findMergeRequest({ d: 'see https://github.com/acme/app/pull/42.' }), { url: 'https://github.com/acme/app/pull/42', iid: 42 })
  assert.deepEqual(findMergeRequest({ d: 'https://bitbucket.org/acme/app/pull-requests/7' }), { url: 'https://bitbucket.org/acme/app/pull-requests/7', iid: 7 })
})
