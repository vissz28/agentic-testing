// Honesty: flag diffs that remove an assertion or test, or skip one without a ticket.
import { keySource } from '../../config/keys.mjs'
import { specDiff } from '../../core/git.mjs'
import { result } from '../result.mjs'
import { redTagsOf } from '../../config/config.mjs'
import { escapeRegExp } from '../../core/text.mjs'

// Anything that stops a test running or failing: skip, fail(s), skipIf/runIf, inline test.fixme(), xit, { skip: true }.
// A new test.fixme('title', …) declaration means "not pinned down yet" and is allowed. .only/fit drop every other test.
const SKIP = [/(?<![.\w$])(?:it|test|describe)\s*\(\s*(['"`]).*?\1\s*,\s*\{[^{}]*\bskip\s*:(?!\s*false\b)/, /\b(?:it|test|describe|context|specify)\.skip\b/, /\.skip\s*\(/, /(?<![.\w$])(?:it|test)\.(?:fails?|skipIf|runIf)\b/, /(?<![.\w$])test\.fixme\s*\((?!\s*(?:['"`]|$))/, /(?<![.\w$])x(?:it|test|describe|context|specify)\s*\(/]
const ONLY = /(?<![.\w$])(?:(?:it|test|describe|suite|context|specify)(?:\.describe)?\.only\b|f(?:it|describe)\s*\()/
const DISABLING = new Set(['skip', 'fixme', 'fail', 'fails', 'todo', 'skipIf', 'runIf'])

const ENV_READ = /\b(?:process\.env|import\.meta\.env|os\.environ|System\.getenv|Environment\.GetEnvironmentVariable|getenv)\b/
const ENV_NAME = /\b(?:set|define|export|missing|requires?|needs?)\s+[`'"]?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
/**
 * test.skip(!ids, "set STS_TAXPAYER_ID …") is fine when it reads the env or names an env var or the ticket:
 * the test waits for data rather than being dropped. A bare test.skip('title') is never excused.
 */
export function envGatedSkip(body, own) {
  const m = /\.(?:skip|fixme)\s*\(\s*([^'"`\s][^,]*?)\s*,\s*(['"`])(.*?)\2/.exec(body)
  if (!m) return false
  return ENV_READ.test(m[1]) || ENV_NAME.test(m[3]) || Boolean(own && new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(own)}(?!\\d)`).test(m[3]))
}

function testDecl(line) {
  const m = /(?<![.\w$])(?:test|it)(?:\.(\w+))?\s*\(\s*(['"`])(.+?)\2/.exec(line)
  return m ? { mod: m[1] ?? null, title: m[3] } : null
}
const testTitle = line => testDecl(line)?.title ?? null

/** Path from a `+++` header: drop b/ and a trailing tab, decode git's quoted octal escapes. */
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

/** redTags (playwright.redTags) need a ticket tag beside them. own: the key under test never excuses a skip. */
export function scanDiff(diff, dialect, keySrc, { redTags = redTagsOf(null), own = null } = {}) {
  const h = dialect.honesty
  // Dialects may bring their own assertions and skips (Go t.Errorf/t.Skip, pytest skipif, JUnit @Disabled).
  const assertion = h.assertionRe ?? h.assertion ?? dialect.removedAssertion ?? /\bexpect\s*\(/
  const skips = [...(h.skips ?? SKIP), ...(dialect.skipMarks ?? [])]
  const tracked = new RegExp(`\\b${own ? `(?!${escapeRegExp(own)}\\b)` : ''}${keySrc}\\b`)
  const taggedKey = new RegExp(`['"\`]@${keySrc}['"\`]`)
  const redTag = redTags.length ? new RegExp(`['"\`](?:${redTags.map(escapeRegExp).join('|')})['"\`]`) : null
  const out = []
  const added = new Set()
  const addedLines = new Map()
  let pendingMod = null
  let file = null
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('+++ b/') || raw.startsWith('+++ "b/')) { file = headerPath(raw.slice(4)); continue }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) continue
    if (raw.startsWith('-')) {
      const body = raw.slice(1)
      if (assertion.test(body) || h.assertRe?.test(body)) out.push({ file, kind: 'assertion removed', line: body.trim() })
      else if (h.removedDecl.test(body)) out.push({ file, kind: 'test removed', line: body.trim(), title: testTitle(body) })
    } else if (raw.startsWith('+')) {
      const body = raw.slice(1)
      if (h.forgiveMoves) {
        const lineKey = `${file}\0${body.trim()}`
        addedLines.set(lineKey, (addedLines.get(lineKey) ?? 0) + 1)
        // Formatters move long titles to their own line, so a bare string line is a title too.
        const decl = testDecl(body)
        const open = /(?<![.\w$])(?:test|it)(?:\.(\w+))?\s*\(\s*$/.exec(body)
        if (open) pendingMod = open[1] ?? null
        const title = decl?.title ?? /^\s*(['"`])(.+?)\1,\s*$/.exec(body)?.[2]
        // Re-adding as test.fixme('same title') hides the test, so it doesn't forgive the removal.
        if (title && !DISABLING.has(decl ? decl.mod : pendingMod)) added.add(`${file}\0${title}`)
      }
      if (h.anchorTags && redTag?.test(body) && !taggedKey.test(body))
        out.push({ file, kind: 'anchor tag without a ticket tag', line: body.trim() })
      if (((skips.some(re => re.test(body)) || h.skipRe?.test(body)) && !tracked.test(body) && !envGatedSkip(body, own)) || ONLY.test(body))
        out.push({ file, kind: 'test newly skipped', line: body.trim() })
    }
  }
  const kept = !h.forgiveMoves ? out : out.filter(v => {
    // Same-title test or identical expect re-added = edited/moved, not removed. One re-add per removal.
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

export function run({ specs, range = null, key = null }, ctx) {
  const d = specDiff(ctx.root, specs, range)
  if (!d.ok) return result('honesty', 'not_run', `cannot read the git diff: ${d.error}`)
  const v = scanDiff(d.diff, ctx.dialect, keySource(ctx.config), { redTags: redTagsOf(ctx.config), own: key })
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
