// How a project already names and places its tests, read from the spec files it has. With "testFlow":
// "project" a writing run follows this (its naming, its folders); with "quality-code" it uses the
// plugin's own (the ticket key in the file name, the configured layers). Files are only listed, never run.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export const FLOWS = ['project', 'quality-code']

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'bin', 'obj', '.venv', 'venv', '__pycache__', '.quality-code', '.claude'])
// The marks a test file name carries, by language: foo.spec.ts, foo.test.js, foo.cy.ts, foo_test.go,
// test_foo.py, foo_test.py, FooTest.java, FooTests.cs.
const NAMES = [
  { re: /^(.+?)(?:\.(unit|int|integration|component|e2e|api))?\.(spec|test|cy)\.([cm]?[jt]sx?)$/, mark: m => ({ pattern: `${m[2] ? `.${m[2]}` : ''}.${m[3]}.${m[4]}`, style: 'suffix' }) },
  { re: /^(.+)_test\.go$/, mark: () => ({ pattern: '_test.go', style: 'suffix' }) },
  { re: /^test_(.+)\.py$/, mark: () => ({ pattern: 'test_*.py', style: 'prefix' }) },
  { re: /^(.+)_test\.py$/, mark: () => ({ pattern: '*_test.py', style: 'suffix' }) },
  { re: /^(.+?)(Tests?|IT)\.(java|kt)$/, mark: m => ({ pattern: `${m[2]}.${m[3]}`, style: 'suffix' }) },
  { re: /^(.+?)(Tests?)\.(cs|fs)$/, mark: m => ({ pattern: `${m[2]}.${m[3]}`, style: 'suffix' }) },
]

/** { pattern, style } when `name` is a test file name, else null. */
export function testNameOf(name) {
  for (const n of NAMES) { const m = n.re.exec(name); if (m) return n.mark(m) }
  return null
}

/**
 * What the project's own tests look like. → { specs, pattern, style, folders, beside, keyed }
 *   specs    how many test files were found (0: the project has no tests yet)
 *   pattern  the most common name pattern (".spec.ts", "_test.go", "test_*.py"), or null
 *   folders  the folders that hold them, most files first, at most 5 (first two path segments)
 *   beside   true when most of them sit next to the code (no test folder in their path)
 *   keyed    true when their names already carry a ticket key (ABC-123), so Quality Code's naming is theirs too
 */
export function detectConventions(root, budget = { n: 20000 }) {
  const byPattern = new Map()
  const byFolder = new Map()
  let specs = 0, beside = 0, keyed = 0
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 8) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1); continue }
      const t = testNameOf(e.name)
      if (!t) continue
      specs++
      byPattern.set(t.pattern, { ...t, n: (byPattern.get(t.pattern)?.n ?? 0) + 1 })
      const folder = rel ? `${rel.split('/').slice(0, 2).join('/')}/` : './'
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1)
      if (!/(^|\/)(tests?|__tests__|e2e|spec|specs)(\/|$)/i.test(rel)) beside++
      if (/\b[a-z][a-z0-9]*-\d+\b/i.test(e.name)) keyed++
    }
  }
  walk('', 0)
  const top = [...byPattern.values()].sort((a, b) => b.n - a.n)[0] ?? null
  return {
    specs,
    pattern: top?.pattern ?? null,
    style: top?.style ?? null,
    folders: [...byFolder].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([f]) => f),
    beside: specs > 0 && beside * 2 > specs,
    keyed: specs > 0 && keyed * 2 > specs,
  }
}

/** The flow in force: the config's testFlow, else the project's when it has tests, else Quality Code's. */
export const flowOf = (config, conventions) => (FLOWS.includes(config?.testFlow) ? config.testFlow : conventions.specs > 0 ? 'project' : 'quality-code')

/** The flow for one run: --flow wins over the config. */
export const runFlow = (config, conventions, flag) => (FLOWS.includes(flag) ? flag : flowOf(config, conventions))
