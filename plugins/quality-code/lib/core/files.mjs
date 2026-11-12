// Reading the plugin's and the project's small files, written once. Imports only Node's own modules.
import { readFileSync } from 'node:fs'
import { firstLine } from './text.mjs'

/**
 * A JSON file's content, or `fallback` when the file is not there.
 * A file that is there but cannot be read or is not valid JSON is a real problem, so it throws, naming the
 * file, unless the caller says a broken file may count as missing too: `{ whenBroken: 'fallback' }`.
 * @template T
 * @param {string} path
 * @param {T} fallback
 * @param {{ whenBroken?: 'throw' | 'fallback' }} [options]
 * @returns {any | T}
 */
export function readJsonOr(path, fallback, { whenBroken = 'throw' } = {}) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) {
    if (e?.code === 'ENOENT' || whenBroken === 'fallback') return fallback
    throw new Error(`${path} cannot be read (${e?.code ?? firstLine(e?.message)})`, { cause: e })
  }
  try { return JSON.parse(text) } catch (e) {
    if (whenBroken === 'fallback') return fallback
    throw new Error(`${path} is not valid JSON (${firstLine(e?.message)})`, { cause: e })
  }
}
