// Checks on a value read from a file, an argument or a reply: is it the kind of value it should be? Written once.
// Imports nothing.

const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/**
 * True for a Jira key such as ABC-123: a project key, a dash, a number, and nothing else.
 * Only a string is one, so a value that passes is safe to use as a folder name.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isTicketKey = value => typeof value === 'string' && TICKET_KEY.test(value)

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
 * True for a plain object such as JSON's { … }: not null, not a list.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * True for a real day written YYYY-MM-DD: 2026-02-31 is not one (Date.parse would roll it over to March).
 * @param {unknown} value
 * @returns {boolean}
 */
export const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value
}

/**
 * True for a whole number written plainly in digits ("3", not "03", "3.0", "-1" or " 3"), at least min.
 * @param {unknown} text
 * @param {{ min?: number }} [options]
 * @returns {boolean}
 */
export const isWholeNumber = (text, { min = 0 } = {}) => /^(?:0|[1-9]\d*)$/.test(String(text)) && Number(text) >= min
