import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const spec = read('commands/spec.md')
const setup = read('commands/setup.md')

test('spec: --flow is an option, checked by the script, and follows the project\'s naming, folder and style', () => {
  assert.match(spec, /argument-hint:.*\[--flow project\|quality-code\]/)
  assert.ok(spec.includes('bin/ticket.mjs" config flow`'))
  assert.match(spec, /`--flow is project or quality-code\.`/)
  const s = spec.slice(spec.indexOf('**Writing in the project\'s flow**'), spec.indexOf('- **Vitest:** write one spec file per layer'))
  for (const t of ['**Name:**', '**Folder:**', '**Style:**', '**No tests yet**']) assert.ok(s.includes(t), t)
  assert.match(s, /no ticket key in the file name \(the key stays in the test block's title/)
  assert.match(s, /read the two nearest specs in that folder first \(read-only\)/)
  assert.match(s, /the hook's denial sends the file to the layer folder/)
})

test('spec: Quality Code\'s own naming is marked as its flow, not the only one', () => {
  assert.equal([...spec.matchAll(/\*\*Name\*\* \(Quality Code's flow\)/g)].length, 2, 'Vitest and Playwright names')
})

test('setup: a project with tests is offered its own flow or ours, on the Confirm card and in Change what', () => {
  assert.ok(setup.includes('1. Follow your project\'s flow: new tests use your naming, folders and style'))
  assert.ok(setup.includes('2. Use Quality Code\'s flow: the ticket key in the file name, Quality Code\'s test folders'))
  assert.match(setup, /`conventions\.specs` in the detect result is above 0/)
  assert.ok(setup.includes('     Tests    <follow your project\'s flow'))
  assert.match(setup, /`testFlow` \(only when the project has tests\)/)
  assert.ok(setup.includes('     6. Test flow'))
})
