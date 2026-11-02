import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatRules, hubOf, readRules, stacksFor, testingRules } from '../../lib/base/rules.mjs'
import { main } from '../../bin/rules.mjs'

const doc = (id, o = {}) => ({ id: `quality.${id}`, domain: 'quality', status: 'active', severity: 'medium', summary: `${id} summary.`, tags: ['test'], applies_to: ['all'], ...o })
const DOCS = [
  doc('isolated-tests', { severity: 'high' }),
  doc('coverage'),
  doc('node-only', { applies_to: ['node'] }),
  doc('web-only', { applies_to: ['web'] }),
  doc('pipeline-naming', { applies_to: ['ci'] }),
  doc('iac', { applies_to: ['iac', 'ci'], tags: ['testing'] }),
  doc('sprints', { tags: ['scrum'] }),
  doc('old', { status: 'deprecated' }),
  { ...doc('x'), id: 'security.x', domain: 'security' },
]
const MANIFEST = { release: { release_id: 'local-abc' }, documents: DOCS }
const fetchOk = async () => ({ ok: true, status: 200, json: async () => MANIFEST })
const ids = r => r.map(x => x.id.replace('quality.', ''))

test('stacksFor: each side matches its stacks and "all"; the backend follows the project runner', () => {
  assert.deepEqual(stacksFor('backend'), ['all', 'node', 'typescript', 'javascript', 'rest'])
  assert.deepEqual(stacksFor('frontend'), ['all', 'web', 'typescript', 'javascript'])
  assert.deepEqual(stacksFor('fullstack'), ['all', 'node', 'typescript', 'javascript', 'rest', 'web'])
  assert.deepEqual(stacksFor('backend', { adapter: 'pytest' }), ['all', 'python', 'rest'])
  assert.deepEqual(stacksFor('fullstack', { adapter: 'fullstack', backend: 'junit' }), ['all', 'java', 'rest', 'web', 'typescript', 'javascript'])
})

test('testingRules: active quality rules about testing for the side only, most severe first; never CI or infrastructure', () => {
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('backend'))), ['isolated-tests', 'coverage', 'node-only'])
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('frontend'))), ['isolated-tests', 'coverage', 'web-only'])
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('fullstack'))), ['isolated-tests', 'coverage', 'node-only', 'web-only'])
  assert.deepEqual(testingRules(undefined, ['all']), [])
})

test('hubOf: CC_HUB_URL wins over the config; a trailing slash is dropped; nothing named is null', () => {
  assert.equal(hubOf({ centralContext: { hub: 'http://a:1/' } }, {}), 'http://a:1')
  assert.equal(hubOf({ centralContext: { hub: 'http://a:1' } }, { CC_HUB_URL: 'http://b:2' }), 'http://b:2')
  assert.equal(hubOf(null, {}), null)
})

test('readRules: the hub\'s release and rules; no hub, "off" or a failing hub read none and say why, never throw', async () => {
  const config = { adapter: 'vitest', centralContext: { hub: 'http://hub' } }
  const r = await readRules({ side: 'backend', config, env: {}, fetchImpl: fetchOk })
  assert.equal(r.source, 'hub')
  assert.equal(r.release, 'local-abc')
  assert.deepEqual(ids(r.rules), ['isolated-tests', 'coverage', 'node-only'])
  assert.match(formatRules(r), /^From Central Context \(http:\/\/hub, release local-abc\): testing rules for the backend side \(all, node, typescript, javascript, rest\)\n  quality\.isolated-tests · high\n    isolated-tests summary\./)
  const none = async (c, f) => formatRules(await readRules({ side: 'backend', config: c, env: {}, fetchImpl: f }))
  assert.equal(await none({ adapter: 'vitest' }), 'From Central Context: not configured (centralContext.hub), so no rule is applied.')
  assert.equal(await none({ adapter: 'vitest', centralContext: { hub: 'off' } }), 'From Central Context: off (centralContext.hub: "off"), so no rule is applied.')
  assert.equal(await none(config, async () => { throw new Error('fetch failed') }), 'From Central Context: not reachable at http://hub (fetch failed), so no rule is applied.')
  assert.equal(await none(config, async () => ({ ok: false, status: 503 })), 'From Central Context: not reachable at http://hub (HTTP 503), so no rule is applied.')
  const empty = await readRules({ side: 'frontend', config, env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ release: { release_id: 'r' }, documents: [] }) }) })
  assert.match(formatRules(empty), /: none applies\.$/)
})

test('rules.mjs: the project side by default, --side for a ticket, a RULES_JSON line, exit 2 on a bad side', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-rules-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 1, adapter: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, centralContext: { hub: 'http://hub' } }))
  const run = async argv => { let out = ''; let err = ''; const code = await main(argv, { CLAUDE_PROJECT_DIR: root }, root, { fetchImpl: fetchOk, stdout: s => { out += s }, stderr: s => { err += s } }); return { code, out, err } }
  const fe = await run([])
  assert.equal(fe.code, 0)
  assert.match(fe.out, /testing rules for the frontend side/)
  assert.equal(JSON.parse(fe.out.split('RULES_JSON:')[1]).rules.length, 3)
  assert.match((await run(['--side', 'fullstack'])).out, /fullstack side/)
  const bad = await run(['--side', 'mobile'])
  assert.equal(bad.code, 2)
  assert.match(bad.err, /^--side must be frontend, backend, fullstack/)
})
