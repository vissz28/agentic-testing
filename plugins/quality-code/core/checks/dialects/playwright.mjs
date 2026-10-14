// Playwright syntax, as the frontend checks read it.
export const name = 'playwright'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^test\.describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:test|it)(?:\.(?:describe|only))?\s*\(/,
  forgiveMoves: true,
  anchorTags: true,
}

export const suite = {
  testRe: /\b(?:test|it)(?:\.(skip|fixme|only))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'fixme',
  skippedGroups: false,
  // Design-conformance captures screenshot and never assert; they are not graded.
  isCapture: title => /conformance|capture/i.test(title),
}
