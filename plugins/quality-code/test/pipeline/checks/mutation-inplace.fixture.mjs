// Runs an in-place mutation whose mutant run never ends, for the SIGINT test to interrupt.
import { run } from '../../../lib/pipeline/checks/mutation.mjs'
import { FAKE } from './inplace-dialect.mjs'

const root = process.argv[2]
let calls = 0
const runTests = async ({ files }) => {
  calls++
  if (calls === 1) return { ran: true, tests: [{ title: 'total', file: files[0], status: 'passed' }, { title: 'count', file: files[0], status: 'passed' }] }
  return new Promise(done => setTimeout(() => done({ ran: true, tests: [] }), 60_000))
}
await run({ spec: 'pkg/total_test.fake' }, { root, dialect: FAKE, runTests })
