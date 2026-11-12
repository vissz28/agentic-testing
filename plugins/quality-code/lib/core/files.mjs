// Reading the plugin's and the project's small files, written once. Imports only Node's own modules.
import { readFileSync } from 'node:fs'
import { firstLine } from './text.mjs'

/**
 * A JSON file's content. A missing, unreadable or broken file throws, as Node and JSON.parse throw.
 * @param {string | URL} path
 * @returns {any}
 */
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/**
 * A JSON file's content, or `fallback` when the file is not there.
 * A file that is there but cannot be read or is not valid JSON is a real problem, so it throws, naming the file.
 * @template T
 * @param {string | URL} path
 * @param {T} fallback
 * @returns {any | T}
 */
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

/**
 * A JSON file's content, or `fallback` on any problem: missing, unreadable or broken. Only for a file that may
 * be half written, or whose problem is reported elsewhere; anywhere else a broken file must not pass for a
 * missing one (readJsonOr).
 * @template T
 * @param {string | URL} path
 * @param {T} fallback
 * @returns {any | T}
 */
export function tryReadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
