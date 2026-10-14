// One result shape for every check (spec §5.4), and the CLI exit codes (spec §6).
export const EXIT = Object.freeze({ pass: 0, fail: 1, not_run: 3 })

export function result(check, status, summary, findings = [], data = {}) {
  return { check, status, summary, findings, data }
}
