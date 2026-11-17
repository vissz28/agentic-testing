// Type checks for values read from files, arguments or replies.

const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/** A Jira key like ABC-123. A key that passes is safe to use as a folder name. */
export const isTicketKey = value => typeof value === 'string' && TICKET_KEY.test(value)

export const hasLineBreak = text => /[\r\n]/.test(text)

/** A non-blank string with no line break. */
export const isLine = value => typeof value === 'string' && value.trim() !== '' && !hasLineBreak(value)

/** A plain object: not null, not an array. */
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A real YYYY-MM-DD day; rejects 2026-02-31, which Date.parse rolls over to March. */
export const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** Plain digits only ("3", not "03", "3.0", "-1" or " 3"), at least min. */
export const isWholeNumber = (text, { min = 0 } = {}) => /^(?:0|[1-9]\d*)$/.test(String(text)) && Number(text) >= min
