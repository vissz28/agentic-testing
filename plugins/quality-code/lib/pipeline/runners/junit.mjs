// JUnit runner. A STUB: it runs nothing yet; the JUnit pack replaces it. The contract, as
// vitest.mjs keeps it: junitRunner(root, config) returns ({ files, testName, timeoutMs }) =>
// { ran, tests: [{ title, path, file, status, message }], broken, error }.
const LABEL = 'JUnit'

export function junitRunner(root, config) {
  return async () => ({ ran: false, tests: [], broken: [], error: `${LABEL} support is not built yet` })
}
