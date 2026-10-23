// .NET runner. A STUB: it runs nothing yet; the .NET pack replaces it. The contract, as
// vitest.mjs keeps it: dotnetRunner(root, config) returns ({ files, testName, timeoutMs }) =>
// { ran, tests: [{ title, path, file, status, message }], broken, error }.
const LABEL = '.NET'

export function dotnetRunner(root, config) {
  return async () => ({ ran: false, tests: [], broken: [], error: `${LABEL} support is not built yet` })
}
