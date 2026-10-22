export const normalise = t => String(t ?? '').replace(/\r\n?/g, '\n')
export const alt = words => words.join('|')
// HTML comments are authoring hints in the issue templates, never criteria.
export const stripComments = t => String(t ?? '').replace(/<!--[\s\S]*?-->/g, '')
