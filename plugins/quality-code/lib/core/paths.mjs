// Small jobs on a path written as text (a config value, a relative path, a URL), written once.
// Imports only Node's own modules and the kit's text helpers.
import { toForwardSlashes } from './text.mjs'

/**
 * The path with forward slashes and no "./" in front: "./a/b" -> "a/b", ".\\a" -> "a".
 * @param {unknown} path
 * @returns {string}
 */
export const stripDotSlash = path => toForwardSlashes(path).replace(/^(?:\.\/)+/, '')

/**
 * The path or URL with no "/" at the end: "a/b//" -> "a/b", "https://x.net/" -> "https://x.net".
 * @param {unknown} path
 * @returns {string}
 */
export const noTrailingSlash = path => String(path).replace(/\/+$/, '')

/**
 * A folder written the one way the plugin compares and stores it: forward slashes, no "./" in front,
 * no "/" at the end: "./tickets/" -> "tickets".
 * @param {unknown} path
 * @returns {string}
 */
export const cleanRelPath = path => noTrailingSlash(stripDotSlash(path))

/**
 * True for a path that is absolute on some machine: "/x", "\\x" or a drive, "C:x".
 * @param {unknown} path
 * @returns {boolean}
 */
export const isAbsoluteAnywhere = path => /^(?:[\\/]|[A-Za-z]:)/.test(String(path))

/**
 * True when a relative path (as path.relative gives it) leaves its folder: "..", "../x", "..\\x", or an
 * absolute path (another drive on Windows). A name that only starts with dots, "..x", stays inside.
 * @param {unknown} rel
 * @returns {boolean}
 */
export const leavesFolder = rel => {
  const p = toForwardSlashes(rel)
  return p === '..' || p.startsWith('../') || isAbsoluteAnywhere(p)
}
