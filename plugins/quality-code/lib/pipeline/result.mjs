// Result shape shared by every check, and the CLI exit codes.
export const EXIT = Object.freeze({ pass: 0, fail: 1, not_run: 3 })

export function result(check, status, summary, findings = [], data = {}) {
  return { check, status, summary, findings, data }
}
