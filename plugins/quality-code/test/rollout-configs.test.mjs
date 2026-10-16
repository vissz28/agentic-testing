import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { validateConfig, layersOf } from '../core/config.mjs'
import { configFor } from '../core/runners/playwright.mjs'
import { rulesFor, violation } from '../core/checks/boundary.mjs'

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
  // test/repro/ was the old layers.md's folder for bugs found along the way; its own config includes it.
  assert.deepEqual(layersOf(c).map(l => l.folder), ['test/unit/', 'test/integration/', 'test/range/', 'test/api/', 'test/repro/'])
  assert.deepEqual(c.vitest.configs.map(x => x.config), ['vitest.config.e2e.ts', 'vitest.config.repro.ts', 'vitest.config.db.ts'])
  assert.ok(layersOf(c).every(l => l.guide === '.claude/quality-code/guides/layers.md'), 'every layer reads the old layers guide')
  assert.deepEqual(c.seed, { builders: ['test/helpers/seed.ts'], guide: '.claude/quality-code/guides/seed.md' })
  assert.equal(c.qaPlans, 'test/qa-plans/')
  assert.ok(c.boundaries.forbidden.every(r => r.why), 'every boundary says why')
  // tsconfig.json leaves the specs out; tsconfig.db.json has the @test/* alias the specs import.
  assert.equal(c.vitest.tsconfig, 'tsconfig.db.json')
})

test('the frontend config forbids .env.* like the backend', () => {
  const c = load('warehouse-frontend.quality-code.json')
  assert.equal(c.adapter, 'playwright')
  assert.ok(c.boundaries.forbidden.some(r => r.path === '.env.*'))
})

test('the frontend config runs Playwright as npm run e2e does', () => {
  const c = validateConfig(load('warehouse-frontend.quality-code.json')).config
  // The config is not at the root, where Playwright looks; its testDir is ./tests, next to it.
  assert.equal(configFor('e2e/tests/orders.fic-1.spec.ts', c), 'e2e/playwright.config.ts')
  assert.equal(c.playwright.folder, 'e2e/tests/')
  // CI's blocking job runs --project=chromium; "visual" is the screenshot suite.
  assert.deepEqual(c.playwright.projects, ['chromium'])
  // The root tsconfig.json is the app's (composite, src only); e2e/ has its own.
  assert.equal(c.playwright.tsconfig, 'e2e/tsconfig.json')
})

test('both configs block the env files but let .env.example through, as their reasons say', () => {
  for (const f of ['warehouse-backend.quality-code.json', 'warehouse-frontend.quality-code.json']) {
    const rules = rulesFor(validateConfig(load(f)).config, '/nowhere')
    assert.ok(violation('.env', rules) && violation('.env.local', rules), f)
    assert.equal(violation('.env.example', rules), null, f)
  }
})

test('the frontend features use the app\'s routes and carry their QA-plan search words; its guides are set', () => {
  const c = load('warehouse-frontend.quality-code.json')
  const byLabel = Object.fromEntries(c.features.map(f => [f.label, f]))
  assert.equal(byLabel.Giacenza_Prodotti.route, '/productsStock')
  assert.equal(byLabel.Lista_Movimenti_Magazzino.route, '/movementsList')
  assert.equal(byLabel.Giacenza_Prodotti.qaPlanSearch, 'Giacenza prodotti')
  assert.ok(c.features.every(f => f.qaPlanSearch), 'without search words a ticket loses the QA-plan points')
  assert.ok(c.features.every(f => !f.route || /^\/[a-z][A-Za-z]*$/.test(f.route)), 'app routes, not folder names')
  assert.equal(c.playwright.guide, '.claude/quality-code/guides/playwright.md')
  assert.deepEqual(c.seed, { stubsFrom: 'e2e/tests/', guide: '.claude/quality-code/guides/seed.md' })
})
