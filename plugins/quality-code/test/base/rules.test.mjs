// The Central Context rules: read live by id, the snapshot when the hub is off or away, and a record
// that always says which. A rule the hub does not have is reported missing, never invented.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditRules, CHECK_GATES, fetchFromHub, GATE_RULES, hubOf, loadSnapshot, resolveRules, ruleOfCheck, RULE_IDS, rulesCardLine, rulesLogLines, SNAPSHOT_URL } from '../../lib/base/rules.mjs'

const doc = (id, status = 'active') => ({ id, title: `Title of ${id}`, summary: `Summary of ${id}`, status, severity: 'high', owner: '@owner', release_id: 'dir-abc' })
const fakeFetch = (have, { release = 'dir-abc', manifest = true } = {}) => async url => {
  const u = new URL(url)
  if (u.pathname === '/v1/manifest') return manifest ? { ok: true, status: 200, json: async () => ({ release: { id: release } }) } : { ok: false, status: 500 }
  const id = decodeURIComponent(u.pathname.split('/').pop())
  return have.includes(id) ? { ok: true, status: 200, json: async () => doc(id) } : { ok: false, status: 404 }
}

test('four gates, four distinct rule ids, and every check that answers to one', () => {
  assert.deepEqual(Object.keys(GATE_RULES), ['readiness', 'fail_evidence', 'assertion', 'weakening'])
  assert.equal(new Set(RULE_IDS).size, 4)
  assert.ok(RULE_IDS.every(id => /^quality\.[a-z0-9-]+$/.test(id)))
  assert.equal(ruleOfCheck('honesty'), GATE_RULES.weakening)
  assert.equal(ruleOfCheck('suite-honesty'), GATE_RULES.assertion)
  assert.equal(ruleOfCheck('expected'), GATE_RULES.readiness)
  for (const c of ['tests', 'mutation', 'stryker']) assert.equal(ruleOfCheck(c), GATE_RULES.fail_evidence, c)
  for (const c of ['boundary', 'types', 'flaky']) assert.equal(ruleOfCheck(c), null, c)
  assert.ok(Object.values(CHECK_GATES).every(g => g in GATE_RULES))
})

test('the hub: environment first, then the config, trailing slash dropped, nothing when neither names one', () => {
  assert.equal(hubOf({ centralContext: { hub: 'http://hub.test:8080/' } }, {}), 'http://hub.test:8080')
  assert.equal(hubOf({ centralContext: { hub: 'http://hub.test' } }, { CC_HUB_URL: 'http://env.test' }), 'http://env.test')
  assert.equal(hubOf({}, {}), null)
  assert.equal(hubOf({ centralContext: { hub: '  ' } }, {}), null)
  assert.equal(hubOf({ centralContext: { hub: 'off' } }, {}), 'off')
})

test('the snapshot holds every rule, active, with a release id', () => {
  const s = loadSnapshot()
  assert.equal(s.source, 'snapshot')
  assert.deepEqual(s.missing, [])
  assert.ok(s.rules.every(r => r.status === 'active' && r.summary && r.owner), 'each rule has status, summary and owner')
  assert.match(s.release, /^dir-[0-9a-f]+$/)
  const raw = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'))
  assert.deepEqual(raw.rules.map(r => r.id).sort(), [...RULE_IDS].sort())
})

test('live: all three rules, the release from the manifest, the card says live', async () => {
  const p = await resolveRules({ hub: 'http://hub.test', fetchImpl: fakeFetch([...RULE_IDS]) })
  assert.equal(p.source, 'hub')
  assert.equal(p.release, 'dir-abc')
  assert.equal(p.rules.length, 4)
  assert.deepEqual(p.missing, [])
  assert.equal(p.error, null)
  assert.equal(rulesCardLine(p), 'Rules: Central Context release dir-abc, 4 rules read live.')
  assert.deepEqual(auditRules(p), { source: 'hub', release: 'dir-abc', ids: RULE_IDS.map(id => `${id}@active`), missing: [] })
})

test('live with a rule the hub does not know: reported missing, never invented, and said on the card', async () => {
  const p = await resolveRules({ hub: 'http://hub.test', fetchImpl: fakeFetch([GATE_RULES.weakening]) })
  assert.equal(p.source, 'hub')
  assert.deepEqual(p.rules.map(r => r.id), [GATE_RULES.weakening])
  assert.deepEqual(p.missing, [GATE_RULES.readiness, GATE_RULES.fail_evidence, GATE_RULES.assertion])
  assert.match(rulesCardLine(p), /1 rule read live, 3 missing\.$/)
  const log = rulesLogLines(p).join('\n')
  assert.match(log, /\| readiness \| `quality\.ready-requirement-before-test-generation` \| \*\*missing\*\* \|/)
  assert.match(log, /A missing rule is not a passed rule/)
})

test('a 500 on the manifest is a transport error: snapshot, with the reason kept', async () => {
  const p = await resolveRules({ hub: 'http://hub.test', fetchImpl: fakeFetch([...RULE_IDS], { manifest: false }) })
  assert.equal(p.source, 'snapshot')
  assert.match(p.error, /not reachable at http:\/\/hub\.test \(\/v1\/manifest: HTTP 500\)/)
  assert.equal(p.rules.length, 4)
  assert.equal(p.hub, 'http://hub.test')
})

test('hub down: the snapshot, the error on the card and in the log', async () => {
  const p = await resolveRules({ hub: 'http://hub.test', fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(p.source, 'snapshot')
  assert.match(p.error, /^Central Context not reachable at http:\/\/hub\.test \(ECONNREFUSED\)$/)
  assert.match(rulesCardLine(p), /^Rules: pinned Central Context snapshot dir-[0-9a-f]+ \(Central Context not reachable/)
  assert.match(rulesLogLines(p).join('\n'), /\*\*Hub not used:\*\* Central Context not reachable/)
})

test('not configured and off: the snapshot without a network call, each with its own reason', async () => {
  const never = async () => { throw new Error('must not be called') }
  const none = await resolveRules({ hub: null, fetchImpl: never })
  assert.equal(none.source, 'snapshot')
  assert.match(none.error, /not configured \(centralContext\.hub\)/)
  const off = await resolveRules({ hub: 'off', fetchImpl: never })
  assert.equal(off.source, 'snapshot')
  assert.match(off.error, /off \(centralContext\.hub: "off"\)/)
})

test('no hub and no snapshot: a record that says so, every rule missing', async () => {
  const p = await resolveRules({ hub: null, snapshotUrl: new URL('./nowhere.json', import.meta.url) })
  assert.equal(p.source, 'none')
  assert.deepEqual(p.missing, [...RULE_IDS])
  assert.match(rulesCardLine(p), /^Rules: no Central Context source/)
  assert.match(rulesLogLines(p).join('\n'), /\*\*No rule source:\*\*/)
  assert.deepEqual(auditRules(p), { source: 'none', release: null, ids: [], missing: [...RULE_IDS] })
})

test('fetchFromHub asks the manifest and each rule by id, with a timeout signal', async () => {
  const calls = []
  const p = await fetchFromHub('http://hub.test', { fetchImpl: async (url, init) => { calls.push(url); assert.ok(init.signal instanceof AbortSignal); return fakeFetch([...RULE_IDS])(url) }, timeoutMs: 50 })
  assert.equal(calls[0], 'http://hub.test/v1/manifest')
  assert.deepEqual(calls.slice(1).sort(), RULE_IDS.map(id => `http://hub.test/v1/documents/${encodeURIComponent(id)}`).sort())
  assert.equal(p.release, 'dir-abc')
})

test('the log section: every gate once, each rule summary once, the mapping sentence', async () => {
  const lines = rulesLogLines(await resolveRules({ hub: 'http://hub.test', fetchImpl: fakeFetch([...RULE_IDS]) }))
  assert.equal(lines[1], '## Rules (Central Context)')
  assert.equal(lines.filter(l => l.startsWith('| ')).length, 1 + 4, 'header row and four gate rows')
  assert.equal(lines.filter(l => l.startsWith('- `quality.')).length, 4)
  assert.match(lines.at(-1), /^Checks and gates: /)
  assert.deepEqual(rulesLogLines(null), [])
  assert.equal(rulesCardLine(null), null)
})
