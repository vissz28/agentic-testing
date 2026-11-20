// The 15 commands show in the / menu; the direct skill only routes messages that start with "Quality Code" and is not listed there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const commandsDir = new URL('../../commands/', import.meta.url)
const skillUrl = new URL('../../skills/direct/SKILL.md', import.meta.url)
const split = t => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t)
  return { front: m?.[1] ?? '', body: m?.[2] ?? '' }
}

test('every command shows in the / menu', () => {
  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'))
  assert.ok(files.length >= 15)
  for (const f of files) {
    const { front } = split(readFileSync(new URL(f, commandsDir), 'utf8'))
    assert.doesNotMatch(front, /user-invocable:\s*false/, `${f} is visible`)
  }
})

test('the direct skill stays for "Quality Code ..." messages and routes to quality_code_direct, but is not in the / menu', () => {
  assert.ok(existsSync(skillUrl))
  const { front, body } = split(readFileSync(skillUrl, 'utf8'))
  assert.match(front, /^name: direct$/m)
  assert.match(front, /^user-invocable: false$/m, 'the entry is hidden from the menu')
  const description = /^description: (.*)$/m.exec(front)?.[1] ?? ''
  assert.ok(description.includes('Quality Code direct'))
  assert.ok(description.includes('Using Quality Code'))
  assert.ok(body.includes('quality_code_direct'))
})
