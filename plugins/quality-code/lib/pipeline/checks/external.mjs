// Checks that live outside the unit tests: a pgTAP file for a seeded table, a contract test, a database test run by
// another tool. The config lists them (externalChecks, relative to the folder that holds the config). Quality Code does not
// run them. It reads them so a ticket's value that only they can check (a seeded code, a stored row) is not asked of a test
// that would restate a mock, and it says on the verdict which file carries it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { matches } from '../../base/boundary.mjs'
import { toForwardSlashes } from '../../core/text.mjs'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next'])
const MAX_FILES = 5000
const MAX_BYTES = 1_000_000

// The statements of a pgTAP file that assert (SELECT is(...), ok(...), results_eq(...), has_table(...)); the rest is setup.
const PGTAP = /\b(?:is|isnt|ok|is_empty|results_eq|results_ne|set_eq|bag_eq|row_eq|cmp_ok|throws_ok|lives_ok|matches|imatches|like|ilike|performs_ok|isa_ok|has_\w+|hasnt_\w+|col_\w+|fk_\w+|pk_\w+|is_\w+|policies_are|functions_are|tables_are)\s*\(/i

/** The code of a file without its comments (-- and /* *\/ for SQL, // and /* *\/ otherwise). */
export function stripComments(text, sql) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return sql ? noBlock.replace(/--[^\n]*/g, '') : noBlock.replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
}

/** What a file can assert: a .sql file keeps only the statements that call an assertion function. */
export function assertionText(file, text) {
  const sql = /\.sql$/i.test(file)
  const code = stripComments(text, sql)
  return sql ? code.split(';').filter(st => PGTAP.test(st)).join(';\n') : code
}

function* walk(dir, home, patterns, seen) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (seen.n > MAX_FILES) return
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(full, home, patterns, seen); continue }
    seen.n++
    const rel = toForwardSlashes(relative(home, full))
    if (patterns.some(p => matches(p, rel))) yield { file: rel, full }
  }
}

/** The external check files the config names: [{ file, text }], text being what the file asserts. */
export function externalChecks(home, patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return []
  const out = []
  for (const { file, full } of walk(home, home, patterns, { n: 0 })) {
    try {
      if (statSync(full).size > MAX_BYTES) continue
      out.push({ file, text: assertionText(file, readFileSync(full, 'utf8')) })
    } catch {}
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1))
}
