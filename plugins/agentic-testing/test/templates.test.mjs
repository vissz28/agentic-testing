// The shipped ticket templates must be recognised by the en vocabulary and score on both stacks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBrief } from '../core/score.mjs'
import { validateConfig } from '../core/config.mjs'
import { hasHeading } from '../core/criteria.mjs'
import { buildVocabulary } from '../core/languages/index.mjs'

const read = n => readFileSync(new URL(`../templates/${n}.md`, import.meta.url), 'utf8')
const fill = t => t.replace(/\{\{([^}]+)\}\}/g, (_, k) => ({
  'observable result': 'the grid shows exactly 5 rows',
  'environment': 'staging',
}[k] ?? `sample ${k}`))

const cfg = adapter => validateConfig({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en'], features: [{ label: 'Orders', route: '/orders' }],
}).config

const ticket = (type, body) => ({ key: 'DEMO-1', summary: '[FE] sample', issuetype: type, labels: ['Orders'], text: { description: body, acField: '' } })
const signal = (b, k) => b.signals[k]

test('headings are recognised by the en vocabulary', async () => {
  const v = buildVocabulary(['en'])
  const story = read('story'); const bug = read('bug')
  assert.ok(hasHeading(v, story, v.userStoryHeading))
  assert.ok(story.split('\n').some(l => v.acHeading.test(l)))
  assert.ok(hasHeading(v, story, v.environmentHeading))
  assert.ok(hasHeading(v, story, v.contextHeadingBE))
  for (const h of ['stepsHeading', 'expectedHeading', 'actualHeading', 'environmentHeading']) assert.ok(hasHeading(v, bug, v[h]), h)
})

for (const adapter of ['playwright', 'vitest']) {
  test(`filled story scores its signals on ${adapter}`, () => {
    const b = buildBrief(cfg(adapter), ticket('Story', fill(read('story'))))
    for (const k of ['ac_present', 'ac_testable', 'steps', 'expected_defined', 'environment']) assert.equal(signal(b, k), true, k)
    assert.equal(b.legacy, false)
  })
  test(`filled bug scores steps, expected and environment on ${adapter}`, () => {
    const b = buildBrief(cfg(adapter), ticket('Bug', fill(read('bug'))))
    for (const k of ['steps', 'expected_defined', 'environment']) assert.equal(signal(b, k), true, k)
  })
}
