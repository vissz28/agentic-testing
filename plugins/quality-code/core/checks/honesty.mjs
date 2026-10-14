// Honesty: did the change to a spec remove an assertion or a test, or skip one without a ticket?
// Static analysis of a git diff. The dialect decides what counts as a test declaration and
// whether moved lines are forgiven (see the plan's Ruling 1).
import { keySource } from './keys.mjs'
import { specDiff } from './git.mjs'
import { result } from './result.mjs'

const SKIP = [/\b(?:it|test|describe)\.skip\b/, /\.skip\s*\(/]

/** The title of a test(/it( declaration on the same line; else null. */
function testTitle(line) {
  return /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])(.+?)\1/.exec(line)?.[2] ?? null
}

/** The path of a `+++` header: drop the b/ prefix and a trailing tab; unquote what git quoted. */
function headerPath(rest) {
  let p = rest.replace(/\t.*$/, '')
  if (p.startsWith('"') && p.endsWith('"') && p.length > 1) {
    const bytes = []
    const esc = { n: 10, t: 9, '"': 34, '\\': 92 }
    const inner = p.slice(1, -1)
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] !== '\\') { bytes.push(...Buffer.from(inner[i])); continue }
      const oct = /^[0-7]{3}/.exec(inner.slice(i + 1))
      if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3 } else if (inner[i + 1] in esc) { bytes.push(esc[inner[++i]]) } else bytes.push(92)
    }
    p = Buffer.from(bytes).toString('utf8')
  }
  return p.replace(/^b\//, '')
}

export function scanDiff(diff, dialect, keySrc) {
  const h = dialect.honesty
  const tracked = new RegExp(`\\b${keySrc}\\b`)
  const taggedKey = new RegExp(`['"\`]@${keySrc}['"\`]`)
  const out = []
  const added = new Set()
  const addedLines = new Map()
  let file = null
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('+++ b/') || raw.startsWith('+++ "b/')) { file = headerPath(raw.slice(4)); continue }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) continue
    if (raw.startsWith('-')) {
      const body = raw.slice(1)
      if (/\bexpect\s*\(/.test(body)) out.push({ file, kind: 'assertion removed', line: body.trim() })
      else if (h.removedDecl.test(body)) out.push({ file, kind: 'test removed', line: body.trim(), title: testTitle(body) })
    } else if (raw.startsWith('+')) {
      const body = raw.slice(1)
      if (h.forgiveMoves) {
        const lineKey = `${file}\0${body.trim()}`
        addedLines.set(lineKey, (addedLines.get(lineKey) ?? 0) + 1)
        // Formatters put a long title on its own line, so a bare string-literal line is a title too.
        const title = testTitle(body) ?? /^\s*(['"`])(.+?)\1,\s*$/.exec(body)?.[2]
        if (title) added.add(`${file}\0${title}`)
      }
      if (h.anchorTags && /['"`]@(?:anchor|finding)['"`]/.test(body) && !taggedKey.test(body))
        out.push({ file, kind: 'anchor tag without a ticket tag', line: body.trim() })
      if (SKIP.some(re => re.test(body)) && !tracked.test(body))
        out.push({ file, kind: 'test newly skipped', line: body.trim() })
    }
  }
  const kept = !h.forgiveMoves ? out : out.filter(v => {
    // A removed test( re-added with the same title was edited; a removed expect( re-added verbatim
    // (bar indentation) only moved. Each re-add covers one removal.
    if (v.kind === 'test removed') return !(v.title && added.has(`${v.file}\0${v.title}`))
    if (v.kind !== 'assertion removed') return true
    const key = `${v.file}\0${v.line}`
    const left = addedLines.get(key) ?? 0
    if (!left) return true
    addedLines.set(key, left - 1)
    return false
  })
  return kept.map(({ title, ...v }) => v)
}

export function run({ specs, range = null }, ctx) {
  const d = specDiff(ctx.root, specs, range)
  if (!d.ok) return result('honesty', 'not_run', `cannot read the git diff: ${d.error}`)
  const v = scanDiff(d.diff, ctx.dialect, keySource(ctx.config))
  const count = k => v.filter(x => x.kind === k).length
  const data = {
    removedAssertions: count('assertion removed'),
    removedTests: count('test removed'),
    newSkips: count('test newly skipped'),
    untaggedAnchors: count('anchor tag without a ticket tag'),
  }
  const findings = v.map(x => ({ file: x.file, kind: x.kind, detail: x.line }))
  if (!v.length) return result('honesty', 'pass', 'no assertion or test removed, no skip without a ticket', [], data)
  return result('honesty', 'fail', `${v.length} honesty problem(s): ${[...new Set(v.map(x => x.kind))].join(', ')}`, findings, data)
}
