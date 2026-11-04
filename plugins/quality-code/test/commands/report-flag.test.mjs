// The three commands that take --report say the same short thing, and keep their terminal behaviour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = n => readFileSync(new URL(`../../commands/${n}.md`, import.meta.url), 'utf8')

for (const name of ['kpi', 'consumption', 'tickets-eval']) {
  const doc = read(name)
  test(`${name}: --report is in the argument hint and has its own section before Examples`, () => {
    assert.match(doc, /^argument-hint: .*\[--report\]\n/m)
    const at = doc.indexOf('## `--report`: one HTML file with charts')
    assert.ok(at > doc.indexOf('## Steps') && at < doc.indexOf('## Examples'))
  })
  test(`${name}: file link, no JSON line, save place, artifact only after a yes, terminal unchanged`, () => {
    const s = doc.slice(doc.indexOf('## `--report`'), doc.indexOf('## Examples'))
    assert.match(s, /never with `--json`/)
    assert.ok(s.includes('guides/save-place.md'))
    assert.match(s, /\[HERE\]/)
    assert.match(s, /drop the `REPORT_JSON:` line/)
    assert.match(s, /Publish this report as an Artifact\?/)
    assert.match(s, /Only on a yes/)
    assert.match(s, /never without the yes/)
    assert.match(s, /show_widget/)
    assert.match(s, /In the terminal.*only give the file link\. Never ask, never publish/)
    assert.match(s, /keys, scores and numbers/)
    assert.doesNotMatch(s, /[A-Z]{2,}-\d+/)
  })
}
