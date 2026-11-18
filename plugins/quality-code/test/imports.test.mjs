// The import rule of the architecture plan: a file imports only from its own folder or the folders below it,
// nothing imports bin/, and there are no import cycles. Today's exceptions are listed by name: a new one fails,
// and a fixed one must leave the list, so it only shrinks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// Lowest first. lib/base keeps clean, containers, routes, rules, seed and workspaces, which use most of the others.
const ORDER = ['core', 'config', 'state', 'stacks', 'ticket', 'pipeline', 'report', 'transcript', 'ci', 'base', 'bin']

// Known on 16 November. Fixing one means taking it out of here.
const KNOWN_UP = [
  'lib/config/config.mjs -> lib/ci/ci-source.mjs',
  'lib/config/config.mjs -> lib/pipeline/boundary.mjs',
  'lib/config/config.mjs -> lib/stacks/backends.mjs',
  'lib/config/config.mjs -> lib/stacks/runners.mjs',
  'lib/config/config.mjs -> lib/stacks/conventions.mjs',
  'lib/config/set.mjs -> lib/base/setup.mjs',
  'lib/config/set.mjs -> lib/stacks/conventions.mjs',
  'lib/config/set.mjs -> lib/stacks/runners.mjs',
  'lib/pipeline/card.mjs -> lib/base/rules.mjs',
  'lib/stacks/e2e-folder.mjs -> lib/pipeline/boundary.mjs',
  'lib/stacks/stack.mjs -> lib/pipeline/runners/playwright.mjs',
  'lib/stacks/stack.mjs -> lib/pipeline/boundary.mjs',
]
const KNOWN_BIN = [
  'bin/ci.mjs -> bin/branch.mjs',
  'bin/ci.mjs -> bin/checks.mjs',
  'bin/ci.mjs -> bin/evals.mjs',
  'bin/evals.mjs -> bin/xray.mjs',
  'bin/routine.mjs -> bin/ci.mjs',
  'bin/xray-api.mjs -> bin/mcp-launch.mjs',
  'bin/xray-api.mjs -> bin/connector-settings.mjs',
]
const KNOWN_CYCLES = ['lib/config/config.mjs, lib/config/places.mjs']

const walk = d => readdirSync(join(ROOT, d)).flatMap(n => (statSync(join(ROOT, d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.mjs') ? [join(d, n)] : []))
const FILES = [...walk('lib'), ...walk('bin')].map(f => f.split('\\').join('/'))
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]/gm

/** Every relative import: { from, to }, paths from the plugin folder. */
export function importsOf(files = FILES) {
  return files.flatMap(from => [...readFileSync(join(ROOT, from), 'utf8').matchAll(IMPORT)]
    .map(m => ({ from, to: relative(ROOT, resolve(ROOT, dirname(from), m[1] ?? m[2])).split('\\').join('/') })))
}
const layerOf = f => (f.startsWith('bin/') ? 'bin' : f.split('/')[1])
const line = e => `${e.from} -> ${e.to}`

/** Strongly connected groups of more than one file (Tarjan), each sorted. */
export function cyclesOf(edges) {
  const next = new Map()
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  let n = 0
  const index = new Map(), low = new Map(), stack = [], on = new Set(), out = []
  const visit = v => {
    index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v)
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
    }
    if (low.get(v) !== index.get(v)) return
    const group = []
    let w
    do { w = stack.pop(); on.delete(w); group.push(w) } while (w !== v)
    if (group.length > 1) out.push(group.sort().join(', '))
  }
  for (const v of next.keys()) if (!index.has(v)) visit(v)
  return out.sort()
}

/** What changed against a known list: the new entries and the ones that are gone. */
const against = (now, known) => ({ added: now.filter(x => !known.includes(x)), gone: known.filter(x => !now.includes(x)) })

test('every lib folder has a place in the layer order', () => {
  const folders = [...new Set(FILES.map(layerOf))]
  assert.deepEqual(folders.filter(f => !ORDER.includes(f)), [], 'a new lib folder: add it to ORDER in test/imports.test.mjs, below what it imports')
})

test('a file imports only from its own folder or the ones below it', () => {
  const up = importsOf().filter(e => ORDER.indexOf(layerOf(e.to)) > ORDER.indexOf(layerOf(e.from)) && layerOf(e.from) !== 'bin').map(line)
  const { added, gone } = against(up, KNOWN_UP)
  assert.deepEqual(added, [], 'a new import against the layer order: import from a folder below, or move the shared code down')
  assert.deepEqual(gone, [], 'fixed: take it out of KNOWN_UP')
})

test('nothing imports a script in bin/', () => {
  const toBin = importsOf().filter(e => e.to.startsWith('bin/') && e.from.startsWith('bin/')).map(line)
  const { added, gone } = against(toBin, KNOWN_BIN)
  assert.deepEqual(added, [], 'a script imported by another: move what it needs into lib/')
  assert.deepEqual(gone, [], 'fixed: take it out of KNOWN_BIN')
})

test('no import cycles', () => {
  const { added, gone } = against(cyclesOf(importsOf()), KNOWN_CYCLES)
  assert.deepEqual(added, [], 'a new import cycle: one of these files must stop importing the other')
  assert.deepEqual(gone, [], 'fixed: take it out of KNOWN_CYCLES')
})

test('the checks themselves: a wrong-way import, an import of bin/ and a cycle are found', () => {
  const edges = [{ from: 'lib/core/a.mjs', to: 'lib/config/b.mjs' }, { from: 'lib/config/b.mjs', to: 'lib/core/a.mjs' }]
  assert.deepEqual(cyclesOf(edges), ['lib/config/b.mjs, lib/core/a.mjs'])
  assert.ok(ORDER.indexOf(layerOf('lib/config/b.mjs')) > ORDER.indexOf(layerOf('lib/core/a.mjs')))
  assert.deepEqual(cyclesOf([{ from: 'bin/x.mjs', to: 'lib/core/a.mjs' }]), [])
})
