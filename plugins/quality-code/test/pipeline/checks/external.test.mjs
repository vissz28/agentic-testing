import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assertionText, externalChecks } from '../../../lib/pipeline/checks/external.mjs'
import { run } from '../../../lib/pipeline/checks/expected.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { validateConfig } from '../../../lib/base/config.mjs'

const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const PGTAP = `-- seeds checked here
BEGIN;
SELECT plan(3);
INSERT INTO t VALUES ('9000');
SELECT is((SELECT count(*) FROM sts_public.outcome_code_catalogue), 158::bigint, 'one row per code');
SELECT ok(EXISTS (SELECT 1 FROM sts_public.outcome_code_catalogue WHERE code = '110'), 'code 110 exists');
/* SELECT is(1, 999, 'commented') */
SELECT finish();
ROLLBACK;
`

test('a pgTAP file: only its assertions count, not its setup or its comments', () => {
  const t = assertionText('x.test.sql', PGTAP)
  assert.match(t, /158/)
  assert.match(t, /110/)
  assert.doesNotMatch(t, /9000/, 'an INSERT is setup, not an assertion')
  assert.doesNotMatch(t, /999/, 'a commented assertion asserts nothing')
})

test('externalChecks finds the files by glob, relative to the config folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'qc-ext-'))
  put(home, 'hasura-migrations/tests/default/a.test.sql', PGTAP)
  put(home, 'hasura-migrations/tests/default/readme.md', '158')
  put(home, 'node_modules/x/b.test.sql', PGTAP)
  const found = externalChecks(home, ['hasura-migrations/tests/**/*.test.sql'])
  assert.deepEqual(found.map(f => f.file), ['hasura-migrations/tests/default/a.test.sql'])
  assert.deepEqual(externalChecks(home, []), [])
})

test('config: externalChecks is a list of project paths', () => {
  const base = { version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'] } }
  assert.equal(validateConfig({ ...base, externalChecks: ['hasura-migrations/tests/**/*.sql'] }).ok, true)
  assert.match(validateConfig({ ...base, externalChecks: [] }).errors.join(), /non-empty list/)
  assert.match(validateConfig({ ...base, externalChecks: ['../x.sql'] }).errors.join(), /externalChecks\[0\]/)
})

test('expected: a seeded value passes when the unit test cannot check it and a listed pgTAP file does; the verdict names the file', () => {
  const home = mkdtempSync(join(tmpdir(), 'qc-ext-run-'))
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude/quality-code.json'), JSON.stringify({ root: 'svc' }))
  put(home, 'svc/src/a.unit.test.js', "describe('ABC-7 catalogue', () => {\n  it('maps an unknown code', () => {\n    expect(lookup('ZZZ').severity).toBe('BLOCKING')\n  })\n})\n")
  put(home, 'db/tests/a.test.sql', PGTAP)
  const ticket = { key: 'ABC-7', summary: 'Catalogue', text: { description: '## Acceptance criteria\nGiven the table\nThen it holds 158 rows, code "110" is there, and an unknown code is "BLOCKING"\n', acField: '' } }
  const ctx = (config) => ({ root: join(home, 'svc'), dialect: dialectFor('vitest'), config })
  const without = run({ specs: ['src/a.unit.test.js'], key: 'ABC-7', ticket }, ctx({}))
  assert.equal(without.status, 'fail')
  assert.deepEqual(without.data.missing.sort(), ['110', '158'])
  const withExt = run({ specs: ['src/a.unit.test.js'], key: 'ABC-7', ticket }, ctx({ externalChecks: ['db/tests/*.test.sql'] }))
  assert.equal(withExt.status, 'pass', JSON.stringify(withExt))
  assert.match(withExt.summary, /2 checked in db\/tests\/a\.test\.sql, outside the unit tests: read, not run by Quality Code/)
  assert.deepEqual(withExt.data.outsideFiles, ['db/tests/a.test.sql'])
})
