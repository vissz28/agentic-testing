import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { staleBuild, webServerCommand } from '../../lib/pipeline/stale-build.mjs'
import { formatCard } from '../../lib/pipeline/card.mjs'

// files: path -> [text, age in minutes].
function tree(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-stale-'))
  const now = Date.now() / 1000
  for (const [p, [text, minutes]] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true })
    writeFileSync(join(d, p), text)
    utimesSync(join(d, p), now - minutes * 60, now - minutes * 60)
  }
  return d
}
const pw = command => [`export default defineConfig({ testDir: './e2e', webServer: { command: '${command}', url: 'http://localhost:4173' } })`, 0]

test('webServerCommand reads the command of the webServer block only', () => {
  assert.equal(webServerCommand("export default { use: { command: 'x' }, webServer: { url: 'u', command: \"npm run preview\" } }"), 'npm run preview')
  assert.equal(webServerCommand("export default { testDir: 'e2e' }"), null)
})
test('a preview of a build older than the code is flagged, with the build, the command and the file that changed', () => {
  const d = tree({ 'playwright.config.ts': pw('npm run preview'), 'package.json': ['{"scripts":{"preview":"vite preview"}}', 0], 'dist/index.html': ['x', 30], 'src/App.tsx': ['x', 5], 'src/old.ts': ['x', 60] })
  assert.deepEqual(staleBuild(d, 'playwright.config.ts'), { build: 'dist/', command: 'npm run preview', changed: 'src/App.tsx' })
})
test('nothing is flagged for a fresh build, a dev server, a live app or no build folder', () => {
  const fresh = tree({ 'playwright.config.ts': pw('vite preview'), 'dist/index.html': ['x', 1], 'src/App.tsx': ['x', 5] })
  assert.equal(staleBuild(fresh, 'playwright.config.ts'), null)
  for (const dev of ['npm run dev', 'ng serve', 'vue-cli-service serve']) {
    const d = tree({ 'playwright.config.ts': pw(dev), 'package.json': ['{"scripts":{"dev":"vite"}}', 0], 'dist/index.html': ['x', 30], 'src/App.tsx': ['x', 5] })
    assert.equal(staleBuild(d, 'playwright.config.ts'), null, dev)
  }
  const live = tree({ 'playwright.config.ts': ["export default { use: { baseURL: 'https://app' } }", 0], 'dist/index.html': ['x', 30], 'src/App.tsx': ['x', 5] })
  assert.equal(staleBuild(live, 'playwright.config.ts'), null)
  assert.equal(staleBuild(tree({ 'playwright.config.ts': pw('vite preview'), 'src/App.tsx': ['x', 5] }), 'playwright.config.ts'), null)
})
test('a static server on the build folder counts as a build too', () => {
  const d = tree({ 'playwright.config.ts': pw('npx serve -s build'), 'build/index.html': ['x', 30], 'src/App.tsx': ['x', 5] })
  assert.equal(staleBuild(d, 'playwright.config.ts')?.build, 'build/')
})
test('the card says the build is old, above the verdict', () => {
  const card = formatCard({ verdict: 'tests_red', steps: [], staleBuild: { build: 'dist/', command: 'npm run preview', changed: 'src/App.tsx' } })
  assert.match(card, /⚠️ Old build: npm run preview serves dist\/, built before src\/App\.tsx changed, so the tests ran the old code\. Build again, then check again\.\n\nVerdict:/)
})
