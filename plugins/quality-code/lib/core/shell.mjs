// Building a project's command line from a template.

/** Quotes one shell word: '…' for sh, "…" for cmd.exe. */
export const shellQuote = (value, win = process.platform === 'win32') =>
  (win ? `"${String(value).replace(/"/g, '""')}"` : `'${String(value).replace(/'/g, "'\\''")}'`)

/** Replaces each {name} in one pass, so a value is never re-read as a placeholder or "$&". Unknown names stay. */
export const fillPlaceholders = (template, values) =>
  template.replace(/\{(\w+)\}/g, (slot, name) => (Object.hasOwn(values, name) ? values[name] : slot))
