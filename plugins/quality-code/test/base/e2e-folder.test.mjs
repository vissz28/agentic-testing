import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_FILES, DEFAULT_E2E_FOLDER, e2eFolder, readTestDir } from '../../lib/base/e2e-folder.mjs'

const base = { version: 1, adapter: 'playwright', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'] }, features: [] }
const dir = (files = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'qc-e2e-'))
  for (const [f, src] of Object.entries(files)) writeFileSync(join(d, f), src)
  return d
}

test('the config files are read in Playwright\'s own order; the default folder is e2e/', () => {
  assert.deepEqual(CONFIG_FILES, ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs'])
  assert.equal(DEFAULT_E2E_FOLDER, 'e2e/')
})
test('readTestDir: the one literal testDir of the first config file there is', () => {
  for (const f of CONFIG_FILES) {
    const d = dir({ [f]: "export default defineConfig({\n  testDir: './tests/e2e',\n})\n" })
    assert.deepEqual(readTestDir(d), { value: 'tests/e2e/', file: f }, f)
  }
  const d = dir({ 'playwright.config.ts': "testDir: 'a'\n", 'playwright.config.js': "testDir: 'b'\n" })
  assert.deepEqual(readTestDir(d), { value: 'a/', file: 'playwright.config.ts' })
})
test('readTestDir: quotes, backslashes, ./ and a trailing / are normalized', () => {
  const cases = { '"e2e"': 'e2e/', '`e2e/`': 'e2e/', "'./././e2e//'": 'e2e/', "'.\\\\e2e\\\\specs'": 'e2e/specs/' }
  for (const [lit, want] of Object.entries(cases)) assert.equal(readTestDir(dir({ 'playwright.config.ts': `export default {\n  testDir: ${lit},\n}\n` }))?.value, want, lit)
})
test('readTestDir: null for no file, no literal, a commented line, several values, the root, outside the project', () => {
  assert.equal(readTestDir(dir()), null)
  const none = [
    'export default { testDir: path.join(__dirname, "e2e") }',
    "export default {\n  // testDir: 'e2e',\n}",
    "export default {\n  /* testDir: 'e2e' */\n}",
    "export default { projects: [\n  { testDir: 'a' },\n  { testDir: 'b' },\n] }",
    "export default {\n  testDir: '.',\n}",
    "export default {\n  testDir: './',\n}",
    "export default {\n  testDir: '../shared/e2e',\n}",
    "export default {\n  testDir: '/abs/e2e',\n}",
    "export default {\n  testDir: `${root}/e2e`,\n}",
  ]
  for (const src of none) assert.equal(readTestDir(dir({ 'playwright.config.ts': src })), null, src)
})
test('readTestDir: a one-line config and trailing comments', () => {
  assert.equal(readTestDir(dir({ 'playwright.config.mjs': "export default defineConfig({ testDir: 'specs', use: { baseURL: 'http://localhost:3000' } })" }))?.value, 'specs/')
  assert.equal(readTestDir(dir({ 'playwright.config.ts': "export default {\n  testDir: 'specs', // testDir: 'old'\n  timeout: 1, /* testDir: 'x' */\n}" }))?.value, 'specs/')
})
test('readTestDir: the same value twice is one value', () => {
  const src = "export default {\n  testDir: 'e2e',\n  projects: [{ name: 'a',\n    testDir: './e2e/' }],\n}"
  assert.deepEqual(readTestDir(dir({ 'playwright.config.ts': src })), { value: 'e2e/', file: 'playwright.config.ts' })
})

test('e2eFolder: playwright.folder wins', () => {
  const d = dir({ 'playwright.config.ts': "export default {\n  testDir: 'tests',\n}" })
  assert.deepEqual(e2eFolder(d, { ...base, playwright: { folder: 'tests/checkout/' } }), { ok: true, folder: 'tests/checkout/', source: 'config' })
})
test('e2eFolder: the testDir of the Playwright config, else e2e/', () => {
  const d = dir({ 'playwright.config.ts': "export default {\n  testDir: './specs',\n}" })
  assert.deepEqual(e2eFolder(d, base), { ok: true, folder: 'specs/', source: 'testDir', configFile: 'playwright.config.ts' })
  assert.deepEqual(e2eFolder(dir(), base), { ok: true, folder: 'e2e/', source: 'default' })
})
test('e2eFolder: only for Playwright projects', () => {
  assert.deepEqual(e2eFolder(dir(), { ...base, adapter: 'vitest' }), { ok: false, error: 'the e2e folder is for Playwright projects: this project uses vitest' })
})
test('e2eFolder: a folder inside a forbidden boundary is refused, naming the rule; allow opens it', () => {
  const d = dir({ 'playwright.config.ts': "export default {\n  testDir: 'src/e2e',\n}" })
  const msg = (f, rule) => `the e2e folder "${f}" is inside the forbidden "${rule}": set playwright.folder, or allow it in boundaries.allow`
  assert.deepEqual(e2eFolder(d, base), { ok: false, error: msg('src/e2e/', 'src/') })
  assert.deepEqual(e2eFolder(dir(), { ...base, boundaries: { forbidden: [{ path: 'e2e/**' }] } }), { ok: false, error: msg('e2e/', 'e2e/**') })
  assert.equal(e2eFolder(d, { ...base, boundaries: { allow: ['src/e2e/'] } }).ok, true)
  assert.deepEqual(e2eFolder(dir(), { ...base, playwright: { folder: 'node_modules/x/' } }), { ok: false, error: 'the e2e folder "node_modules/x/" is inside "node_modules/", which a test run never writes: set playwright.folder' })
})

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const proj = (config, files = {}) => {
  const d = dir(files)
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(config))
  return d
}
const run = d => spawnSync('node', [CLI, 'config', 'e2e-folder'], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
const json = out => JSON.parse(out.split('\n').find(l => l.startsWith('E2E_FOLDER_JSON:')).slice('E2E_FOLDER_JSON:'.length))

test('cli config e2e-folder: one plain line, then the JSON line; exit 0', () => {
  let r = run(proj(base, { 'playwright.config.ts': "export default {\n  testDir: './specs',\n}" }))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.split('\n')[0], 'specs/ (from testDir in playwright.config.ts)')
  assert.deepEqual(json(r.stdout), { ok: true, folder: 'specs/', source: 'testDir', configFile: 'playwright.config.ts' })
  r = run(proj({ ...base, playwright: { folder: 'e2e/shop/' } }))
  assert.equal(r.stdout.split('\n')[0], 'e2e/shop/ (from playwright.folder)')
  r = run(proj(base))
  assert.equal(r.stdout.split('\n')[0], 'e2e/ (default: no testDir found in a Playwright config)')
  assert.equal(json(r.stdout).source, 'default')
})
test('cli config e2e-folder: errors on stderr, exit 2', () => {
  let r = run(proj({ ...base, adapter: 'vitest' }))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /for Playwright projects/)
  assert.equal(r.stdout, '')
  r = run(proj(base, { 'playwright.config.ts': "export default {\n  testDir: 'src/e2e',\n}" }))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /inside the forbidden "src\/"/)
  r = run(dir())
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Run \/quality-code:setup/)
})

test('a config in a subfolder: its testDir is relative to it; one named in playwright.configs comes first', () => {
  const d = dir()
  mkdirSync(join(d, 'e2e'))
  writeFileSync(join(d, 'e2e/playwright.config.ts'), "export default { testDir: './tests' }\n")
  assert.deepEqual(readTestDir(d, ['e2e/playwright.config.ts']), { value: 'e2e/tests/', file: 'e2e/playwright.config.ts' })
  assert.equal(readTestDir(d), null, 'Playwright itself looks only at the root')
  const configs = [{ match: 'e2e/**', config: 'e2e/playwright.config.ts' }]
  assert.deepEqual(e2eFolder(d, { ...base, playwright: { configs } }), { ok: true, folder: 'e2e/tests/', source: 'testDir', configFile: 'e2e/playwright.config.ts' })
  assert.equal(e2eFolder(d, { ...base, adapter: 'fullstack', playwright: { configs } }).folder, 'e2e/tests/', 'fullstack projects have an e2e folder too')
  assert.equal(e2eFolder(d, { ...base, adapter: 'vitest' }).ok, false)
})
