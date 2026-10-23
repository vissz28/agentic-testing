// pytest runner. A STUB: it runs nothing yet; the pytest pack replaces it. The contract, as
// vitest.mjs keeps it: pytestRunner(root, config) returns ({ files, testName, timeoutMs }) =>
// { ran, tests: [{ title, path, file, status, message }], broken, error }.
const LABEL = 'pytest'

export function pytestRunner(root, config) {
  return async () => ({ ran: false, tests: [], broken: [], error: `${LABEL} support is not built yet` })
}
