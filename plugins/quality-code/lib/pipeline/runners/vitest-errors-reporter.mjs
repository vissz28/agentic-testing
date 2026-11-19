// Vitest reporter: the run's unhandled errors (an assertion in a promise not awaited), which the JSON report leaves out.
// Always writes the file, [] when there were none, so a missing file means this reporter never ran.
import { writeFileSync } from 'node:fs'
import { firstLine } from '../../core/text.mjs'

export const ERRORS_ENV = 'QC_VITEST_ERRORS'

export default class VitestErrorsReporter {
  write(errors) {
    const file = process.env[ERRORS_ENV]
    if (!file) return
    const list = (errors ?? []).map(e => ({ name: String(e?.name ?? 'Error'), message: firstLine(String(e?.message ?? e ?? '')) }))
    try { writeFileSync(file, JSON.stringify(list)) } catch {}
  }

  // Vitest 3 and later.
  onTestRunEnd(_modules, unhandledErrors) { this.write(unhandledErrors) }

  // Vitest 1 and 2 (3 calls it too, with the same errors).
  onFinished(_files, errors) { this.write(errors) }
}
