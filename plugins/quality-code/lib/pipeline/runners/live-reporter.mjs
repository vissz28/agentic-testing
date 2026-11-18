// Test reporters for Vitest (3 and later) and Playwright: each finished test is counted into the live progress file.
import { LIVE_ENV, updateLive } from '../live.mjs'

const WRITE_MS = 150

/** Counts and throttled writes, shared by both reporters. */
export class LiveCounter {
  constructor(file = process.env[LIVE_ENV], write = updateLive) {
    this.file = file
    this.write = write
    this.total = 0
    this.seen = new Set()
    this.counts = { passed: 0, failed: 0, skipped: 0 }
    // Vitest finds tests file by file, so its % goes by files; null where the total is known up front.
    this.files = null
    this.last = 0
    this.timer = null
  }

  add(n) { this.total += n; this.flush() }

  fileTotal(n) { this.files = { done: 0, total: n }; this.flush() }

  fileDone() { if (this.files) this.files.done++; this.flush() }

  done(id, status) {
    if (this.seen.has(id)) return
    this.seen.add(id)
    this.counts[status === 'passed' ? 'passed' : status === 'skipped' || status === 'pending' ? 'skipped' : 'failed']++
    this.flush()
  }

  flush(now = Date.now(), force = false) {
    if (!this.file) return
    if (!force && now - this.last < WRITE_MS) {
      this.timer ??= setTimeout(() => { this.timer = null; this.flush(Date.now(), true) }, WRITE_MS)
      return
    }
    clearTimeout(this.timer)
    this.timer = null
    this.last = now
    const tests = { total: Math.max(this.total, this.seen.size), done: this.seen.size, ...this.counts, ...(this.files ? { files: { ...this.files } } : {}) }
    this.write(this.file, s => ({ ...s, tests }))
  }
}

/** Vitest: --reporter=<this file>. Older Vitest lacks these hooks and simply shows no counts. */
export default class VitestLiveReporter {
  constructor() { this.c = new LiveCounter() }
  onTestRunStart(specifications) { this.c.fileTotal(specifications.length) }
  onTestModuleCollected(mod) { this.c.add([...mod.children.allTests()].length) }
  onTestModuleEnd() { this.c.fileDone() }
  onTestCaseResult(test) { this.c.done(test.id, test.result().state) }
  onTestRunEnd() { this.c.flush(Date.now(), true) }
}

/** Playwright: --reporter=json,<playwright-live-reporter.mjs>. */
export class PlaywrightLiveReporter {
  constructor() { this.c = new LiveCounter() }
  printsToStdio() { return false }
  onBegin(_config, suite) { this.c.add(suite.allTests().length) }
  onTestEnd(test, result) { this.c.done(test.id, result.status) }
  onEnd() { this.c.flush(Date.now(), true) }
}
