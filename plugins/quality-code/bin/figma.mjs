#!/usr/bin/env node
// Saved Figma reads, so a design costs one Figma call per node, and Figma's seat limit is not hit again.
// get <url>: the saved read-out, and whether the limit is on. set <url> @<file>: saves the file's text, then deletes it.
// limited [--hours N]: Figma said the limit is reached. clear: forgets both.
// Exit 0 ok, 2 usage or refused input.
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectRoot } from '../lib/config/config.mjs'
import { clearFigma, getDesign, LIMIT_HOURS, setDesign, setLimited } from '../lib/state/figma-cache.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'
import { isWholeNumber } from '../lib/core/is.mjs'

const USAGE = 'usage: figma.mjs get <figma url> | set <figma url> @<file> | limited [--hours N] | clear'

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const fail = reason => { printError(reason); return 2 }
  const [sub, ...rest] = argv
  const root = projectRoot(env, cwd)
  if (sub === 'get' && rest.length === 1) {
    const r = getDesign(root, rest[0], env)
    if (!r.ok) return fail(r.reason)
    if (r.found) printLine(`Reusing the design read ${r.ageMinutes} min ago (no Figma call).`)
    else if (r.limited) printLine(`Figma's limit for your seat was reached: no call until ${r.limitedUntil}.`)
    else printLine('Not read yet: read it once with the Figma connector, then save it.')
    printLine(tag('FIGMA', r))
    return 0
  }
  if (sub === 'set' && rest.length === 2 && rest[1].startsWith('@')) {
    const file = resolve(cwd, rest[1].slice(1))
    let text
    try { text = readFileSync(file, 'utf8') } catch { return fail(`cannot read ${rest[1].slice(1)}`) }
    const r = setDesign(root, rest[0], text, env)
    if (!r.ok) return fail(r.reason)
    rmSync(file, { force: true })
    printLine(`ok: design saved; the next read of this node costs no Figma call.\n${tag('FIGMA', r)}`)
    return 0
  }
  if (sub === 'limited' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--hours'))) {
    if (rest.length && !isWholeNumber(rest[1], { min: 1 })) return fail('--hours needs a whole number')
    const r = setLimited(root, rest.length ? Number(rest[1]) : LIMIT_HOURS, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: no Figma call until ${r.limitedUntil}.\n${tag('FIGMA', r)}`)
    return 0
  }
  if (sub === 'clear' && rest.length === 0) {
    clearFigma(root, env)
    printLine('ok: saved designs and the limit forgotten.')
    return 0
  }
  return fail(USAGE)
}

if (isMain(import.meta.url)) process.exitCode = await main()
