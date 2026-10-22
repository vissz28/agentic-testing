import { run } from '../../../lib/pipeline/checks/mutation.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'

const root = process.argv[2]
let calls = 0
const runTests = async ({ files }) => {
  calls++
  if (calls === 1) return { ran: true, tests: [{ title: 'adds', file: files[0], status: 'passed' }, { title: 'weak', file: files[0], status: 'passed' }] }
  return new Promise(done => setTimeout(() => done({ ran: true, tests: [] }), 60_000))
}
await run({ spec: 'test/a.spec.ts' }, { root, dialect: dialectFor('vitest'), runTests })
