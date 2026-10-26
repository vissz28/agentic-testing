// A reporter for Node's own test runner (node --test --test-reporter=<this file>): writes one JSON
// object, { tests, broken }, with each test's describe path, so the generic runner reads node --test
// like any other runner. Suites are not tests. A file that does not load is reported by Node as a
// failed top-level "test" named after the file: it is a broken file, with the error it wrote.
export default async function * reporter(source) {
  const open = new Map()
  const stderr = new Map()
  const tests = []
  const broken = []
  for await (const { type, data } of source) {
    const file = data?.file ?? ''
    if (type === 'test:stderr') stderr.set(file, `${stderr.get(file) ?? ''}${data.message ?? ''}`)
    else if (type === 'test:start') {
      const names = open.get(file) ?? []
      names.length = data.nesting
      names.push(data.name)
      open.set(file, names)
    } else if ((type === 'test:pass' || type === 'test:fail') && data.details?.type !== 'suite') {
      const error = data.details?.error
      const message = String(error?.cause?.message ?? error?.message ?? '')
      if (type === 'test:fail' && data.nesting === 0 && (data.name === file || file.endsWith(`/${data.name}`))) {
        // Node names a file's stderr by the path it was given, and its failure by the absolute one.
        const written = [...stderr].find(([f]) => f === file || file.endsWith(`/${f}`))?.[1] ?? ''
        const why = /\b\w*Error\b[^\n]*/.exec(written)?.[0]
        broken.push({ file, message: why ?? message })
        continue
      }
      const status = type === 'test:fail' ? 'failed' : data.skip || data.todo ? 'skipped' : 'passed'
      tests.push({ file, title: data.name, path: (open.get(file) ?? []).slice(0, data.nesting), status, message: status === 'failed' ? message : '' })
    }
  }
  yield JSON.stringify({ tests, broken })
}
