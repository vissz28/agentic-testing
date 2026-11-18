// The plugin shows one entry, the direct skill; the 15 commands are hidden from the / menu and run through it (or the MCP tool quality_code_direct).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const commandsDir = new URL('../../commands/', import.meta.url)
const skillUrl = new URL('../../skills/direct/SKILL.md', import.meta.url)
const split = t => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t)
  return { front: m?.[1] ?? '', body: m?.[2] ?? '' }
}

test('every command is hidden from the / menu', () => {
  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'))
  assert.ok(files.length >= 15)
  for (const f of files) {
    const { front } = split(readFileSync(new URL(f, commandsDir), 'utf8'))
    assert.match(front, /^user-invocable: false$/m, `${f} is hidden`)
  }
})

test('the direct skill is the one visible entry and routes to quality_code_direct', () => {
  assert.ok(existsSync(skillUrl))
  const { front, body } = split(readFileSync(skillUrl, 'utf8'))
  assert.match(front, /^name: direct$/m)
  assert.doesNotMatch(front, /user-invocable:\s*false/, 'the entry is not hidden')
  const description = /^description: (.*)$/m.exec(front)?.[1] ?? ''
  assert.ok(description.includes('Quality Code direct'))
  assert.ok(description.includes('Using Quality Code'))
  assert.ok(body.includes('quality_code_direct'))
})
