import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_HUB, formatRules, hubOf, localRules, parseRule, readRules, rulesLine, rulesRecord, stacksFor, testingRules } from '../../lib/base/rules.mjs'
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
// No built-in rules: these tests are about the hub and the project's folder.
const NO_BUILTIN = mkdtempSync(join(tmpdir(), 'qc-no-builtin-'))
const ids = r => r.map(x => x.id.replace('quality.', ''))

test('stacksFor: each side matches its stacks and "all"; the backend follows the project runner', () => {
  assert.deepEqual(stacksFor('backend'), ['all', 'node', 'typescript', 'javascript', 'rest'])
  assert.deepEqual(stacksFor('frontend'), ['all', 'web', 'typescript', 'javascript'])
  assert.deepEqual(stacksFor('fullstack'), ['all', 'node', 'typescript', 'javascript', 'rest', 'web'])
  assert.deepEqual(stacksFor('backend', { adapter: 'pytest', backend: 'pytest' }), ['all', 'python', 'rest'])
  assert.deepEqual(stacksFor('fullstack', { frontend: 'playwright', backend: 'junit' }), ['all', 'java', 'rest', 'web', 'typescript', 'javascript'])
})

test('testingRules: active quality rules about testing for the side only, most severe first; never CI or infrastructure', () => {
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('backend'))), ['isolated-tests', 'coverage', 'node-only'])
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('frontend'))), ['isolated-tests', 'coverage', 'web-only'])
  assert.deepEqual(ids(testingRules(DOCS, stacksFor('fullstack'))), ['isolated-tests', 'coverage', 'node-only', 'web-only'])
  assert.deepEqual(testingRules(undefined, ['all']), [])
})

test('hubOf: CC_HUB_URL wins over the config; a trailing slash is dropped; nothing named is the hosted hub', () => {
  assert.equal(hubOf({ centralContext: { hub: 'http://a:1/' } }, {}), 'http://a:1')
  assert.equal(hubOf({ centralContext: { hub: 'http://a:1' } }, { CC_HUB_URL: 'http://b:2' }), 'http://b:2')
  assert.equal(hubOf(null, {}), DEFAULT_HUB)
  assert.equal(hubOf({ centralContext: {} }, {}), DEFAULT_HUB)
})

test('readRules: the hub\'s release and rules; no hub, "off" or a failing hub read none and say why, never throw', async () => {
  const config = { adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'http://hub' } }
  const r = await readRules({ side: 'backend', config, env: {}, fetchImpl: fetchOk, builtinRoot: NO_BUILTIN })
  assert.equal(r.source, 'hub')
  assert.equal(r.release, 'local-abc')
  assert.deepEqual(ids(r.rules), ['isolated-tests', 'coverage', 'node-only'])
  assert.equal(formatRules(r), '✅ Central Context: 3 backend testing rules (release local-abc)')
  const none = async (c, f) => formatRules(await readRules({ side: 'backend', config: c, env: {}, fetchImpl: f, builtinRoot: NO_BUILTIN }))
  assert.equal(await none({ adapter: 'vitest', backend: 'vitest' }, async () => { throw new Error('fetch failed') }), `⚠️ Central Context could not be reached at ${DEFAULT_HUB} (fetch failed). No rules applied.`)
  assert.equal(await none({ adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'off' } }), '⚠️ Central Context is turned off in the config. No rules applied.')
  assert.equal(await none(config, async () => { throw new Error('fetch failed') }), '⚠️ Central Context could not be reached at http://hub (fetch failed). No rules applied.')
  assert.equal(await none(config, async () => ({ ok: false, status: 503 })), '⚠️ Central Context could not be reached at http://hub (HTTP 503). No rules applied.')
  const empty = await readRules({ side: 'frontend', config, env: {}, builtinRoot: NO_BUILTIN, fetchImpl: async () => ({ ok: true, json: async () => ({ release: { release_id: 'r' }, documents: [] }) }) })
  assert.equal(formatRules(empty), '✅ Central Context: no frontend testing rules (release r)')
})

test('rules.mjs: the project side by default, --side for a ticket, a RULES_JSON line, exit 2 on a bad side', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-rules-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 2, frontend: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, centralContext: { hub: 'http://hub' } }))
  const run = async argv => { let out = ''; let err = ''; const code = await main(argv, { CLAUDE_PROJECT_DIR: root }, root, { fetchImpl: fetchOk, stdout: s => { out += s }, stderr: s => { err += s } }); return { code, out, err } }
  const fe = await run([])
  assert.equal(fe.code, 0)
  assert.match(fe.out, /^✅ Central Context: 3 frontend testing rules/)
  assert.equal(JSON.parse(fe.out.split('RULES_JSON:')[1]).rules.length, 3)
  assert.match((await run(['--side', 'fullstack'])).out, /fullstack testing rules/)
  const bad = await run(['--side', 'mobile'])
  assert.equal(bad.code, 2)
  assert.match(bad.err, /^--side must be frontend, backend, fullstack/)
})

test('rules.mjs --key saves what was read for the card; a key of another project is refused and saves nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-rules-key-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ version: 2, frontend: 'playwright', ticketsDir: 't', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, centralContext: { hub: 'http://hub' } }))
  const run = (argv, fetchImpl = fetchOk) => main(argv, { CLAUDE_PROJECT_DIR: root, QUALITY_CODE_PLACE: 'repo' }, root, { fetchImpl, stdout: () => {}, stderr: () => {} })
  assert.equal(await run(['--side', 'frontend', '--key', 'ABC-1']), 0)
  const rec = JSON.parse(readFileSync(join(root, 't/ABC-1/rules.json'), 'utf8'))
  assert.deepEqual([rec.source, rec.hub, rec.release, rec.hubRules], ['hub', 'http://hub', 'local-abc', 3])
  assert.equal(await run(['--key', 'ABC-2'], async () => { throw new Error('ECONNREFUSED') }), 0)
  assert.equal(JSON.parse(readFileSync(join(root, 't/ABC-2/rules.json'), 'utf8')).source, 'none')
  assert.equal(await run(['--key', '../../x']), 2)
  assert.equal(existsSync(join(root, 'x')), false)
})

test('rulesLine: Central Context with its release and the other sources; otherwise the fallback, and why', async () => {
  const r = { source: 'hub', hub: 'https://cc.example.com', release: 'r1', error: null, side: 'frontend', rules: [{ id: 'a' }], builtin: { rules: [{ id: 'b' }, { id: 'c' }] }, local: null }
  assert.equal(rulesLine(rulesRecord(r)), '✅ Written with 1 rule from Central Context (release r1) and 2 built-in rules')
  const down = { ...r, source: 'none', release: null, rules: [], error: 'could not be reached at https://cc.example.com (HTTP 502)' }
  assert.equal(rulesLine(rulesRecord(down)), '⚠️ Central Context could not be reached at https://cc.example.com (HTTP 502). Written with 2 built-in rules instead')
  assert.equal(rulesLine(rulesRecord({ ...down, builtin: { rules: [] } })), '⚠️ Central Context could not be reached at https://cc.example.com (HTTP 502). No rules applied')
})

const RULE = (id, o = '') => `---\nid: ${id}\ntitle: "Title of ${id}"\nsummary: "The ${id} rule, in one sentence."\nseverity: high\n${o}---\n## Rule\n\nBody.\n`

test('parseRule: the knowledge repository\'s frontmatter, quoted strings, lists and null; none without frontmatter', () => {
  const d = parseRule(RULE('team.mocks', 'status: active\napplies_to: [node, rest]\ntags: [test, "mock, stub"]\nsuperseded_by: null\nowner: \'@a\'\n'))
  assert.deepEqual([d.id, d.title, d.status, d.applies_to, d.superseded_by, d.owner], ['team.mocks', 'Title of team.mocks', 'active', ['node', 'rest'], null, '@a'])
  assert.equal(parseRule('## no frontmatter'), null)
})

test('parseRule and localRules: a YAML escape JSON rejects and a quoted list item with a comma are read; a file that cannot be read is skipped', () => {
  const d = parseRule(RULE('team.paths', 'path: "C:\\Users"\ntags: ["unit, integration", e2e]\n'))
  assert.deepEqual([d.path, d.tags], ['C:\\Users', ['unit, integration', 'e2e']])
  const root = mkdtempSync(join(tmpdir(), 'qc-bad-rule-'))
  mkdirSync(join(root, 'rules/folder.md'), { recursive: true })
  writeFileSync(join(root, 'rules/a.md'), RULE('team.ok'))
  assert.deepEqual(localRules(root, 'rules/', ['all']).rules.map(r => r.id), ['team.ok'])
})
test('localRules: active rules for the stacks (status active and applies_to all by default), most severe first; a missing folder says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-local-rules-'))
  mkdirSync(join(root, 'rules'))
  writeFileSync(join(root, 'rules/a.md'), RULE('team.default'))
  writeFileSync(join(root, 'rules/b.md'), RULE('team.web-only', 'applies_to: [web]\n'))
  writeFileSync(join(root, 'rules/c.md'), RULE('team.old', 'status: deprecated\n'))
  writeFileSync(join(root, 'rules/d.md'), '---\nid: team.no-summary\n---\n')
  writeFileSync(join(root, 'rules/README.md'), RULE('team.readme'))
  writeFileSync(join(root, 'rules/notes.txt'), RULE('team.txt'))
  assert.deepEqual(localRules(root, 'rules/', stacksFor('backend')).rules.map(r => r.id), ['team.default'])
  assert.deepEqual(localRules(root, 'rules/', stacksFor('frontend')).rules.map(r => r.id), ['team.default', 'team.web-only'])
  assert.deepEqual(localRules(root, 'nope/', ['all']), { dir: 'nope/', rules: [], error: 'folder not found: nope/' })
})

test('readRules with local rules: both sources, one line each; a hub that fails still shows the local rules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-local-read-'))
  mkdirSync(join(root, 'rules'))
  writeFileSync(join(root, 'rules/a.md'), RULE('team.mocks'))
  const config = { adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'http://hub', local: 'rules/' } }
  const both = await readRules({ side: 'backend', config, root, env: {}, fetchImpl: fetchOk, builtinRoot: NO_BUILTIN })
  assert.deepEqual(both.local.rules.map(r => r.id), ['team.mocks'])
  assert.equal(formatRules(both), '✅ Central Context: 3 backend testing rules (release local-abc)\n✅ Local rules: 1 backend testing rule (rules/)')
  const down = await readRules({ side: 'backend', config, root, env: {}, builtinRoot: NO_BUILTIN, fetchImpl: async () => { throw new Error('fetch failed') } })
  assert.equal(formatRules(down), '⚠️ Central Context could not be reached at http://hub (fetch failed).\n✅ Local rules: 1 backend testing rule (rules/)')
  const lost = await readRules({ side: 'backend', config: { ...config, centralContext: { hub: 'off', local: 'gone/' } }, root, env: {}, builtinRoot: NO_BUILTIN })
  assert.equal(formatRules(lost), '⚠️ Central Context is turned off in the config. No rules applied.\n⚠️ Local rules not read: folder not found: gone/.')
  assert.equal((await readRules({ side: 'backend', config: { adapter: 'vitest', backend: 'vitest' }, root, env: {}, builtinRoot: NO_BUILTIN })).local, null, 'no local folder configured')
})

test('built-in rules: the plugin ships its drafts; the project\'s rule, then Central Context\'s, replaces a built-in one with the same id', async () => {
  const shipped = (await readRules({ side: 'backend', config: { adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'off' } }, env: {} })).builtin
  assert.equal(shipped.error, null)
  assert.deepEqual(shipped.rules.map(r => r.id).sort(), ['quality.generated-test-fail-evidence', 'quality.ready-requirement-before-test-generation', 'quality.requirement-story-test-traceability', 'quality.test-asserts-observable-outcome', 'quality.test-weakening-justified'])
  assert.ok(shipped.rules.every(r => r.status === 'draft' && r.summary))
  const builtinRoot = mkdtempSync(join(tmpdir(), 'qc-builtin-'))
  mkdirSync(join(builtinRoot, 'rules'))
  for (const id of ['quality.isolated-tests', 'quality.shared', 'quality.mine']) writeFileSync(join(builtinRoot, `rules/${id}.md`), RULE(id, 'status: draft\n'))
  const root = mkdtempSync(join(tmpdir(), 'qc-project-'))
  mkdirSync(join(root, 'rules'))
  writeFileSync(join(root, 'rules/mine.md'), RULE('quality.mine'))
  const config = { adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'http://hub', local: 'rules/' } }
  const r = await readRules({ side: 'backend', config, root, env: {}, fetchImpl: fetchOk, builtinRoot })
  assert.ok(r.rules.some(x => x.id === 'quality.isolated-tests'), 'the hub has it')
  assert.deepEqual(r.builtin.rules.map(x => x.id), ['quality.shared'], 'published on the hub or the project\'s own: not built in')
  assert.deepEqual(r.local.rules.map(x => x.id), ['quality.mine'])
  assert.equal(formatRules(r).split('\n')[1], "✅ Built-in rules: 1 backend testing rule, a draft")
  const down = await readRules({ side: 'backend', config: { adapter: 'vitest', backend: 'vitest', centralContext: { hub: 'off' } }, env: {}, builtinRoot })
  assert.equal(formatRules(down), '⚠️ Central Context is turned off in the config.\n✅ Built-in rules: 3 backend testing rules, all drafts')
})
