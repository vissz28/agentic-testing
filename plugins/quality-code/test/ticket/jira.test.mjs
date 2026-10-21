import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { buildBrief, formatReport } from '../../lib/ticket/score.mjs'
import { naturalLength } from '../../lib/ticket/criteria.mjs'
import { messagesFor } from '../../lib/ticket/messages.mjs'
import { formatRefuseComment, formatRiskComment, templateLine, browseUrl, jiraUpdate, formatJiraUpdate, isRefuseComment, REFUSE_COMMENT_FOOTER, OLD_FOOTER, REFUSE_COMMENT_MARK, RISK_COMMENT_FOOTER } from '../../lib/ticket/jira.mjs'

const base = { version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [{ label: 'Orders' }] }
const cfg = (patch = {}) => validateConfig({ ...base, ...patch }).config
const bare = { key: 'DEMO-1', issuetype: 'Bug', labels: [], summary: 's', text: { description: 'Broken.' } }

test('neutral defaults: no product words, labels from config', () => {
  const c = formatRefuseComment(cfg(), buildBrief(cfg(), bare))
  assert.match(c, /We could not find acceptance criteria\./)
  assert.match(c, /Orders/)
  assert.doesNotMatch(c, /warehouse|magazzino|Giacenza/i)
})
test('a story is not asked for steps to reproduce or environment', () => {
  const c = formatRefuseComment(cfg(), buildBrief(cfg(), { ...bare, issuetype: 'Story' }))
  assert.doesNotMatch(c, /Steps to reproduce|## Environment/)
  assert.match(c, /### \d\. User story/)
})
test('config messages override per key and per story', () => {
  const c = cfg({ messages: { ac_present: { missing: 'Custom missing.' }, story: { steps: { title: 'Story line' } } } })
  assert.match(formatRefuseComment(c, buildBrief(c, bare)), /Custom missing\./)
  assert.match(formatRefuseComment(c, buildBrief(c, { ...bare, issuetype: 'Story' })), /Story line/)
})
test('template line: override, path, or nothing', () => {
  assert.equal(templateLine(cfg(), 'Bug'), '')
  assert.equal(templateLine(cfg({ ticketTemplates: { bug: '.github/ISSUE_TEMPLATE/bug.md' } }), 'Bug'), 'The full Bug template is at .github/ISSUE_TEMPLATE/bug.md.')
  assert.equal(templateLine(cfg({ messages: { templateLine: { bug: 'X' } } }), 'Bug'), 'X')
})
test('browse URL from config', () => {
  assert.equal(browseUrl(cfg(), 'DEMO-1'), 'https://example.atlassian.net/browse/DEMO-1')
})
test('jira update sends only filled sections', () => {
  const t = { ...bare, filled: [{ key: 'ac_present', section: '## Acceptance criteria\n- x' }, { key: 'feature_label', label: 'Orders' }] }
  const u = jiraUpdate(cfg(), t)
  assert.equal(u.append, '_Added during the quality-code readiness check._\n\n## Acceptance criteria\n- x')
  assert.deepEqual(u.labelsAdd, ['Orders'])
  assert.match(formatJiraUpdate(u), /Nothing already on the ticket is changed\./)
})
test('the Jira fill marker comes from messages.jiraFillMark (spec §10 #9)', () => {
  const t = { ...bare, filled: [{ key: 'steps', section: '## Steps to reproduce\n1. a' }] }
  assert.equal(jiraUpdate(cfg({ messages: { jiraFillMark: '_Added by QA._' } }), t).append, '_Added by QA._\n\n## Steps to reproduce\n1. a')
  assert.equal(jiraUpdate(cfg(), { ...bare, filled: [] }).append, null)
})
test('the template line leaves no blank line behind when empty', () => {
  const c = cfg()
  const out = formatRefuseComment(c, buildBrief(c, bare))
  assert.ok(!out.includes('\n\n\n'))
  assert.ok(out.endsWith(`\n\n${REFUSE_COMMENT_FOOTER}`))
  const c2 = cfg({ ticketTemplates: { bug: 'b.md' } })
  assert.match(formatRefuseComment(c2, buildBrief(c2, bare)), /\n\nThe full Bug template is at b\.md\.\n\nThanks, we can/)
})
test('refuse markers', () => {
  assert.ok(isRefuseComment(`x ${REFUSE_COMMENT_FOOTER}`))
  assert.ok(isRefuseComment(OLD_FOOTER))
  assert.ok(isRefuseComment(REFUSE_COMMENT_MARK))
  assert.ok(!isRefuseComment('hello'))
})
test('qa_plan_found never appears in the comment', () => {
  const c = cfg({ adapter: 'playwright' })
  const out = formatRefuseComment(c, buildBrief(c, bare))
  assert.doesNotMatch(out, /QA plan/)
})
test('defaults cover every rubric key; AC examples are long enough', () => {
  const m = messagesFor(cfg(), 'bug')
  for (const k of ['ac_present', 'ac_testable', 'feature_label', 'qa_plan_found', 'steps', 'expected_defined', 'context', 'title_prefix', 'environment']) {
    assert.ok(m[k].title && m[k].missing && m[k].label, k)
    if (k !== 'qa_plan_found') assert.ok(m[k].add && m[k].question && 'example' in m[k], k)
  }
  assert.ok(naturalLength([m.ac_present.example]) >= 150)
  assert.ok(naturalLength([m.ac_testable.example]) >= 150)
  assert.match(m.feature_label.add, /Orders/)
  assert.equal(messagesFor(cfg(), 'story').context.title, 'Context')
  assert.equal(messagesFor(cfg(), 'story').steps.title, 'User story')
})
test('a config overrides every field of every key', () => {
  const fields = ['title', 'missing', 'add', 'question', 'example', 'label']
  const msgs = {}
  for (const k of Object.keys(messagesFor(cfg(), 'bug'))) msgs[k] = Object.fromEntries(fields.map(f => [f, `${k}-${f}`]))
  const m = messagesFor(cfg({ messages: msgs }), 'bug')
  for (const k of Object.keys(msgs)) assert.deepEqual(m[k], msgs[k])
})
test('config label overrides the rubric label in missing and the report', () => {
  const c = cfg({ messages: { ac_present: { label: 'X' }, story: { steps: { label: 'S' } } } })
  const b = buildBrief(c, bare)
  assert.equal(b.missing.find(m => m.key === 'ac_present').label, 'X')
  assert.match(formatReport(b), /- X \(30\)/)
  assert.notEqual(b.missing.find(m => m.key === 'steps').label, 'S')
  const bs = buildBrief(c, { ...bare, issuetype: 'Story' })
  assert.equal(bs.missing.find(m => m.key === 'steps').label, 'S')
})
test('the fallback body comes from messages.refuseFallback', () => {
  const brief = { issuetype: 'Bug', missing: [] }
  const out = formatRefuseComment(cfg({ messages: { refuseFallback: 'X' } }), brief)
  assert.match(out, /\n\nX\n\n/)
  assert.doesNotMatch(out, /Please add Steps to reproduce/)
  assert.match(formatRefuseComment(cfg(), brief), /Please add Steps to reproduce, Expected, Actual, and Given \/ When \/ Then\./)
})
test('the risk note: the score against the bar, the red mark, what the author can still add, its footer', () => {
  const c = cfg()
  const b = buildBrief(c, bare)
  const note = formatRiskComment(c, b)
  assert.ok(note.startsWith(`Tests were written for this ticket although it is not complete: it has ${b.score} of the 70 points it needs.\n`))
  assert.match(note, /🔴 \[RISK \/ NOT RECOMMENDED\]/)
  assert.match(note, /Still missing:\n- Acceptance criteria\n/)
  // one fix, named once: no vague-Then line while the criteria are missing
  assert.doesNotMatch(note, /results must be specific/)
  assert.ok(note.endsWith(`\n\n${RISK_COMMENT_FOOTER}`))
  assert.ok(!isRefuseComment(note), 'a re-run must not mistake it for the refuse comment')
  assert.doesNotMatch(note, /warehouse|magazzino/i)
})
test('the risk note on a story never lists a section the story template does not carry', () => {
  const c = cfg()
  const note = formatRiskComment(c, buildBrief(c, { ...bare, issuetype: 'Story' }))
  assert.doesNotMatch(note, /Environment|Expected and actual/)
})
