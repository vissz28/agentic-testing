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
  features: [{ label: 'Orders', route: '/orders' }],
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
    [['ac_present', 30], ['ac_testable', 15], ['feature_label', 15], ['qa_plan_found', 15], ['steps', 10], ['expected_defined', 10], ['environment', 5]])
})
test('vitest rubric weights', () => {
  const b = buildBrief(cfg('vitest'), { key: 'DEMO-1', issuetype: 'Bug', labels: [], summary: 's', text: { description: 'x' } })
  assert.deepEqual(b.missing.map(m => m.weight), [30, 15, 15, 15, 10, 5, 5, 5])
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
