// String helpers shared across the plugin.
import { sep } from 'node:path'

const COLOUR_CODES = /\x1b\[[0-9;]*[A-Za-z]/g

export const noColour = text => String(text ?? '').replace(COLOUR_CODES, '')

export const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** For paths from config or tool output: turns every backslash, so Windows paths match on any OS. */
export const toForwardSlashes = path => String(path).replace(/\\/g, '/')

/** For paths this machine built: turns only the OS separator (a backslash is a valid filename char on Unix). */
export const localToForwardSlashes = path => path.split(sep).join('/')

/**
 * The first line of a tool's output that says something, trimmed, without colour codes; '' when there is none.
 * @param {unknown} text
 * @returns {string}
 */
export const firstLine = text => noColour(text).split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** plural(1, 'file') -> "1 file", plural(3, 'file') -> "3 files". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The branch without the remote in front: "origin/develop" -> "develop"; a local name stays as it is.
 * @param {string} ref
 * @returns {string}
 */
export const withoutOrigin = ref => ref.replace(/^origin\//, '')

export const collapseSpaces = text => String(text).replace(/\s+/g, ' ')

/**
 * The lines of a text, whatever ends them: \n, \r\n or a lone \r.
 * @param {unknown} text
 * @returns {string[]}
 */
export const lines = text => String(text ?? '').split(/\r\n?|\n/)

/**
 * The text made safe inside HTML or XML, in a tag or in a quoted attribute: & < > " and ' are escaped.
 * @param {unknown} text
 * @returns {string}
 */
export const escapeHtml = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * n out of total as a whole percent, rounded; null when there is no total, which is "no data", not 0%.
 * @param {number} n
 * @param {number} total
 * @returns {number | null}
 */
export const pct = (n, total) => (total > 0 ? Math.round((100 * n) / total) : null)
