// String helpers shared across the plugin.
import { sep } from 'node:path'

const COLOUR_CODES = /\x1b\[[0-9;]*[A-Za-z]/g

export const noColour = text => String(text ?? '').replace(COLOUR_CODES, '')

export const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** For paths from config or tool output: turns every backslash, so Windows paths match on any OS. */
export const toForwardSlashes = path => String(path).replace(/\\/g, '/')

/** For paths this machine built: turns only the OS separator (a backslash is a valid filename char on Unix). */
export const localToForwardSlashes = path => path.split(sep).join('/')

/** First non-blank line, trimmed and without colour codes. */
export const firstLine = text => noColour(text).split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** plural(1, 'file') -> "1 file", plural(3, 'file') -> "3 files". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "origin/develop" -> "develop". */
export const withoutOrigin = ref => ref.replace(/^origin\//, '')

export const collapseSpaces = text => String(text).replace(/\s+/g, ' ')

/** Splits on \n, \r\n or a lone \r. */
export const lines = text => String(text ?? '').split(/\r\n?|\n/)

/** Safe in HTML/XML text and quoted attributes. */
export const escapeHtml = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Whole percent, or null when total is 0 (no data, not 0%). */
export const pct = (n, total) => (total > 0 ? Math.round((100 * n) / total) : null)
