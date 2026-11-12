import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

test('check offers Playwright when the project has none: a card with yes, no and other', () => {
  const run = read('guides/run.md')
  assert.match(run, /This project has no frontend \(Playwright\) tests/)
  assert.match(run, /guides\/add-playwright\.md/)
  const g = read('guides/add-playwright.md')
  assert.match(g, /1\. Yes: install Playwright/)
  assert.match(g, /2\. No\n/)
  assert.match(g, /3\. Other/)
  assert.match(g, /--ci/)
})

test('the guide installs with what detect gives, writes through setup --write and runs the check again', () => {
  const g = read('guides/add-playwright.md')
  assert.match(g, /setup\.mjs" --detect/)
  assert.match(g, /scaffold\.install/)
  assert.match(g, /setup\.mjs" --write/)
  assert.match(g, /run the check again/)
  assert.match(g, /Add `"frontend": "playwright"`; `backend` stays as it is/)
})
