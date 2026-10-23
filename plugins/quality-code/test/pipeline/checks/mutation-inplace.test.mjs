// Mutation in place (compiled languages): the spec itself takes each mutant and always gets its bytes back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../../../lib/pipeline/checks/mutation.mjs'
import { FAKE, SRC } from './inplace-dialect.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
function spec() {
  const d = mkdtempSync(join(tmpdir(), 'qc-inplace-'))
  mkdirSync(join(d, 'pkg'), { recursive: true })
  writeFileSync(join(d, 'pkg/total_test.fake'), SRC)
  return d
}
const bytes = d => readFileSync(join(d, 'pkg/total_test.fake'))

test('in place: each mutant runs from the spec\'s own path and the spec is byte-identical afterwards', async () => {
  const d = spec()
  const seen = []
  const runTests = async ({ files, testName }) => {
    const now = readFileSync(join(d, files[0]), 'utf8')
    seen.push({ files, testName, mutated: now !== SRC })
    // The mutant is killed when the spec no longer reads as the original.
    const status = testName && now !== SRC ? 'failed' : 'passed'
    return { ran: true, tests: ['total', 'count'].filter(t => !testName || t === testName).map(title => ({ title, file: files[0], status })) }
  }
  const r = await run({ spec: 'pkg/total_test.fake' }, { root: d, dialect: FAKE, runTests })
  assert.equal(r.status, 'pass', r.summary)
  assert.deepEqual(r.data.total, 2)
  assert.deepEqual(seen.slice(1).map(s => s.files), [['pkg/total_test.fake'], ['pkg/total_test.fake']])
  assert.ok(seen.slice(1).every(s => s.mutated), 'the spec itself held the mutant while it ran')
  assert.ok(bytes(d).equals(Buffer.from(SRC)))
  assert.deepEqual(readdirSync(join(d, 'pkg')), ['total_test.fake'], 'no temp copy beside it')
})

test('in place: a survivor is still a fail, and the spec comes back', async () => {
  const d = spec()
  const runTests = async ({ files, testName }) => ({ ran: true, tests: ['total', 'count'].filter(t => !testName || t === testName).map(title => ({ title, file: files[0], status: 'passed' })) })
  const r = await run({ spec: 'pkg/total_test.fake' }, { root: d, dialect: FAKE, runTests })
  assert.equal(r.status, 'fail')
  assert.ok(bytes(d).equals(Buffer.from(SRC)))
})

test('in place: the spec comes back when the runner throws mid-run', async () => {
  const d = spec()
  let calls = 0
  const runTests = async ({ files }) => {
    calls++
    if (calls === 1) return { ran: true, tests: [{ title: 'total', file: files[0], status: 'passed' }, { title: 'count', file: files[0], status: 'passed' }] }
    assert.notEqual(readFileSync(join(d, files[0]), 'utf8'), SRC)
    throw new Error('the compiler crashed')
  }
  await assert.rejects(run({ spec: 'pkg/total_test.fake' }, { root: d, dialect: FAKE, runTests }), /the compiler crashed/)
  assert.ok(bytes(d).equals(Buffer.from(SRC)))
})

test('in place: SIGINT mid-run puts the original bytes back', async () => {
  const d = spec()
  const child = spawn(process.execPath, [join(HERE, 'mutation-inplace.fixture.mjs'), d], { stdio: 'ignore' })
  const mutated = await new Promise(done => {
    const t0 = Date.now()
    const tick = setInterval(() => {
      const m = !bytes(d).equals(Buffer.from(SRC))
      if (m || Date.now() - t0 > 5000) { clearInterval(tick); done(m) }
    }, 20)
  })
  assert.ok(mutated, 'the fixture wrote a mutant into the spec')
  child.kill('SIGINT')
  const code = await new Promise(done => child.on('exit', done))
  assert.equal(code, 130)
  assert.ok(bytes(d).equals(Buffer.from(SRC)))
  assert.deepEqual(readdirSync(join(d, 'pkg')), ['total_test.fake'])
})
