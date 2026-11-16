// String helpers shared across the plugin.
import { sep } from 'node:path'

const COLOUR_CODES = /\x1b\[[0-9;]*[A-Za-z]/g

export const noColour = text => String(text ?? '').replace(COLOUR_CODES, '')

export const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** For paths from config or tool output: turns every backslash, so Windows paths match on any OS. */
export const toForwardSlashes = path => String(path).replace(/\\/g, '/')

/** For paths this machine built: turns only the OS separator (a backslash is a valid filename char on Unix). */
export const localToForwardSlashes = path => path.split(sep).join('/')

const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/** A Jira key like ABC-123. A key that passes is safe to use as a folder name. */
export const isTicketKey = value => typeof value === 'string' && TICKET_KEY.test(value)

/** First non-blank line, trimmed and without colour codes. */
export const firstLine = text => noColour(text).split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** plural(1, 'file') -> "1 file", plural(3, 'file') -> "3 files". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const hasLineBreak = text => /[\r\n]/.test(text)

/** A non-blank string with no line break. */
export const isLine = value => typeof value === 'string' && value.trim() !== '' && !hasLineBreak(value)

/** "origin/develop" -> "develop". */
export const withoutOrigin = ref => ref.replace(/^origin\//, '')

export const collapseSpaces = text => String(text).replace(/\s+/g, ' ')
