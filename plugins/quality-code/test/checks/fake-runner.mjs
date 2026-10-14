// A runner for tests: decides each test's status from the spec file's current text.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** verdict(src, title) → 'passed' | 'failed' | 'skipped'. Records every call. */
export function fakeRunner(root, verdict, { ran = true, error } = {}) {
  const calls = []
  const runTests = async ({ files, testName, timeoutMs }) => {
    calls.push({ files, testName, timeoutMs })
    if (!ran) return { ran: false, tests: [], error }
    const src = readFileSync(resolve(root, files[0]), 'utf8')
    const titles = [...src.matchAll(/\b(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])(.*?)\1/g)].map(m => m[2])
    const picked = testName === undefined ? titles : titles.filter(t => t === testName)
    return { ran: true, tests: picked.map(title => ({ title, file: files[0], status: verdict(src, title) })) }
  }
  return { runTests, calls }
}
