#!/usr/bin/env node
// Frozen evals: the committed specs of a few tickets, checked against what they must keep saying, so
// a regenerated test or an edited guide that softens one shows up. node bin/evals.mjs [folder] [--json]
// A fixture is <folder>/<KEY>/expected.json, plus input.json with the frozen ticket (optional):
//   expected.json  { minSpecs?, spec?, specMustMatch?: [re], specMustNotMatch?: [re], mustContain?: [text],
//                    tests?: [{ key, mustContain?: [text] }], requirement?: KEY }   (the old backend and frontend shapes)
//                  with requirement and an xray block, each test's XRay case must link that ticket
//   input.json     { ticket: {…} | "<json>", candidates?: [value] }: the value check must pass on the specs
// Exit 0 every fixture holds, 1 one drifted, 2 usage or config error, 3 no fixture.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot, xrayOf } from '../lib/base/config.mjs'
import { dialectFor } from '../lib/base/dialects/index.mjs'
import { keyPattern } from '../lib/base/keys.mjs'
import * as expected from '../lib/pipeline/checks/expected.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { adapterOfSpec } from '../lib/base/stack.mjs'
import { readCases } from './xray.mjs'

export const EVALS_DIR = '.claude/quality-code/evals'
const read = p => JSON.parse(readFileSync(p, 'utf8'))
const list = v => (Array.isArray(v) ? v : [])

/** The problems of one fixture; none means it holds. */
export function checkFixture(root, config, dir, key) {
  const want = read(join(dir, 'expected.json'))
  const k = want.key ?? key
  const own = keyPattern(k)
  const specs = want.spec ? [want.spec].filter(p => existsSync(join(root, p)))
    : projectSpecs(root, config).map(s => s.path).filter(p => own.test(p.toUpperCase()) || own.test(readFileSync(join(root, p), 'utf8')))
  const problems = []
  if (want.spec && !specs.length) return [`the spec ${want.spec} is gone`]
  if (specs.length < (want.minSpecs ?? 1)) problems.push(`${specs.length} spec file(s) name ${k}, at least ${want.minSpecs ?? 1} expected`)
  const src = specs.map(p => readFileSync(join(root, p), 'utf8')).join('\n')
  for (const re of list(want.specMustMatch)) if (!new RegExp(re).test(src)) problems.push(`no spec matches /${re}/`)
  for (const re of list(want.specMustNotMatch)) if (new RegExp(re).test(src)) problems.push(`a spec matches /${re}/, which it must not`)
  for (const t of list(want.mustContain)) if (!src.includes(t)) problems.push(`the specs no longer say ${JSON.stringify(t)}`)
  for (const t of list(want.tests)) {
    if (t.key && !src.includes(t.key)) { problems.push(`test ${t.key} is gone`); continue }
    for (const s of list(t.mustContain)) if (!src.includes(s)) problems.push(`${t.key ?? 'a test'} no longer says ${JSON.stringify(s)}`)
  }
  const x = xrayOf(config)
  if (want.requirement && x) {
    const cases = readCases(root, x)
    for (const t of list(want.tests).filter(t => t.key)) {
      const hit = cases.find(c => c.key === t.key)
      if (!hit) problems.push(`${x.csv} has no XRay case for ${t.key}`)
      else if (hit.ticket !== want.requirement) problems.push(`${t.key}: its XRay case links ${hit.ticket || 'no ticket'}, not ${want.requirement}`)
    }
  }
  const input = existsSync(join(dir, 'input.json')) ? read(join(dir, 'input.json')) : null
  if (input?.ticket && specs.length) {
    const ticket = typeof input.ticket === 'string' ? JSON.parse(input.ticket) : input.ticket
    const ctx = { root, config, dialectOf: p => dialectFor(adapterOfSpec(config, root, p)) }
    const r = expected.run({ specs, key: k, ticket, candidates: list(input.candidates).map(String) }, ctx)
    if (r.status !== 'pass') problems.push(`expected values: ${r.summary}`)
  }
  return problems
}

export function runEvals(root, config, folder = EVALS_DIR) {
  const base = join(root, folder)
  let names = []
  try { names = readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(base, e.name, 'expected.json'))).map(e => e.name).sort() } catch {}
  return names.map(name => {
    try { return { key: name, problems: checkFixture(root, config, join(base, name), name) } } catch (e) { return { key: name, problems: [`unreadable fixture: ${String(e.message).split('\n')[0]}`] } }
  })
}

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const json = argv.includes('--json')
  const rest = argv.filter(a => a !== '--json')
  if (rest.length > 1 || rest.some(a => a.startsWith('-'))) { stderr('usage: evals.mjs [folder] [--json]\n'); return 2 }
  const root = projectRoot(env, cwd)
  const c = loadConfig(root)
  if (!c.ok) { stderr(`${c.errors.join('\n')}\n`); return 2 }
  const results = runEvals(root, c.config, rest[0] ?? EVALS_DIR)
  if (!results.length) { stdout(`No eval fixture in ${rest[0] ?? EVALS_DIR}/ (one <KEY>/expected.json per ticket).\n`); return 3 }
  const drift = results.filter(r => r.problems.length)
  if (json) stdout(`${JSON.stringify(results)}\n`)
  else {
    const lines = results.flatMap(r => (r.problems.length ? [`✗ ${r.key}`, ...r.problems.map(p => `    ${p}`)] : [`✓ ${r.key}`]))
    lines.push('', drift.length ? `EVAL DRIFT: ${drift.length} of ${results.length} fixture(s) failed. Do not ship the change that caused it.` : `evals ok (${results.length} fixture(s))`)
    stdout(`${lines.join('\n')}\n`)
  }
  return drift.length ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main()
