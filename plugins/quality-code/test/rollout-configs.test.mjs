import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { validateConfig, layersOf } from '../core/config.mjs'

const DIR = new URL('../../../docs/rollout/', import.meta.url)
const load = f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))

test('every rollout config passes validation', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
  assert.ok(files.length >= 2)
  for (const f of files) {
    const r = validateConfig(load(f))
    assert.equal(r.ok, true, `${f}: ${r.errors?.join(' | ')}`)
  }
})

test('the backend config keeps the old harness layers and Vitest configs', () => {
  const c = validateConfig(load('warehouse-backend.quality-code.json')).config
  assert.equal(c.adapter, 'vitest')
  assert.deepEqual(layersOf(c).map(l => l.folder), ['test/unit/', 'test/integration/', 'test/range/', 'test/api/'])
  assert.deepEqual(c.vitest.configs.map(x => x.config), ['vitest.config.e2e.ts', 'vitest.config.db.ts'])
  // tsconfig.json leaves the specs out; tsconfig.db.json has the @test/* alias the specs import.
  assert.equal(c.vitest.tsconfig, 'tsconfig.db.json')
})

test('the frontend config forbids .env.* like the backend', () => {
  const c = load('warehouse-frontend.quality-code.json')
  assert.equal(c.adapter, 'playwright')
  assert.ok(c.boundaries.forbidden.some(r => r.path === '.env.*'))
})

test('the frontend config type-checks the e2e specs with their own tsconfig', () => {
  // The root tsconfig.json is the app's (composite, src only); e2e/ has its own.
  assert.equal(load('warehouse-frontend.quality-code.json').playwright.tsconfig, 'e2e/tsconfig.json')
})
