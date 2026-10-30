// The local mock-data loader: it writes only to a database on this computer, and only files that keep to the tenant.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from '../../bin/seed.mjs'
import { isLocal, parseTarget, sqlProblems } from '../../lib/base/seed.mjs'

const T = { column: 'tenant_id', id: 't-1' }
const node = s => `node -e ${JSON.stringify(s)}`
// apply copies the file to loaded.sql, so a test sees what reached the "database".
const APPLY = `${node("require('fs').appendFileSync('loaded.sql', require('fs').readFileSync(process.argv[1]))")} {file}`
function project(seed, files = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-seed-'))
  const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, seed }
  for (const [p, s] of Object.entries({ '.claude/quality-code.json': JSON.stringify(cfg), ...files })) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return d
}
function run(argv, d, env = {}) {
  let out = '', err = ''
  const code = main(argv, { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: d, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-seed-cfg-')), ...env }, d, { stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}
const echo = line => node(`console.log(${JSON.stringify(line)})`)
const GOOD = "BEGIN;\nDELETE FROM orders WHERE tenant_id = 't-1';\nINSERT INTO orders VALUES ('mock-1', 't-1');\nCOMMIT;\n"

test('the target: host[:port]/database or a URL, with the password never kept', () => {
  assert.deepEqual(parseTarget('localhost:5433/app'), { host: 'localhost', port: '5433', database: 'app', shown: 'localhost:5433/app' })
  assert.equal(parseTarget('postgres/app').shown, 'postgres/app')
  const u = parseTarget('postgresql://admin:s3cret@db.example.com:5432/app?schema=public')
  assert.equal(u.shown, 'db.example.com:5432/app')
  assert.doesNotMatch(JSON.stringify(u), /s3cret|admin/)
  assert.equal(parseTarget('[::1]:5432/app').shown, '[::1]:5432/app')
  for (const bad of ['', '   ', 'two words', null, '://']) assert.equal(parseTarget(bad), null, JSON.stringify(bad))
})
test('local: localhost, 127.x, ::1 and a one-word container name; nothing with a dot or another address', () => {
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', 'postgres', 'db_1', 'my-db']) assert.ok(isLocal(h), h)
  for (const h of ['db.example.com', '10.0.0.5', '192.168.1.20', 'host.docker.internal', '8.8.8.8', '2130706433', '']) assert.ok(!isLocal(h), h)
})
test('the SQL check: no schema changes; with a tenant every delete and update keeps to it', () => {
  assert.deepEqual(sqlProblems(GOOD, T), [])
  assert.deepEqual(sqlProblems('CREATE TEMP TABLE s (n int) ON COMMIT DROP; INSERT INTO x SELECT 1 ON CONFLICT (id) DO UPDATE SET n = 1;', T), [], 'a temp table and an upsert are fine')
  for (const s of ['TRUNCATE orders;', 'DROP TABLE orders;', 'ALTER TABLE orders ADD c int;', 'drop schema public cascade;']) assert.equal(sqlProblems(s).length, 1, s)
  assert.deepEqual(sqlProblems('-- DROP TABLE x\nSELECT 1;'), [], 'a comment is not a statement')
  assert.deepEqual(sqlProblems("DELETE FROM orders;\nUPDATE orders SET n = 1 WHERE tenant_id = 't-2';", T), [
    `"DELETE FROM orders …" does not keep to tenant_id = 't-1'`,
    `"UPDATE orders SET …" does not keep to tenant_id = 't-1'`,
  ])
  assert.deepEqual(sqlProblems('DELETE FROM orders;'), [], 'with no tenant, the whole local table is emptied')
})

test('no target or apply: a config line with an example, exit 2', () => {
  const r = run(['target'], project({}))
  assert.equal(r.code, 2)
  assert.match(r.err, /needs "seed\.target" and "seed\.apply"/)
  assert.equal(run(['nope'], project({})).code, 2)
  assert.equal(run(['load'], project({})).code, 2, 'load needs a file')
})
test('target: a local database passes and is shown; a remote one is refused without its password', () => {
  const ok = run(['target'], project({ target: echo('localhost:5433/app'), apply: APPLY }))
  assert.equal(ok.code, 0, ok.err)
  assert.equal(ok.out, 'target: localhost:5433/app\n')
  const far = run(['target'], project({ target: echo('postgresql://u:s3cret@db.example.com/app'), apply: APPLY }))
  assert.equal(far.code, 1)
  assert.match(far.out, /^refused: db\.example\.com\/app is not a local database/)
  assert.doesNotMatch(far.out, /s3cret/)
  const junk = run(['target'], project({ target: echo('pw=s3cret and more'), apply: APPLY }))
  assert.equal(junk.code, 1)
  assert.doesNotMatch(junk.out, /s3cret/, 'an unreadable line is never echoed')
  const failed = run(['target'], project({ target: node('process.exit(3)'), apply: APPLY }))
  assert.equal(failed.code, 1)
  assert.match(failed.out, /^refused: seed\.target failed \(exit 3\)/)
})
test('load: checks every file first, then applies them in order', () => {
  const d = project({ target: echo('postgres/app'), apply: APPLY, tenant: T }, { 'a.sql': GOOD, 'b.sql': "INSERT INTO orders VALUES ('mock-2', 't-1');\n" })
  const r = run(['load', 'a.sql', 'b.sql'], d)
  assert.equal(r.code, 0, r.out + r.err)
  assert.equal(r.out, 'target: postgres/app\nloaded: a.sql\nloaded: b.sql\n')
  assert.equal(readFileSync(join(d, 'loaded.sql'), 'utf8'), GOOD + "INSERT INTO orders VALUES ('mock-2', 't-1');\n")
})
test('load: one bad file and nothing reaches the database', () => {
  const d = project({ target: echo('postgres/app'), apply: APPLY, tenant: T }, { 'a.sql': GOOD, 'b.sql': 'DELETE FROM orders;\n' })
  const r = run(['load', 'a.sql', 'b.sql'], d)
  assert.equal(r.code, 1)
  assert.match(r.out, /refused: b\.sql: "DELETE FROM orders …" does not keep to tenant_id = 't-1'\. Nothing was loaded\./)
  assert.ok(!existsSync(join(d, 'loaded.sql')))
  assert.match(run(['load', 'missing.sql'], d).out, /refused: missing\.sql does not exist/)
})
test('load: a remote target or CI writes nothing', () => {
  const far = project({ target: echo('db.example.com:5432/app'), apply: APPLY }, { 'a.sql': GOOD })
  assert.equal(run(['load', 'a.sql'], far).code, 1)
  assert.ok(!existsSync(join(far, 'loaded.sql')))
  const local = project({ target: echo('localhost/app'), apply: APPLY }, { 'a.sql': GOOD })
  const ci = run(['load', 'a.sql'], local, { CI: '1' })
  assert.equal(ci.code, 1)
  assert.match(ci.out, /never in CI/)
  assert.ok(!existsSync(join(local, 'loaded.sql')))
})
test('load: a failed apply says which file and stops there', () => {
  const d = project({ target: echo('localhost/app'), apply: `${node("console.error('relation \"orders\" does not exist'); process.exit(3)")} {file}` }, { 'a.sql': GOOD, 'b.sql': GOOD })
  const r = run(['load', 'a.sql', 'b.sql'], d)
  assert.equal(r.code, 1)
  assert.match(r.err, /relation "orders" does not exist/)
  assert.match(r.out, /failed: seed\.apply exited 3 on a\.sql\.\n$/)
  assert.doesNotMatch(r.out, /b\.sql/)
})
test('load: a file path with a space or a quote reaches apply as one argument', () => {
  const d = project({ target: echo('localhost/app'), apply: APPLY }, { "my dir/it's.sql": GOOD })
  const r = run(['load', "my dir/it's.sql"], d)
  assert.equal(r.code, 0, r.out + r.err)
  assert.equal(readFileSync(join(d, 'loaded.sql'), 'utf8'), GOOD)
})
