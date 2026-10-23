// Go runner. A STUB: it runs nothing yet; the Go pack replaces it. The contract, as
// vitest.mjs keeps it: goRunner(root, config) returns ({ files, testName, timeoutMs }) =>
// { ran, tests: [{ title, path, file, status, message }], broken, error }.
const LABEL = 'Go'

export function goRunner(root, config) {
  return async () => ({ ran: false, tests: [], broken: [], error: `${LABEL} support is not built yet` })
}
