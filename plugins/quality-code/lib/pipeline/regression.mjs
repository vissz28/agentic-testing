// Regression tests for fixed bugs: the tag, the test name, and the fail-then-pass proof.
// A bug's test must fail before the fix and pass after it. The proof compares two verdicts of the
// same spec: the run without the fix (--regression-before) and this run.

export const REGRESSION_TAG = '@regression'

/** The test title for a bug: the ticket key in front, so the test is found from the ticket and back. */
export function regressionTitle(key, text) {
  const t = String(text ?? '').trim()
  return t.startsWith(`${key} `) || t.startsWith(`${key}:`) ? t : `${key} ${t}`.trim()
}

export const isBug = issuetype => /^bug$/i.test(String(issuetype ?? '').trim())

/** before: the verdict of the run without the fix ('red' | 'green'); verdict: this run's verdict. */
export function regressionProof(before, verdict) {
  if (before !== 'red' && before !== 'green') return null
  if (before === 'green') return { before, now: verdict, status: 'not_proof', text: 'No proof: the test already passed before the fix, so it does not reproduce the bug. Rewrite it so it fails without the fix.' }
  if (verdict === 'green') return { before, now: verdict, status: 'proved', text: 'Regression proof: failed before the fix, passes now. This test keeps the bug from coming back.' }
  if (verdict === 'tests_red') return { before, now: verdict, status: 'waiting', text: 'Regression proof pending: failed before the fix and still fails; the fix is not on this branch yet.' }
  return { before, now: verdict, status: 'unknown', text: 'Regression proof not decided: the checks did not reach a plain pass or fail.' }
}
