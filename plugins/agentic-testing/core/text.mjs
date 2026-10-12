export const normalise = t => String(t ?? '').replace(/\r\n?/g, '\n')
export const alt = words => words.join('|')
