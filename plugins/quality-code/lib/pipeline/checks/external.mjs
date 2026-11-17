// externalChecks (pgTAP, contract, DB tests): never run, only read, so a value only they can check
// isn't demanded from a unit test that would just restate a mock.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { matches } from '../boundary.mjs'
import { stripCodeComments, toForwardSlashes } from '../../core/text.mjs'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next'])
const MAX_FILES = 5000
const MAX_BYTES = 1_000_000

// pgTAP assertion functions; other statements are setup.
const PGTAP = /\b(?:is|isnt|ok|is_empty|results_eq|results_ne|set_eq|bag_eq|row_eq|cmp_ok|throws_ok|lives_ok|matches|imatches|like|ilike|performs_ok|isa_ok|has_\w+|hasnt_\w+|col_\w+|fk_\w+|pk_\w+|is_\w+|policies_are|functions_are|tables_are)\s*\(/i

export function stripComments(text, sql) {
  return sql ? text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '') : stripCodeComments(text)
}

/** For .sql, keep only statements that call a pgTAP assertion. */
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
