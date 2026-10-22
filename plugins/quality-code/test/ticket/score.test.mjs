import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../../lib/base/config.mjs'
import { buildBrief, decideGate, formatReport, THRESHOLD } from '../../lib/ticket/score.mjs'
import { formatRefuseComment } from '../../lib/ticket/jira.mjs'
import { fillMenu } from '../../lib/ticket/fill.mjs'

const cfg = adapter => validateConfig({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en', 'it'],
  features: [{ label: 'Orders', route: '/orders', qaPlanSearch: 'orders' }],
  titlePrefixes: ['FE', 'BE', 'FS'],
}).config

test('the bar is 70 and fixed', () => {
  assert.equal(THRESHOLD, 70)
  assert.equal(decideGate(69), 'refuse')
  assert.equal(decideGate(70), 'pass')
})
test('playwright rubric weights', () => {
  const b = buildBrief(cfg('playwright'), { key: 'DEMO-1', issuetype: 'Bug', labels: [], text: { description: 'x' } })
  assert.deepEqual(b.missing.map(m => [m.key, m.weight]),
    [['ac_present', 25], ['ac_testable', 15], ['steps', 10], ['expected_defined', 10], ['attachments', 10], ['feature_label', 10], ['qa_plan_found', 10], ['links', 5], ['environment', 5]])
})
test('vitest rubric weights', () => {
  const b = buildBrief(cfg('vitest'), { key: 'DEMO-1', issuetype: 'Bug', labels: [], summary: 's', text: { description: 'x' } })
  assert.deepEqual(b.missing.map(m => m.weight), [25, 15, 15, 10, 10, 5, 5, 5, 5, 5])
})
test('feature label comes from config; a bare domain word does not count', () => {
  const c = cfg('vitest')
  assert.equal(buildBrief(c, { key: 'DEMO-1', labels: ['Orders'], text: {} }).signals.feature_label, true)
  assert.equal(buildBrief(c, { key: 'DEMO-1', labels: ['orders-team'], text: {} }).signals.feature_label, false)
})
test('vitest accepts question forms for expected/actual, playwright does not', () => {
  const d = '**What happens?** it shows 150. **What is the expected behavior?** it should show 80.'
  assert.equal(buildBrief(cfg('vitest'), { key: 'DEMO-1', text: { description: d } }).signals.expected_defined, true)
  assert.equal(buildBrief(cfg('playwright'), { key: 'DEMO-1', text: { description: d } }).signals.expected_defined, false)
})
test('route comes from the feature in config', () => {
  assert.equal(buildBrief(cfg('playwright'), { key: 'DEMO-1', labels: ['Orders'], text: {} }).route, '/orders')
})
test('brief field sets match today per stack', () => {
  const fe = buildBrief(cfg('playwright'), { key: 'D-1', text: {} })
  assert.deepEqual(Object.keys(fe).sort(), 'key browse issuetype status score threshold gate legacy feature route scenarios derivable qaPlan figma mr missing flags signals'.split(' ').sort())
  const be = buildBrief(cfg('vitest'), { key: 'D-1', text: {} })
  assert.deepEqual(Object.keys(be).sort(), 'key browse issuetype status score threshold gate legacy feature scenarios derivable missing flags signals'.split(' ').sort())
  assert.equal(be.browse, null)
})
test('qa plan, derivable and title prefix', () => {
  const t = { key: 'D-1', labels: ['Orders'], qaPlan: { url: 'u', scenarios: ['Given a\nThen the total is 150 units'] }, scenarios: [], text: {} }
  const b = buildBrief(cfg('playwright'), t)
  assert.equal(b.signals.qa_plan_found, true)
  assert.equal(b.derivable, 1)
  assert.equal(b.feature, 'Orders')
  assert.equal(buildBrief(cfg('vitest'), { key: 'D-1', summary: '[be] x', text: {} }).signals.title_prefix, true)
  assert.equal(buildBrief(cfg('vitest'), { key: 'D-1', summary: 'x [BE]', text: {} }).signals.title_prefix, false)
})
test('legacy flag and report text are per rubric; rubric is not in the JSON', () => {
  const fe = buildBrief(cfg('playwright'), { key: 'D-1', text: {} })
  const be = buildBrief(cfg('vitest'), { key: 'D-1', text: {} })
  assert.equal(fe.legacy, true)
  assert.match(fe.flags[0], /^legacy \/ unstructured — no template/)
  assert.match(be.flags[0], /^legacy \/ unstructured: no template/)
  assert.ok(!('rubric' in JSON.parse(JSON.stringify(fe))))
  assert.match(formatReport(fe), /^D-1 — test-readiness 0% · legacy/)
  assert.match(formatReport(be), /^D-1: test-readiness 0% · legacy/)
})

// Spec §10 amendment: an empty titlePrefixes or features list can never be met, so its signal is
// left out of what the author reads (missing list, report, refuse comment, fill menu).
const own = (adapter, patch) => validateConfig({ ...cfg(adapter), ...patch }).config
const thin = { key: 'DEMO-1', issuetype: 'Bug', labels: ['Orders'], summary: '[] s', text: { description: 'x' } }

test('titlePrefixes with regex characters are matched literally', () => {
  const c = own('vitest', { titlePrefixes: ['C++', 'A.B'] })
  assert.equal(buildBrief(c, { ...thin, summary: '[C++] fix' }).signals.title_prefix, true)
  assert.equal(buildBrief(c, { ...thin, summary: '[AxB] fix' }).signals.title_prefix, false)
})
test('the vitest title prefix label is built from config', () => {
  const b = buildBrief(own('vitest', { titlePrefixes: ['UI', 'API'] }), thin)
  assert.equal(b.missing.find(m => m.key === 'title_prefix').label, 'title prefix (a configured one, e.g. [UI|API])')
  assert.doesNotMatch(formatReport(b), /FE\|BE\|FS/)
})
test('empty titlePrefixes: never matches and is left out of report, comment and fill menu', () => {
  const c = own('vitest', { titlePrefixes: [] })
  const b = buildBrief(c, thin)
  assert.equal(b.signals.title_prefix, false)
  assert.ok(!b.missing.some(m => m.key === 'title_prefix'))
  assert.doesNotMatch(formatReport(b), /title prefix/i)
  assert.doesNotMatch(formatRefuseComment(c, b), /title prefix/i)
  assert.ok(!fillMenu(c, b).items.some(i => i.key === 'title_prefix'))
})
for (const adapter of ['playwright', 'vitest']) {
  test(`empty features: feature_label is left out of report, comment and fill menu (${adapter})`, () => {
    const c = own(adapter, { features: [] })
    const b = buildBrief(c, thin)
    assert.equal(b.signals.feature_label, false)
    assert.ok(!b.missing.some(m => m.key === 'feature_label'))
    assert.doesNotMatch(formatReport(b), /feature label/i)
    assert.doesNotMatch(formatRefuseComment(c, b), /feature label/i)
    assert.ok(!fillMenu(c, b).items.some(i => i.key === 'feature_label'))
  })
}

const story = description => ({ key: 'DEMO-9', issuetype: 'Story', labels: [], text: { description } })
const FULL = '## User story\nAs a buyer I want the total\n\n## Acceptance criteria\nGiven an order at 40.00\nWhen I open it\nThen the total is 108.00\n\n## Environment\nStaging, Chrome 120'
test('criteria a config can never credit are left out and the rest is scaled to 100', () => {
  const noFeatures = { ...cfg('playwright'), features: [] }
  // No feature, so no qaPlanSearch either: the QA plan is out of reach as well.
  assert.equal(buildBrief(noFeatures, story(FULL)).score, 81, '65 of the 80 a project without features can earn')
  const b = buildBrief({ ...noFeatures, confluence: false }, story(FULL))
  assert.equal(b.score, 81, '65 of 80: attachments and links can still be earned')
  assert.ok(!b.missing.some(m => m.key === 'qa_plan_found'))
  const withBoth = { ...story(FULL), attachments: 1, links: [{ url: 'https://example.com/spec', title: 'spec' }] }
  assert.equal(buildBrief({ ...noFeatures, confluence: false }, withBoth).score, 100)
  assert.equal(buildBrief(cfg('playwright'), story(FULL)).score, 65, 'with features and Confluence nothing changes')
})
// AGT-115: no rubric points a project cannot earn.
const noSearch = () => own('playwright', { features: [{ label: 'Orders', route: '/orders' }] })
test('no qaPlanSearch and no page attached: the QA plan is not missing and does not lower the score', () => {
  const b = buildBrief(noSearch(), story(FULL))
  assert.ok(!b.missing.some(m => m.key === 'qa_plan_found'))
  assert.equal(b.score, 72, '65 of the 90 left: the QA plan is out of reach')
  assert.equal(b.score, buildBrief({ ...noSearch(), confluence: false }, story(FULL)).score, 'the same as a team without Confluence')
  assert.doesNotMatch(formatRefuseComment(noSearch(), b), /QA plan/i)
  assert.ok(!fillMenu(noSearch(), JSON.parse(JSON.stringify(b))).items.some(i => i.key === 'qa_plan_found'))
})
test('a feature with a qaPlanSearch and no page found: the QA plan is missing', () => {
  const b = buildBrief(cfg('playwright'), story(FULL))
  assert.ok(b.missing.some(m => m.key === 'qa_plan_found' && m.weight === 10))
  assert.equal(b.score, 65)
  // Any feature with search words is enough: the ticket may not carry a label yet.
  const other = own('playwright', { features: [{ label: 'Orders' }, { label: 'Invoices', qaPlanSearch: 'invoices' }] })
  assert.ok(buildBrief(other, story(FULL)).missing.some(m => m.key === 'qa_plan_found'))
})
test('no qaPlanSearch but a QA-plan page attached to the ticket: the plan is credited', () => {
  const qaPlan = { title: 'QA plan - Orders', url: 'https://example.atlassian.net/wiki/spaces/DEMO/pages/1', scenarios: [] }
  const b = buildBrief(noSearch(), { ...story(FULL), qaPlan })
  assert.equal(b.signals.qa_plan_found, true)
  assert.equal(b.score, 75, '75 of 100: the plan counts once it is there')
  assert.ok(!b.missing.some(m => m.key === 'qa_plan_found'))
})
test('bold or bulleted Gherkin counts; a vague But line is not testable; e.g. is no step', () => {
  const p = cfg('playwright')
  for (const d of ['**Given** an order at 40.00\n**When** I open it\n**Then** the total is 108.00', '- Given an order at 40.00\n- When I open it\n- Then the total is 108.00']) {
    assert.equal(buildBrief(p, story(d)).signals.ac_present, true, d)
  }
  const vague = buildBrief(p, story('Given an order\nWhen I open it\nThen the total is 108.00\nBut the page works correctly'))
  assert.equal(vague.signals.ac_testable, false)
})
test('feature labels match in any case and report the configured label', () => {
  const b = buildBrief(cfg('playwright'), { ...story(FULL), labels: ['orders'] })
  assert.equal(b.signals.feature_label, true)
  assert.equal(b.feature, 'Orders')
  assert.equal(b.route, '/orders')
})
test('an Environment heading with any line under it counts; "## Contextual menu" is no Context heading', () => {
  const v = cfg('vitest')
  assert.equal(buildBrief(v, story('## Environment\nStaging, Chrome 120 on Windows 11')).signals.environment, true)
  assert.equal(buildBrief(v, story('## Environment\n\n## Notes')).signals.environment, false)
  assert.equal(buildBrief(v, story('## Contextual menu\nopens on right click')).signals.context, false)
})
test('a Defect is a bug; jira.bugTypes names them exactly', () => {
  const v = cfg('vitest')
  assert.match(formatRefuseComment(v, buildBrief(v, { ...story('x'), issuetype: 'Defect' })), /Steps to reproduce/)
  const custom = { ...v, jira: { ...v.jira, bugTypes: ['Anomaly'] } }
  assert.match(formatRefuseComment(custom, buildBrief(custom, { ...story('x'), issuetype: 'anomaly' })), /Steps to reproduce/)
  assert.doesNotMatch(formatRefuseComment(custom, buildBrief(custom, { ...story('x'), issuetype: 'Bug' })), /Steps to reproduce/)
})
