// Where a new test for a source file belongs: the file that already tests that unit, the project's
// central test file or class, or nowhere yet (a new file in the project's own folder and naming).
// Files are only listed and read, never run.
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { detectConventions, testNameOf } from './conventions.mjs'
import { toForwardSlashes } from '../core/text.mjs'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'bin', 'obj', '.venv', 'venv', '__pycache__', '.quality-code', '.claude'])
const TESTS = /\b(?:it|test)(?:\.each)?\s*\(|@(?:Test|ParameterizedTest)\b|\bdef test_|\bfunc Test|\[(?:Fact|Theory)\]/g
const MAX_BYTES = 400_000

/** The unit a test file name is about: pricing.spec.ts -> pricing, FooServiceTest.java -> FooService. */
export function unitOfTest(name) {
  if (!testNameOf(name)) return null
  return name
    .replace(/\.(unit|int|integration|component|e2e|api)\.(spec|test|cy)\.[cm]?[jt]sx?$/, '')
    .replace(/\.(spec|test|cy)\.[cm]?[jt]sx?$/, '')
    .replace(/_test\.(go|py)$/, '')
    .replace(/^test_(.+)\.py$/, '$1')
    .replace(/(Tests?|IT)\.(java|kt|cs|fs)$/, '')
}

const moduleOf = rel => { const i = rel.indexOf('/src/'); return i === -1 ? '' : rel.slice(0, i) }

function listTests(root, budget = { n: 20000 }) {
  const found = []
  const walk = (rel, depth) => {
    let entries = []
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (--budget.n < 0) return
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 10) walk(path, depth + 1); continue }
      if (testNameOf(e.name)) found.push(path)
    }
  }
  walk('', 0)
  return found
}

/**
 * → { kind: 'unit-file' | 'central' | 'none', file, reason }
 *   unit-file  a test file for that same unit exists (same basename + the project's test mark)
 *   central    the project keeps its tests in one or very few big files or classes
 *   none       neither: a new file in the project's own folder and naming
 */
export function findTestHome(root, target, conv = detectConventions(root)) {
  const none = reason => ({ kind: 'none', file: null, reason })
  if (!conv.specs) return none('the project has no tests yet')
  const targetRel = toForwardSlashes(target).replace(/^\.\//, '')
  const unit = basename(targetRel, extname(targetRel))
  const files = listTests(root)
  const sameUnit = files.filter(f => unitOfTest(basename(f)) === unit)
  const mod = moduleOf(targetRel)
  if (sameUnit.length) {
    // the one nearest the code: same module first, then the shortest path
    sameUnit.sort((a, b) => (moduleOf(b) === mod) - (moduleOf(a) === mod) || a.length - b.length || a.localeCompare(b))
    return { kind: 'unit-file', file: sameUnit[0], reason: `${sameUnit[0]} already tests ${unit}` }
  }
  const info = files.map(f => {
    let text = ''
    try { text = readFileSync(join(root, f), 'utf8').slice(0, MAX_BYTES) } catch { /* unreadable: counts as empty */ }
    return { f, n: (text.match(TESTS) ?? []).length, mentions: new RegExp(`\\b${unit.replace(/[^\w]/g, '\\$&')}\\b`).test(text) }
  })
  const best = list => [...list].sort((a, b) => b.mentions - a.mentions || b.n - a.n || a.f.localeCompare(b.f))[0]
  // one or two test files in the target's module: that is where its tests live
  const inModule = info.filter(i => moduleOf(i.f) === mod)
  if (inModule.length && inModule.length <= 2 && (mod || info.length <= 2)) {
    const h = best(inModule)
    return { kind: 'central', file: h.f, reason: `${mod || 'the project'} keeps its tests in ${inModule.length === 1 ? 'one file' : 'two files'}${h.mentions ? `, and ${h.f} already mentions ${unit}` : ''}` }
  }
  // one file holds most of the tests of a project with several
  const total = info.reduce((s, i) => s + i.n, 0)
  const top = [...info].sort((a, b) => b.n - a.n || a.f.localeCompare(b.f))[0]
  if (info.length >= 2 && total >= 6 && top.n * 2 >= total) return { kind: 'central', file: top.f, reason: `${top.f} holds ${top.n} of the project's ${total} tests` }
  return none(`no test file for ${unit}, and the project keeps its tests per unit`)
}
