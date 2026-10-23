// .NET syntax, as the backend checks read it. A STUB: every pattern matches nothing, so the checks
// find no test and no assertion yet; the .NET pack fills it in (same shape as vitest.mjs).
export const name = 'dotnet'

// A pattern that never matches: no group, no test, no assertion.
const NONE = /(?!)/g

/** Top-level group (a test class or module): m[1] = modifier chain, m[3] = title. */
export const groupRe = /(?!)/gm

export const honesty = {
  removedDecl: /(?!)/,
  forgiveMoves: false,
  anchorTags: false,
}

// The value check: a field the ticket names must be read in an assertion (unit tests read fields).
export const expected = { fieldNames: true }

export const suite = {
  testRe: NONE,
  notYet: 'todo',
  skippedGroups: true,
}

export const mutation = {
  // A compiled language: a mutated copy next to the spec would not compile (a duplicate class or
  // function), so the spec itself is mutated and always restored (see checks/mutation.mjs).
  inPlace: true,
  expectRe: /(?!)/,
  testRe: NONE,
  rank: () => 0,
  flips: () => [],
  eligible: () => false,
  plan: () => [],
}
