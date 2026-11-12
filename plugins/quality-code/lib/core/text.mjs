// Small jobs on a piece of text, written once. Imports nothing.

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
 * A path with forward slashes, whatever the machine wrote: Windows paths compare and match like any other.
 * @param {unknown} path
 * @returns {string}
 */
export const toPosix = path => String(path).replace(/\\/g, '/')

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
