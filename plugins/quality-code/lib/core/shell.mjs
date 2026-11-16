// A project's own command line, built from a template, written once. Imports only Node's own modules.

/**
 * A value as one word of a shell command line: '…' for sh, "…" for cmd.exe.
 * @param {unknown} value
 * @param {boolean} [win] cmd.exe quoting; the platform's by default
 * @returns {string}
 */
export const shellQuote = (value, win = process.platform === 'win32') =>
  (win ? `"${String(value).replace(/"/g, '""')}"` : `'${String(value).replace(/'/g, "'\\''")}'`)

/**
 * The template with each {name} of values replaced by its value, in one pass: a value is never read as
 * a placeholder or a replacement pattern ("$&"). A {name} not in values stays as written.
 * @param {string} template like "make test PKGS={files} OUT={report}"
 * @param {Record<string, string>} values the text for each name, quoted already where it needs to be
 * @returns {string}
 */
export const fillPlaceholders = (template, values) =>
  template.replace(/\{(\w+)\}/g, (slot, name) => (Object.hasOwn(values, name) ? values[name] : slot))
