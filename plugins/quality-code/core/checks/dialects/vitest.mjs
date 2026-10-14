// Vitest syntax, as the backend checks read it.
export const name = 'vitest'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:it|test|describe)(?:\.(?:only|concurrent|each))?\s*\(/,
  forgiveMoves: false,
  anchorTags: false,
}

export const suite = {
  testRe: /\b(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'todo',
  skippedGroups: true,
  isCapture: () => false,
}
