// Small jobs on a piece of text, written once. Imports only Node's own modules.
import { sep } from 'node:path'

const COLOUR_CODES = /\x1b\[[0-9;]*[A-Za-z]/g

/**
 * The text without the colour codes a tool prints for a terminal.
 * @param {unknown} text
 * @returns {string}
 */
export const noColour = text => String(text ?? '').replace(COLOUR_CODES, '')

/**
 * The text with every character that means something in a pattern made literal, to build a RegExp from it.
 * @param {unknown} text
 * @returns {string}
 */
export const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A path someone else wrote (a config value, a tool's report) with forward slashes: every backslash is
 * turned, on any machine, so a path typed on Windows compares and matches like any other.
 * @param {unknown} path
 * @returns {string}
 */
export const toForwardSlashes = path => String(path).replace(/\\/g, '/')

/**
 * A path this machine just built (path.join, path.relative) with forward slashes: only the machine's own
 * separator is turned. On macOS and Linux nothing changes, where a backslash can be part of a file name.
 * @param {string} path
 * @returns {string}
 */
export const localToForwardSlashes = path => path.split(sep).join('/')

const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/**
 * True for a Jira key such as ABC-123: a project key, a dash, a number, and nothing else.
 * Only a string is one, so a value that passes is safe to use as a folder name.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isTicketKey = value => typeof value === 'string' && TICKET_KEY.test(value)

/**
 * The first line of a tool's output that says something, trimmed, without colour codes; '' when there is none.
 * @param {unknown} text
 * @returns {string}
 */
export const firstLine = text => noColour(text).split('\n').map(l => l.trim()).find(Boolean) ?? ''

/**
 * A count and its noun: "1 file", "3 files". The plural is the noun and an "s" unless given.
 * @param {number} n
 * @param {string} one the noun for one, like "file" or "spec file"
 * @param {string} [many] the noun for any other count, when it is not one + "s"
 * @returns {string}
 */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * True when the text has a line break (\n or \r) in it.
 * @param {string} text
 * @returns {boolean}
 */
export const hasLineBreak = text => /[\r\n]/.test(text)

/**
 * True for one line of text: a string, not empty or only spaces, with no line break.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isLine = value => typeof value === 'string' && value.trim() !== '' && !hasLineBreak(value)

/**
 * The branch without the remote in front: "origin/develop" -> "develop"; a local name stays as it is.
 * @param {string} ref
 * @returns {string}
 */
export const withoutOrigin = ref => ref.replace(/^origin\//, '')
