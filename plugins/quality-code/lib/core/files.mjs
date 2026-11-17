// JSON file reads.
import { readFileSync } from 'node:fs'
import { firstLine } from './text.mjs'

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** `fallback` only when the file is missing; an unreadable or broken file throws with its path. */
export function readJsonOr(path, fallback) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) {
    if (e?.code === 'ENOENT') return fallback
    throw new Error(`${path} cannot be read (${e?.code ?? firstLine(e?.message)})`, { cause: e })
  }
  try { return JSON.parse(text) } catch (e) {
    throw new Error(`${path} is not valid JSON (${firstLine(e?.message)})`, { cause: e })
  }
}

/** `fallback` on any error. Only for files that may be half-written; elsewhere use readJsonOr. */
export function tryReadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
