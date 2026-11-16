// Bug regression tests: proof is the same spec failing before the fix and passing after.

export const REGRESSION_TAG = '@regression'

/** Key first, so the test and the ticket can be found from each other. */
export function regressionTitle(key, text) {
  const t = String(text ?? '').trim()
  return t.startsWith(`${key} `) || t.startsWith(`${key}:`) ? t : `${key} ${t}`.trim()
}

export const isBug = issuetype => /^bug$/i.test(String(issuetype ?? '').trim())

/** before: verdict of the run without the fix (--regression-before). */
export function regressionProof(before, verdict) {
  if (before !== 'red' && before !== 'green') return null
  if (before === 'green') return { before, now: verdict, status: 'not_proof', text: 'No proof: the test already passed before the fix, so it does not reproduce the bug. Rewrite it so it fails without the fix.' }
  if (verdict === 'green') return { before, now: verdict, status: 'proved', text: 'Regression proof: failed before the fix, passes now. This test keeps the bug from coming back.' }
  if (verdict === 'tests_red') return { before, now: verdict, status: 'waiting', text: 'Regression proof pending: failed before the fix and still fails; the fix is not on this branch yet.' }
  return { before, now: verdict, status: 'unknown', text: 'Regression proof not decided: the checks did not reach a plain pass or fail.' }
}
