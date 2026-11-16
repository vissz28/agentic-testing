import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const spec = read('commands/spec.md')
const setup = read('commands/setup.md')

test('spec: --style is an option, checked by the script, and follows the project\'s naming, folder and style', () => {
  assert.match(spec, /add the value after `--style` when `\$ARGUMENTS` has one: `project`, `quality-code` or `both`/)
  assert.ok(spec.includes('bin/ticket.mjs" config flow`'))
  assert.match(spec, /`--style is project, quality-code or both\.`/)
  const s = spec.slice(spec.indexOf('**Writing in the project\'s style**'), spec.indexOf('- **Vitest:** write one spec file per layer'))
  for (const t of ['**Name:**', '**Folder:**', '**Style:**', '**No tests yet**']) assert.ok(s.includes(t), t)
  assert.match(s, /no ticket key in the file name \(the key stays in the test block's title/)
  assert.match(s, /read the two nearest specs in that folder first \(read-only\)/)
  assert.match(s, /the hook's denial sends the file to the layer folder/)
})

test('spec: Quality Code\'s own naming is marked as its style, not the only one', () => {
  assert.equal([...spec.matchAll(/\*\*Name\*\* \(Quality Code's style\)/g)].length, 2, 'Vitest and Playwright names')
})

test('setup: a project with tests is offered its own style or ours, on the Confirm card and in Change what', () => {
  assert.ok(setup.includes('1. Like your existing tests: same folders, names and tools (recommended)'))
  assert.ok(setup.includes('2. The Quality Code way: its own folders, the ticket key in each file name'))
  assert.match(setup, /`conventions\.specs` in the detect result is above 0/)
  assert.ok(setup.includes('     Tests    <like your existing tests'))
  assert.match(setup, /`testStyle` \(only when the project has tests\)/)
  assert.ok(setup.includes('     6. Test style'))
})

test('both: FLOWS and config accept it, ticket.mjs and spec say each test is written twice', async () => {
  const { FLOWS, runFlow } = await import('../../lib/stacks/conventions.mjs')
  assert.deepEqual(FLOWS, ['project', 'quality-code', 'both'])
  assert.equal(runFlow({ testStyle: 'both' }, { specs: 0 }), 'both')
  assert.equal(runFlow({}, { specs: 3 }, 'both'), 'both')
  assert.match(spec, /`both`: write the tests twice over/)
})
